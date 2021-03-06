import { platform } from 'os'
import execa from 'execa'
import fetch from 'node-fetch'
import DockerImage from './DockerImage.js'
import DockerPort from './DockerPort.js'
import debugLog from '../../../debugLog.js'

const { stringify } = JSON
const { entries } = Object

export default class DockerContainer {
  constructor(env, functionKey, handler, runtime) {
    this._env = env
    this._functionKey = functionKey
    this._handler = handler
    this._imageNameTag = this._baseImage(runtime)
    this._image = new DockerImage(this._imageNameTag)

    this._containerId = null
    this._port = null
  }

  _baseImage(runtime) {
    return `lambci/lambda:${runtime}`
  }

  async start(codeDir) {
    const [, port] = await Promise.all([
      this._image.pull(),
      DockerContainer._dockerPort.get(),
    ])

    debugLog('Run Docker container...')

    // TODO: support layer
    // https://github.com/serverless/serverless/blob/v1.57.0/lib/plugins/aws/invokeLocal/index.js#L291-L293
    const dockerArgs = [
      '-v',
      `${codeDir}:/var/task:ro,delegated`,
      '-e',
      'DOCKER_LAMBDA_STAY_OPEN=1', // API mode
    ]

    entries(this._env).forEach(([key, value]) => {
      dockerArgs.push('-e', `${key}=${value}`)
    })

    if (platform() === 'linux') {
      // use host networking to access host service (only works on linux)
      dockerArgs.push(
        '--net',
        'host',
        '-e',
        `DOCKER_LAMBDA_API_PORT=${port}`,
        '-e',
        `DOCKER_LAMBDA_RUNTIME_PORT=${port}`,
      )
    } else {
      // expose port simply
      // `host.docker.internal` DNS name can be used to access host service
      dockerArgs.push('-p', `${port}:9001`)
    }

    const { stdout: containerId } = await execa('docker', [
      'create',
      ...dockerArgs,
      this._imageNameTag,
      this._handler,
    ])

    const dockerStart = execa('docker', ['start', '-a', containerId], {
      all: true,
    })

    await new Promise((resolve, reject) => {
      dockerStart.all.on('data', (data) => {
        const str = data.toString()
        console.log(str)
        if (str.includes('Lambda API listening on port')) {
          resolve()
        }
      })

      dockerStart.on('error', (err) => {
        reject(err)
      })
    })

    this._containerId = containerId
    this._port = port
  }

  async request(event) {
    const url = `http://localhost:${this._port}/2015-03-31/functions/${this._functionKey}/invocations`
    const res = await fetch(url, {
      body: stringify(event),
      headers: { 'Content-Type': 'application/json' },
      method: 'post',
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch from ${url} with ${res.statusText}`)
    }

    return res.json()
  }

  async stop() {
    if (this._containerId) {
      try {
        await execa('docker', ['stop', this._containerId])
        await execa('docker', ['rm', this._containerId])
      } catch (err) {
        console.error(err.stderr)
        throw err
      }
    }
  }

  get isRunning() {
    return this._containerId !== null && this._port !== null
  }
}

// static private
DockerContainer._dockerPort = new DockerPort()

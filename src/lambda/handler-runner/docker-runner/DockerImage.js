import execa from 'execa'
import promiseMemoize from 'p-memoize'
import debugLog from '../../../debugLog.js'

export default class DockerImage {
  constructor(imageNameTag) {
    this._imageNameTag = imageNameTag
  }

  static async _pullImage(imageNameTag) {
    debugLog(`Downloading base Docker image... (${imageNameTag})`)

    try {
      await execa('docker', [
        'pull',
        '--disable-content-trust=false',
        imageNameTag,
      ])
    } catch (err) {
      console.error(err.stderr)
      throw err
    }
  }

  async pull() {
    return DockerImage._memoizedPull(this._imageNameTag)
  }
}

DockerImage._memoizedPull = promiseMemoize(DockerImage._pullImage)

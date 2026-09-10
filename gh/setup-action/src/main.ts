import * as core from '@actions/core'
import toolCache from '@actions/tool-cache'
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { validateSubscription } from './subscription.js'

type LatestReleaseResponse =
  RestEndpointMethodTypes['repos']['getLatestRelease']['response']['data']

const platformMap: Record<string, string> = {
  linux: 'linux',
  darwin: 'darwin',
  win32: 'windows'
}

const archMap: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64'
}

async function getLatestVersion(): Promise<string> {
  const url = `https://api.github.com/repos/hytromo/mimosa/releases/latest`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'mimosa-downloader' } // required by GitHub API
  })

  if (!res.ok) {
    throw new Error(
      `Failed to fetch latest release from ${url}: ${res.status} ${res.statusText}`
    )
  }

  const json = (await res.json()) as LatestReleaseResponse
  return json.tag_name.replaceAll('v', '').trim()
}

async function verifyChecksum(
  downloadPath: string,
  version: string,
  os: string,
  arch: string
): Promise<void> {
  const tarballName = `mimosa_${version}_${os}_${arch}.tar.gz`
  const checksumUrl = `https://github.com/hytromo/mimosa/releases/download/v${version}/mimosa_${version}_checksums.txt`

  let checksumText: string
  try {
    const res = await fetch(checksumUrl, {
      headers: { 'User-Agent': 'mimosa-downloader' }
    })
    if (!res.ok) {
      core.info(
        `Checksum file not found (HTTP ${res.status}), skipping integrity verification`
      )
      return
    }
    checksumText = await res.text()
  } catch (e) {
    core.info(
      `Could not fetch checksum file: ${e instanceof Error ? e.message : e}, skipping integrity verification`
    )
    return
  }

  // sha256sum format: "<hash>  <filename>"
  const expectedHash = checksumText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith(tarballName))
    .map((line) => line.split(/\s+/)[0])[0]

  if (!expectedHash) {
    core.info(
      `No checksum entry found for ${tarballName}, skipping integrity verification`
    )
    return
  }

  const actualHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(downloadPath))
    .digest('hex')

  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for ${tarballName}: expected ${expectedHash}, got ${actualHash}`
    )
  }

  core.info(`Checksum verified: ${tarballName} (sha256: ${expectedHash})`)
}

export async function run(): Promise<void> {
  try {
    await validateSubscription()

    let version: string = core.getInput('version')
    const toolFile: string = core.getInput('tool-file')

    if (toolFile) {
      const mimosaLine = fs
        .readFileSync(toolFile)
        .toString()
        .split('\n')
        .find((s) => s.includes('mimosa'))
        ?.trim()
      if (!mimosaLine) {
        core.setFailed(`Tools file ${toolFile} does not contain mimosa`)
        return
      }

      version = mimosaLine.replaceAll('mimosa', '')
    }

    version = version.replaceAll('v', '').trim()

    if (version === 'latest' || (!toolFile && !version)) {
      version = await getLatestVersion()
      console.log(`Using latest version: ${version}`)
    }

    if (!version) {
      core.setFailed(`Invalid version ${version}`)
      return
    }

    const runner = {
      os: platformMap[process.platform],
      arch: archMap[process.arch]
    }

    if (!runner.os || !runner.arch) {
      // mimosa not supported in this platform!
      core.setFailed(
        `Unsupported platform or architecture: ${process.platform} ${process.arch}`
      )
      return
    }

    // let's see if we find the tool in the cache first
    const cachedToolPath = toolCache.find('mimosa', version)
    let binaryPath = ''
    const binaryFileName = runner.os === 'windows' ? 'mimosa.exe' : 'mimosa'

    if (cachedToolPath) {
      core.addPath(cachedToolPath)
      binaryPath = path.join(cachedToolPath, binaryFileName)
    } else {
      const downloadUrl = `https://github.com/hytromo/mimosa/releases/download/v${version}/mimosa_${version}_${runner.os}_${runner.arch}.tar.gz`

      core.info(`Downloading ${downloadUrl}`)
      const downloadPath = await toolCache.downloadTool(downloadUrl)

      await verifyChecksum(downloadPath, version, runner.os, runner.arch)

      const extractPath = await toolCache.extractTar(downloadPath)
      core.info(`Extracted to ${extractPath}`)

      const binaryPathInExtract = path.join(extractPath, binaryFileName)
      fs.chmodSync(binaryPathInExtract, 0o755)

      const cachedDir = await toolCache.cacheFile(
        binaryPathInExtract,
        binaryFileName,
        'mimosa',
        version
      )
      core.addPath(cachedDir)
      core.info(`Cached at ${cachedDir} - which is also added to PATH`)

      binaryPath = path.join(cachedDir, binaryFileName)
    }

    core.setOutput('binary-path', binaryPath)

    console.log(`Installed mimosa version ${version} at ${binaryPath}`)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

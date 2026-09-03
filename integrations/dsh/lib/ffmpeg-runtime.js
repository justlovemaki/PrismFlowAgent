import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

function configurationError(message) {
  return Object.assign(new Error(message), { code: 'PRISMFLOW_FFMPEG_CONFIGURATION' })
}
function safeText(value, field) {
  const result = String(value ?? '').trim()
  if (result.length > 1_024 || /[\u0000-\u001f\u007f]/u.test(result)) throw configurationError(`${field} is invalid`)
  return result
}
function executableNames(platform, configured) {
  if (configured) {
    if (platform === 'win32' && !configured.toLowerCase().endsWith('.exe')) return [configured, `${configured}.exe`]
    return [configured]
  }
  return platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg']
}
function addPathCandidates(target, value, platform, env) {
  if (!value) return
  const path = platform === 'win32' ? win32 : posix
  if (path.isAbsolute(value)) { target.push(path.normalize(value)); return }
  if (value.includes('/') || value.includes('\\')) throw configurationError('Configured FFmpeg path must be absolute or an executable name')
  for (const directory of String(env.PATH ?? '').split(path.delimiter).map(item => item.replace(/^"|"$/gu, '').trim()).filter(Boolean)) {
    for (const name of executableNames(platform, value)) target.push(path.join(directory, name))
  }
}

export function ffmpegCandidatePaths(configured = '', options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const explicit = safeText(configured, 'Configured FFmpeg path')
  const candidates = []
  const path = platform === 'win32' ? win32 : posix
  if (explicit) addPathCandidates(candidates, explicit, platform, env)
  else {
    const fromEnvironment = safeText(env.FFMPEG_PATH, 'FFMPEG_PATH')
    if (fromEnvironment) addPathCandidates(candidates, fromEnvironment, platform, env)
    addPathCandidates(candidates, 'ffmpeg', platform, env)
    if (platform === 'win32') {
      const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
      const programFiles = env.ProgramFiles || 'C:/Program Files'
      const programFilesX86 = env['ProgramFiles(x86)'] || 'C:/Program Files (x86)'
      const chocolatey = env.ChocolateyInstall || 'C:/ProgramData/chocolatey'
      candidates.push(
        path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
        path.join(home, 'scoop', 'apps', 'ffmpeg', 'current', 'bin', 'ffmpeg.exe'),
        path.join(chocolatey, 'bin', 'ffmpeg.exe'),
        path.join(programFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'),
        path.join(programFilesX86, 'ffmpeg', 'bin', 'ffmpeg.exe'),
        path.join(local, 'ffmpeg', 'bin', 'ffmpeg.exe'),
        'C:/ffmpeg/bin/ffmpeg.exe', 'D:/ffmpeg/bin/ffmpeg.exe', 'D:/ai/ffmpeg/bin/ffmpeg.exe',
      )
    } else if (platform === 'darwin') {
      candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/local/bin/ffmpeg', '/usr/bin/ffmpeg', path.join(home, '.nix-profile', 'bin', 'ffmpeg'))
    } else {
      candidates.push('/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/bin/ffmpeg', '/snap/bin/ffmpeg', '/opt/ffmpeg/bin/ffmpeg',
        path.join(home, '.local', 'bin', 'ffmpeg'), path.join(home, '.nix-profile', 'bin', 'ffmpeg'), '/run/current-system/sw/bin/ffmpeg')
    }
  }
  return [...new Set(candidates)]
}

export async function resolveFfmpegPath(configured = '', options = {}) {
  const platform = options.platform ?? process.platform
  const candidates = ffmpegCandidatePaths(configured, options)
  const accessImpl = options.access ?? access
  for (const candidate of candidates) {
    try { await accessImpl(candidate, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK); return candidate } catch {}
  }
  const explicit = String(configured ?? '').trim()
  throw configurationError(explicit
    ? `Configured FFmpeg executable is unavailable: ${explicit}`
    : 'FFmpeg was not found automatically; configure it in the PrismFlow Dashboard or set FFMPEG_PATH')
}

export async function describeFfmpegRuntime(configured = '', options = {}) {
  try {
    return { available: true, mode: String(configured ?? '').trim() ? 'configured' : 'auto', platform: options.platform ?? process.platform,
      resolvedPath: await resolveFfmpegPath(configured, options) }
  } catch (error) {
    if (error?.code !== 'PRISMFLOW_FFMPEG_CONFIGURATION') throw error
    return { available: false, mode: String(configured ?? '').trim() ? 'configured' : 'auto', platform: options.platform ?? process.platform,
      error: String(error.message).slice(0, 2_048) }
  }
}

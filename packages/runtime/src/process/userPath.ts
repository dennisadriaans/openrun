/**
 * Augment process.env.PATH with common user-install directories so agent CLIs
 * (claude, codex, gemini, fx, …) resolve when the Node process was started from a
 * GUI / IDE without a login-shell PATH (typical on macOS Cursor, Windows
 * Explorer, Linux desktop launchers).
 *
 * Server-only — mutates process.env; spawn then shares the same PATH.
 */
import { accessSync, constants, existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** Directories where native / npm / package-manager CLIs commonly land. */
export function commonUserBinDirs(
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dirs: string[] = []

  if (platform === 'win32') {
    const localApp = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming')
    dirs.push(
      path.join(home, '.local', 'bin'),
      path.join(roaming, 'npm'),
      path.join(localApp, 'pnpm'),
      path.join(home, 'scoop', 'shims'),
      'C:\\ProgramData\\chocolatey\\bin',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\Git\\bin',
    )
  } else {
    dirs.push(
      path.join(home, '.local', 'bin'),
      path.join(home, 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.cargo', 'bin'),
      path.join(home, 'Library', 'pnpm'),
      path.join(home, '.local', 'share', 'pnpm'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    )
  }

  return dirs.filter((d) => {
    try {
      return existsSync(d)
    } catch {
      return false
    }
  })
}

/**
 * Prepend missing common user bin dirs to `process.env.PATH`.
 * Safe to call repeatedly — never duplicates entries.
 */
export function ensureProcessPathAugmented(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const delim = platform === 'win32' ? ';' : ':'
  const current = env.PATH ?? env.Path ?? ''
  const existing = new Set(
    current
      .split(delim)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => path.normalize(p)),
  )

  const missing = commonUserBinDirs(platform, home, env).filter(
    (d) => !existing.has(path.normalize(d)),
  )

  const next = missing.length > 0 ? [...missing, current].filter(Boolean).join(delim) : current
  env.PATH = next
  if (platform === 'win32') env.Path = next
  return next
}

/** File names to try for a bare binary name (Windows PATHEXT-aware). */
export function executableCandidates(
  bin: string,
  platform: NodeJS.Platform = process.platform,
  pathext: string | undefined = process.env.PATHEXT,
): string[] {
  if (platform !== 'win32') return [bin]
  if (path.extname(bin)) return [bin]
  const exts = (pathext || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)
  return [bin, ...exts.map((ext) => (ext.startsWith('.') ? bin + ext : `${bin}.${ext}`))]
}

/**
 * Walk PATH directories for an executable. More reliable than `which`/`where`
 * when PATH was just augmented in-process.
 */
export function findOnPath(
  bin: string,
  pathEnv: string = process.env.PATH ?? '',
  platform: NodeJS.Platform = process.platform,
): string {
  const delim = platform === 'win32' ? ';' : ':'
  const names = executableCandidates(bin, platform)
  for (const dir of pathEnv.split(delim)) {
    if (!dir.trim()) continue
    for (const name of names) {
      const full = path.join(dir, name)
      try {
        accessSync(full, platform === 'win32' ? constants.F_OK : constants.X_OK)
        return full
      } catch {
        // try next
      }
    }
  }
  return ''
}

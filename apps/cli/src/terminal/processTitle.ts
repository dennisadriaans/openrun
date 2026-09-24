import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'

/**
 * Names the process so terminals label the tab `openrun`, not the full
 * node + pnpm store path to bin/openrun.js.
 *
 * On Linux, `process.title` NUL-pads the rest of the original argv area, and
 * /proc/<pid>/cmdline still returns all of it. Terminals such as Ptyxis render
 * that padding as trailing spaces, which pushes the title off centre. Setting
 * the last argv byte to non-NUL is the kernel's setproctitle(3) signal: it then
 * returns the title only up to its first NUL.
 */
export function setProcessTitle(title: string): void {
  process.title = title
  if (process.platform !== 'linux') return
  try {
    const stat = readFileSync('/proc/self/stat', 'utf8')
    // Fields after the parenthesised comm start at field 3; arg_end is field 49.
    const argEnd = BigInt(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[49 - 3] ?? 0)
    if (!argEnd) return
    const mem = openSync('/proc/self/mem', 'r+')
    try {
      writeSync(mem, Buffer.from(' '), 0, 1, Number(argEnd - 1n))
    } finally {
      closeSync(mem)
    }
  } catch {
    // Cosmetic only: a locked-down /proc leaves the padded title in place.
  }
}

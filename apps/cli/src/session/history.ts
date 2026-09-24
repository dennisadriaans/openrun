import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openrunHome } from '@openrun/runtime/paths'

const HISTORY_LIMIT = 500

/** History belongs to the CLI session, including when an agent owns the terminal. */
export class CommandHistory {
  readonly commands: string[] = []
  private file = join(openrunHome(), 'cli-history.json')

  constructor() {
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (Array.isArray(saved)) {
        this.commands.push(
          ...saved
            .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
            .slice(-HISTORY_LIMIT),
        )
      }
    } catch {
      // Missing or unreadable history starts a fresh session.
    }
  }

  remember(command: string): void {
    const value = command.trim()
    if (!value || this.commands.at(-1) === value) return
    this.commands.push(value)
    if (this.commands.length > HISTORY_LIMIT) this.commands.shift()
    this.save()
  }

  /** Forget every command in place, so an open input stops completing them too. */
  clear(): void {
    this.commands.splice(0)
    this.save()
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
      writeFileSync(this.file, JSON.stringify(this.commands), { mode: 0o600 })
    } catch {
      // Keep in-memory history usable if the home directory is not writable.
    }
  }
}

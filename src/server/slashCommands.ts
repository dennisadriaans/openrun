/**
 * Discover the slash commands a runtime already has on disk.
 *
 * Each CLI keeps its custom commands as files in a well-known directory, and
 * expands `/name` itself when it sees one in a prompt. Open Run reads those
 * directories so the composer can offer what exists — it never expands
 * anything, and it never writes here.
 *
 * The layouts are the CLIs' own and can change on an upgrade, so parsing lives
 * in `lib/slashCommands.ts` (pure, tested) and this module only walks the tree.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { modelKindForBin, type RuntimeModelKind } from '../lib/models.ts'
import {
  commandNameFromPath,
  parseCommandMarkdown,
  parseCommandToml,
  type SlashCommand,
  type SlashCommandScope,
} from '../lib/slashCommands.ts'

/** A directory one CLI reads custom commands from. */
type CommandDir = {
  scope: SlashCommandScope
  dir: string
  format: 'md' | 'toml'
}

/** Files past this depth are almost certainly not commands. */
const MAX_DEPTH = 4
/** Guardrail against a user pointing a runtime at a huge tree. */
const MAX_FILES = 300

function commandDirs(kind: RuntimeModelKind, cwd: string): CommandDir[] {
  const home = homedir()
  if (kind === 'claude' || kind === 'antigravity') {
    const dirs: CommandDir[] = [
      { scope: 'user', dir: join(home, '.claude', 'commands'), format: 'md' },
    ]
    if (cwd) dirs.unshift({ scope: 'project', dir: join(cwd, '.claude', 'commands'), format: 'md' })
    return dirs
  }
  if (kind === 'codex') {
    return [{ scope: 'user', dir: join(home, '.codex', 'prompts'), format: 'md' }]
  }
  if (kind === 'gemini') {
    const dirs: CommandDir[] = [
      { scope: 'user', dir: join(home, '.gemini', 'commands'), format: 'toml' },
    ]
    if (cwd) {
      dirs.unshift({ scope: 'project', dir: join(cwd, '.gemini', 'commands'), format: 'toml' })
    }
    return dirs
  }
  return []
}

/**
 * Whether the CLI expands a custom command when it is handed one headlessly.
 *
 * Claude Code does, which is what makes an automation whose whole prompt is
 * `/review` work. For the others Open Run still offers the files it found —
 * they are really there — but says so rather than implying a guarantee.
 */
function headlessNote(kind: RuntimeModelKind, count: number): string | undefined {
  if (count === 0 || kind === 'claude') return undefined
  return 'Sent to the agent as typed — this CLI expands custom commands only if it supports them outside its interactive session.'
}

function walk(dir: string, format: 'md' | 'toml', depth: number, out: string[]): void {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walk(full, format, depth + 1, out)
      continue
    }
    if (format === 'md' && /\.(md|markdown)$/i.test(entry)) out.push(full)
    if (format === 'toml' && /\.toml$/i.test(entry)) out.push(full)
  }
}

function readCommand(file: string, dir: CommandDir): SlashCommand | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const meta = dir.format === 'toml' ? parseCommandToml(text) : parseCommandMarkdown(text)
  const name = commandNameFromPath(dir.dir, file)
  if (!name) return null
  return {
    name,
    description: meta.description,
    source: dir.scope,
    file,
    ...(meta.argumentHint ? { argumentHint: meta.argumentHint } : {}),
  }
}

export type SlashCommandListing = {
  commands: SlashCommand[]
  /** Caveat for the menu, when the CLI's headless behaviour is not a promise. */
  note?: string
}

/**
 * Custom commands for one runtime in one workspace.
 *
 * A project command shadows a personal one of the same name, matching what the
 * CLIs themselves do.
 */
export function listSlashCommands(input: { bin: string; cwd?: string }): SlashCommandListing {
  const kind = modelKindForBin(input.bin)
  const cwd = input.cwd?.trim() ? resolve(input.cwd) : ''
  const byName = new Map<string, SlashCommand>()

  for (const dir of commandDirs(kind, cwd)) {
    if (!existsSync(dir.dir)) continue
    const files: string[] = []
    walk(dir.dir, dir.format, 0, files)
    for (const file of files) {
      const command = readCommand(file, dir)
      if (command && !byName.has(command.name)) byName.set(command.name, command)
    }
  }

  const commands = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  const note = headlessNote(kind, commands.length)
  return { commands, ...(note ? { note } : {}) }
}

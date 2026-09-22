/**
 * Slash commands, of two quite different kinds.
 *
 * **File commands** are the user's own: `.claude/commands/review.md`,
 * `~/.codex/prompts/ship.md`, `.gemini/commands/fix.toml`. Open Run does not
 * expand them — it discovers them so the composer can offer them, and sends
 * `/review` to the agent as typed, which is what the CLI already understands.
 *
 * **App commands** (`/clear`, `/model`, `/effort`, …) never reach the agent.
 * They are the things an interactive CLI does for itself and a chat window has
 * to do instead, so they are handled in the browser and the turn is not sent.
 * They only make sense where there is a live conversation, which is why an
 * automation's prompt field offers file commands only.
 *
 * Browser-safe and dependency-free (`lib/` rule): the same parser runs in the
 * composer and on the server discovery path.
 */

export type SlashCommandScope = 'project' | 'user'

/** Where a command came from — drives the menu's grouping and its hint. */
export type SlashCommandSource = 'app' | SlashCommandScope

/** What an app command does locally instead of prompting the agent. */
export type SlashAppAction = 'clear' | 'model' | 'effort' | 'mcp' | 'help'

export type SlashCommand = {
  /** Without the slash. Sub-directories namespace it: `frontend:component`. */
  name: string
  description: string
  source: SlashCommandSource
  /** File that defines it, for file commands. */
  file?: string
  /** Argument shape the command's frontmatter advertises. */
  argumentHint?: string
  /** Set on app commands only. */
  action?: SlashAppAction
}

/**
 * Commands Open Run answers itself.
 *
 * Deliberately short: an interactive CLI has dozens, most of which either make
 * no sense here (`/vim`) or have a control in the composer already. What is
 * left is what a chat window cannot otherwise do.
 */
export const APP_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'clear',
    description: 'Start a new chat — this one keeps its history',
    source: 'app',
    action: 'clear',
  },
  {
    name: 'model',
    description: 'Switch model for the next turn',
    source: 'app',
    action: 'model',
    argumentHint: '<model>',
  },
  {
    name: 'effort',
    description: 'Switch thinking effort for the next turn',
    source: 'app',
    action: 'effort',
    argumentHint: '<low|medium|high>',
  },
  {
    name: 'mcp',
    description: "Edit this runtime's MCP servers — a new one is live next turn",
    source: 'app',
    action: 'mcp',
  },
  {
    name: 'help',
    description: 'List the commands you can use here',
    source: 'app',
    action: 'help',
  },
]

export type ParsedSlashInput = {
  name: string
  /** Everything after the command name, trimmed. */
  args: string
}

/**
 * Read `/name rest` out of composer text.
 *
 * Only a slash in the first column counts — a prompt that merely mentions
 * `/usr/bin` or a path is ordinary prose.
 */
export function parseSlashInput(text: string): ParsedSlashInput | null {
  if (!text.startsWith('/')) return null
  const body = text.slice(1)
  const match = body.match(/^([A-Za-z0-9_:.-]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return { name: match[1] ?? '', args: (match[2] ?? '').trim() }
}

/**
 * The word the menu should filter on, or null when the menu should be closed.
 *
 * Open while the user is still typing the command name; as soon as there is a
 * space they are writing arguments and the list is in the way.
 */
export function slashMenuQuery(text: string): string | null {
  if (!text.startsWith('/')) return null
  const body = text.slice(1)
  if (/\s/.test(body)) return null
  return body
}

function rank(command: SlashCommand, query: string): number {
  const name = command.name.toLowerCase()
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  return command.description.toLowerCase().includes(query) ? 3 : -1
}

/** Commands matching what has been typed, best match first, app commands first. */
export function matchSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.trim().toLowerCase()
  const scored = commands
    .map((command) => ({ command, score: q ? rank(command, q) : 1 }))
    .filter((entry) => entry.score >= 0)
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      sourceRank(a.command.source) - sourceRank(b.command.source) ||
      a.command.name.localeCompare(b.command.name),
  )
  return scored.map((entry) => entry.command)
}

function sourceRank(source: SlashCommandSource): number {
  if (source === 'app') return 0
  if (source === 'project') return 1
  return 2
}

export function slashSourceLabel(source: SlashCommandSource): string {
  if (source === 'app') return 'Open Run'
  if (source === 'project') return 'Project'
  return 'Personal'
}

export function findSlashCommand(
  commands: readonly SlashCommand[],
  name: string,
): SlashCommand | undefined {
  const wanted = name.trim().toLowerCase()
  return commands.find((c) => c.name.toLowerCase() === wanted)
}

/** The app command a composer submission should run instead of prompting. */
export function appCommandFor(
  commands: readonly SlashCommand[],
  text: string,
): { command: SlashCommand; args: string } | null {
  const parsed = parseSlashInput(text)
  if (!parsed) return null
  const command = findSlashCommand(commands, parsed.name)
  if (!command?.action) return null
  return { command, args: parsed.args }
}

// --- File-backed command parsing -------------------------------------------

export type CommandFileMeta = {
  description: string
  argumentHint?: string
}

/**
 * Read a markdown command file's YAML frontmatter.
 *
 * Only the two keys a menu needs are read, as plain scalars — a real YAML
 * parser would be a dependency `lib/` may not have, and no coding CLI puts
 * anything more structured in these two fields.
 */
export function parseCommandMarkdown(text: string): CommandFileMeta {
  const meta: CommandFileMeta = { description: '' }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (match?.[1]) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
      if (!kv) continue
      const key = (kv[1] ?? '').toLowerCase()
      const value = unquote((kv[2] ?? '').trim())
      if (key === 'description') meta.description = value
      if (key === 'argument-hint' || key === 'argumenthint') meta.argumentHint = value
    }
  }
  if (!meta.description) {
    const body = match ? text.slice(match[0].length) : text
    meta.description = firstProseLine(body)
  }
  return meta
}

/** Gemini keeps its commands in TOML with `description` / `prompt` keys. */
export function parseCommandToml(text: string): CommandFileMeta {
  const description = text.match(/^\s*description\s*=\s*(.+)$/m)?.[1] ?? ''
  return { description: unquote(description.trim()) }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function firstProseLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^#+\s*/, '')
    if (trimmed) return trimmed.slice(0, 120)
  }
  return ''
}

/**
 * `commands/frontend/component.md` under `commands/` → `frontend:component`,
 * the namespacing every one of these CLIs uses for sub-directories.
 */
export function commandNameFromPath(root: string, file: string): string {
  const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const rel = normalize(file).startsWith(`${normalize(root)}/`)
    ? normalize(file).slice(normalize(root).length + 1)
    : (normalize(file).split('/').pop() ?? file)
  return rel
    .replace(/\.(md|toml|markdown)$/i, '')
    .split('/')
    .filter(Boolean)
    .join(':')
}

/** Insert a picked command, leaving the caret after it ready for arguments. */
export function applySlashCommand(command: SlashCommand): string {
  return `/${command.name} `
}

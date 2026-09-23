/** Parse CLI options before connecting to a runtime or performing any work. */
export type GlobalFlags = {
  url: string
  token: string
  dryRun: boolean
  json: boolean
  yes: boolean
  limit: number
  rest: string[]
}

const ALIASES: Record<string, string> = {
  list: 'ls',
  remove: 'rm',
  whoami: 'where',
}
const COMMANDS = new Set([
  'init',
  'schedule',
  'run',
  'launch',
  'resume',
  'ls',
  'runs',
  'show',
  'review',
  'cancel',
  'now',
  'enable',
  'disable',
  'rm',
  'runtimes',
  'projects',
  'where',
  'worker',
  'integrations',
  'login',
  'api',
])
const AUTOMATION_COMMANDS = new Set(['ls', 'schedule', 'now', 'enable', 'disable', 'rm'])
const VALUE_FLAGS = new Set([
  '--url',
  '--token',
  '--limit',
  '--runtime',
  '--for',
  '--model',
  '--effort',
  '--in',
  '--workspace',
  '--name',
  '--cron',
  '--prompt',
  '--check',
  '--event',
])
const COMMAND_FLAGS: Record<string, string[]> = {
  init: ['--check'],
  schedule: [
    '--runtime',
    '--model',
    '--effort',
    '--in',
    '--workspace',
    '--name',
    '--cron',
    '--prompt',
  ],
  run: ['--runtime', '--model', '--effort', '--in', '--workspace', '--prompt'],
  launch: ['--runtime', '--model', '--effort', '--in', '--workspace', '--prompt'],
  runs: ['--limit'],
  'integrations configure': ['--runtime', '--in', '--event', '--prompt', '--name'],
}

/** Respect opaque option values and the literal-prompt delimiter even on a malformed command. */
export function requestsUnattended(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') break
    if (['--yes', '-y', '--json'].includes(arg.split('=')[0]!)) return true
    if (VALUE_FLAGS.has(arg)) i++
  }
  return false
}

export function editableCommand(argv: readonly string[]): string {
  return argv
    .map((arg) => (/^[\w./:=@-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`))
    .join(' ')
}

/** Keep authentication out of the visible editor while preserving the connection. */
export function commandCorrection(argv: readonly string[]) {
  const visible: string[] = []
  const credentials: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') {
      visible.push(...argv.slice(i))
      break
    }
    if (arg.startsWith('--token=')) credentials.push(arg)
    else if (arg === '--token' && argv[i + 1] && !argv[i + 1]!.startsWith('-'))
      credentials.push(`--token=${argv[++i]}`)
    else {
      visible.push(arg)
      if (VALUE_FLAGS.has(arg) && argv[i + 1] && !argv[i + 1]!.startsWith('-'))
        visible.push(argv[++i]!)
    }
  }
  return {
    line: editableCommand(visible),
    parse: (line: string) => [...credentials, ...splitCommandLine(line)],
  }
}

/** Read quotes and escapes for the correction prompt. Never execute a shell or expand variables. */
export function splitCommandLine(line: string): string[] {
  return commandLineTokens(line).map((token) => token.value)
}

/** Keep source offsets so natural requests can remove controls without rewriting the task. */
export function commandLineTokens(line: string): { value: string; start: number; end: number }[] {
  const words: { value: string; start: number; end: number }[] = []
  let word = ''
  let quote = ''
  let started = false
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (!started && !/\s/.test(char)) {
      start = i
      started = true
    }
    if (char === '\\' && quote !== "'") {
      if (i + 1 === line.length) throw new Error('Add a character after the trailing backslash.')
      word += line[++i]
      started = true
    } else if (quote) {
      if (char === quote) quote = ''
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) words.push({ value: word, start, end: i })
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (quote) throw new Error('Close the quoted text to continue.')
  if (started) words.push({ value: word, start, end: line.length })
  return words
}

export function readCliArgs(
  argv: readonly string[],
  interactive = false,
): {
  command: string
  help: boolean
  flags: GlobalFlags
} {
  const flags: GlobalFlags = {
    url: '',
    token: '',
    dryRun: false,
    json: false,
    yes: false,
    limit: 0,
    rest: [],
  }
  const usedOptions: string[] = []
  const positionals: string[] = []
  let help = argv.length === 0 && !interactive
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') {
      flags.rest.push(...argv.slice(i))
      break
    }
    const eq = arg.indexOf('=')
    const name = eq < 0 ? arg : arg.slice(0, eq)
    const inline = eq < 0 ? undefined : arg.slice(eq + 1)
    if (['--help', '-h', '--json', '--dry-run', '--yes', '-y'].includes(name)) {
      if (inline !== undefined) throw new Error(`${name} does not take a value.`)
      if (name === '--json') flags.json = true
      else if (name === '--yes' || name === '-y') flags.yes = true
      else if (name === '--dry-run') flags.dryRun = true
      else help = true
      continue
    }
    if (VALUE_FLAGS.has(name)) {
      const value = inline ?? argv[++i]
      if (!value?.trim() || (inline === undefined && value.startsWith('-')))
        throw new Error(`${name} needs a value. Run "openrun help" for examples.`)
      if (name === '--url') flags.url = value
      else if (name === '--token') flags.token = value
      else {
        const canonical = name === '--for' ? '--runtime' : name
        usedOptions.push(canonical)
        if (name === '--limit') {
          if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0)
            throw new Error('--limit must be a positive integer.')
          flags.limit = Number(value)
        } else {
          // Keep each value opaque, including literal --help / --json prompts.
          flags.rest.push(`${canonical}=${value}`)
        }
      }
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option "${arg}". Run "openrun help".`)
    flags.rest.push(arg)
    positionals.push(arg)
  }

  if (positionals[0] === 'help') {
    help = true
    positionals.shift()
    flags.rest.splice(flags.rest.indexOf('help'), 1)
  }
  let command = positionals.shift() ?? ''
  if (command) flags.rest.splice(flags.rest.indexOf(command), 1)
  command = ALIASES[command] ?? command
  if (command === 'automations') {
    const action = positionals.shift()
    if (action) flags.rest.splice(flags.rest.indexOf(action), 1)
    command = action ? (ALIASES[action] ?? action) : 'ls'
    if (!AUTOMATION_COMMANDS.has(command))
      throw new Error(`Unknown automations command: ${action}. Run "openrun automations --help".`)
  }
  if (!command && !help && (!interactive || flags.json || flags.yes))
    throw new Error('Choose a command. Run "openrun help".')
  if (command && !COMMANDS.has(command)) {
    flags.rest.unshift(command)
    command = 'launch'
  }

  if (help) return { command, help, flags }
  const action = positionals[0]
  if (command === 'integrations' && action) {
    flags.rest.splice(flags.rest.indexOf(action), 1)
    flags.rest.unshift(action)
  }
  const optionScope = command === 'integrations' ? `${command} ${action ?? 'list'}` : command
  for (const option of usedOptions) {
    if (!COMMAND_FLAGS[optionScope]?.includes(option)) {
      throw new Error(
        `${option} is not supported by "openrun ${optionScope}". Run "openrun ${command} --help".`,
      )
    }
  }
  if (flags.dryRun && !['schedule', 'run', 'launch', 'resume', 'api'].includes(command))
    throw new Error('--dry-run is supported by launch, resume, schedule, run and api only.')

  if (command === 'worker' && !['status', 'start', 'stop', 'logs'].includes(action ?? 'status'))
    throw new Error(`Unknown worker command: ${action}. Run "openrun worker --help".`)
  const integrationCommands = [
    'list',
    'ls',
    'providers',
    'connect',
    'configure',
    'enable',
    'disable',
    'disconnect',
  ]
  if (command === 'integrations' && !integrationCommands.includes(action ?? 'list'))
    throw new Error(`Unknown integrations command: ${action}. Run "openrun integrations --help".`)
  const maxArgs: Record<string, number> = {
    init: 1,
    ls: 0,
    runs: 0,
    runtimes: 0,
    projects: 0,
    where: 0,
    login: 0,
    show: 1,
    review: 1,
    resume: 1,
    cancel: 1,
    worker: 1,
    api: 2,
    integrations: ['list', 'ls', 'providers'].includes(action ?? 'list') ? 1 : 2,
  }
  if (command in maxArgs && (positionals.length > maxArgs[command]! || flags.rest.includes('--')))
    throw new Error(`Unexpected argument. Run "openrun ${command} --help" for usage.`)
  if (
    (!interactive || flags.json || flags.yes) &&
    ['show', 'review', 'resume', 'cancel', 'now', 'enable', 'disable', 'rm'].includes(command) &&
    !positionals.length
  ) {
    const required = ['show', 'review', 'resume', 'cancel'].includes(command)
      ? 'a run ID'
      : 'an automation name or ID'
    throw new Error(`Pass ${required}. Run "openrun ${command} --help".`)
  }
  return { command, help, flags }
}

/** Home accepts shell-style commands, but keeps a free-form task's original text. */
export function readCliLine(line: string) {
  const tokens = commandLineTokens(line)
  const argv = tokens.map((token) => token.value)
  const parsed = readCliArgs(argv, true)
  if (parsed.command === 'launch' && !parsed.help && !argv.some((word) => word.startsWith('-'))) {
    const request = argv[0] === 'launch' ? line.slice(tokens[0]!.end).trim() : line
    parsed.flags.rest = request ? [request] : []
  }
  return parsed
}

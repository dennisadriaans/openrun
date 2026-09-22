/**
 * Paint plain command output the way a terminal would.
 *
 * Two passes, in order of trust:
 *
 * 1. **The program's own colors.** Tools that keep colors on (a `--color=always`
 *    diff, vitest, cargo) emit SGR escapes; those are parsed and honoured, and
 *    every other escape sequence is dropped instead of being printed raw.
 * 2. **Heuristics**, for the far more common case of output captured without a
 *    TTY, so it arrives colorless. A line is classified (error / warning / pass
 *    / diff side / meta) and, when it is ordinary prose, URLs and file paths
 *    inside it are picked out.
 *
 * Emitted class names are paint-only: `styles.css` resolves each `term-*` class
 * to a variable that is `currentColor` by default, so a theme that wants
 * uncolored output gets it for free.
 *
 * Browser-safe and dependency-free (`lib/` rule).
 */

export type TerminalToken = {
  text: string
  className: string
}

const BASIC_COLORS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
] as const

/** CSI / OSC / two-byte escapes. Only `CSI … m` carries paint; the rest is dropped. */
const ESC = String.fromCharCode(0x1b)
const ESCAPE = new RegExp(
  `${ESC}\\[[0-9;:?]*[ -/]*[@-~]|${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`,
  'g',
)

const SGR_START = '\u001b['

type Sgr = {
  fg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
}

/** The first 16 of the 256-color cube are the ANSI slots, dim then bright. */
function slotFor(n: number): string {
  const name = BASIC_COLORS[n % 8]!
  return n < 8 ? name : `bright-${name}`
}

function emptySgr(): Sgr {
  return { fg: null, bold: false, dim: false, italic: false, underline: false }
}

function sgrClass(state: Sgr): string {
  const parts: string[] = []
  if (state.fg) parts.push(`term-${state.fg}`)
  if (state.bold) parts.push('term-bold')
  if (state.dim) parts.push('term-dim')
  if (state.italic) parts.push('term-italic')
  if (state.underline) parts.push('term-underline')
  return parts.join(' ')
}

function applySgr(state: Sgr, params: string): void {
  const codes = params
    .split(';')
    .map((p) => (p === '' ? 0 : Number.parseInt(p, 10)))
    .filter((n) => Number.isFinite(n))

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    if (code === 0) {
      const reset = emptySgr()
      state.fg = reset.fg
      state.bold = reset.bold
      state.dim = reset.dim
      state.italic = reset.italic
      state.underline = reset.underline
    } else if (code === 1) state.bold = true
    else if (code === 2) state.dim = true
    else if (code === 3) state.italic = true
    else if (code === 4) state.underline = true
    else if (code === 22) {
      state.bold = false
      state.dim = false
    } else if (code === 23) state.italic = false
    else if (code === 24) state.underline = false
    else if (code >= 30 && code <= 37) state.fg = BASIC_COLORS[code - 30]!
    else if (code >= 90 && code <= 97) state.fg = `bright-${BASIC_COLORS[code - 90]!}`
    else if (code === 39) state.fg = null
    else if (code === 38 || code === 48) {
      // Extended color: `5;n` (256) or `2;r;g;b`. Only the 16 ANSI slots map
      // onto a palette we have; the rest of the cube stays unpainted.
      const mode = codes[i + 1]
      if (mode === 5) {
        const n = codes[i + 2]
        if (code === 38) state.fg = n != null && n < 16 ? slotFor(n) : null
        i += 2
      } else if (mode === 2) {
        if (code === 38) state.fg = null
        i += 4
      }
    }
  }
}

/** Split one line into SGR-painted runs. `painted` is false when it carried none. */
function ansiTokens(line: string, state: Sgr): { tokens: TerminalToken[]; painted: boolean } {
  const tokens: TerminalToken[] = []
  let painted = false
  let last = 0

  ESCAPE.lastIndex = 0
  let match: RegExpExecArray | null
  match = ESCAPE.exec(line)
  while (match) {
    if (match.index > last) {
      tokens.push({ text: line.slice(last, match.index), className: sgrClass(state) })
    }
    last = match.index + match[0].length
    const seq = match[0]
    if (seq.startsWith(SGR_START) && seq.endsWith('m')) {
      applySgr(state, seq.slice(2, -1))
      painted = true
    }
    match = ESCAPE.exec(line)
  }
  if (last < line.length) tokens.push({ text: line.slice(last), className: sgrClass(state) })
  return { tokens, painted }
}

const LINE_RULES: ReadonlyArray<[RegExp, string]> = [
  [
    /^\s*(?:✗|✘|×|✖|✕|ERROR\b|FAIL(?:ED)?\b|error:|fatal:|panic:|Traceback |npm ERR!)/i,
    'term-error',
  ],
  [/^\s*(?:⚠|WARN(?:ING)?\b|warning:|npm WARN)/i, 'term-warn'],
  [/^\s*(?:✓|✔|√|PASS(?:ED)?\b|SUCCESS\b|Done\b)/i, 'term-ok'],
  [/^\s*(?:\$|>|#)\s/, 'term-meta'],
]

const DIFF_RULES: ReadonlyArray<[RegExp, string]> = [
  [/^(?:diff --git|index |--- |\+\+\+ |@@ )/, 'term-meta'],
  [/^\+/, 'term-add'],
  [/^-/, 'term-del'],
]

/*
 * Inline rules, tried in this order on a line no line rule claimed. Most CLI
 * output is captured without a TTY and therefore arrives with no color at all;
 * without this pass a transcript is a wall of one grey, which is the thing the
 * debug view exists to avoid. Order is load-bearing — a URL contains the
 * slashes the path branch looks for, and a JSON key is a quoted string.
 */
const INLINE = new RegExp(
  [
    /(?<url>https?:\/\/[^\s'"<>`)\]]+)/,
    /(?<jsonkey>"(?:[^"\\]|\\.)*"(?=\s*:))/,
    /(?<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/,
    /(?<path>(?:[\w.~@-]+\/)+[\w.~@-]+(?::\d+(?::\d+)?)?|[\w.~@-]+\.[A-Za-z]{1,10}:\d+(?::\d+)?)/,
    /(?<flag>(?<=^|\s)--?[A-Za-z][\w-]*)/,
    /(?<key>(?<=^|\s)[A-Za-z_][\w.-]*(?=[:=][^=]))/,
    /(?<constant>\b(?:true|false|null|undefined|nil|None|True|False|NaN)\b)/,
    /(?<num>\b\d+(?:\.\d+)?(?:ms|s|m|h|%|[KMGT]i?B|px|x)?\b)/,
  ]
    .map((part) => part.source)
    .join('|'),
  'g',
)

const INLINE_CLASS: Record<string, string> = {
  url: 'term-link',
  jsonkey: 'term-key',
  str: 'term-str',
  path: 'term-path',
  flag: 'term-flag',
  key: 'term-key',
  constant: 'term-const',
  num: 'term-num',
}

function inlineTokens(text: string, base: string): TerminalToken[] {
  const tokens: TerminalToken[] = []
  let last = 0

  INLINE.lastIndex = 0
  let match: RegExpExecArray | null
  match = INLINE.exec(text)
  while (match) {
    const groups = match.groups ?? {}
    const group = Object.keys(groups).find((name) => groups[name] != null)
    if (match.index > last) tokens.push({ text: text.slice(last, match.index), className: base })
    tokens.push({ text: match[0], className: (group ? INLINE_CLASS[group] : undefined) ?? base })
    last = match.index + match[0].length
    match = INLINE.exec(text)
  }
  if (last < text.length) tokens.push({ text: text.slice(last), className: base })
  return tokens.length > 0 ? tokens : [{ text, className: base }]
}

function classifyLine(line: string, diffMode: boolean): string {
  if (diffMode) {
    for (const [re, cls] of DIFF_RULES) if (re.test(line)) return cls
  }
  for (const [re, cls] of LINE_RULES) if (re.test(line)) return cls
  return ''
}

/**
 * A progress bar redraws itself with `\r`; only the last redraw is what the
 * user would have been looking at when the command exited.
 */
function lastFrame(line: string): string {
  const i = line.lastIndexOf('\r')
  return i < 0 ? line : line.slice(i + 1)
}

/** Tokenize command output, one token list per line. */
export function terminalOutputLines(text: string): TerminalToken[][] {
  if (!text) return [[{ text: '', className: '' }]]

  const diffMode = /^(?:diff --git |@@ )/m.test(text)
  const state = emptySgr()

  return text.split('\n').map((raw) => {
    const line = lastFrame(raw)
    const { tokens, painted } = ansiTokens(line, state)
    if (painted) return tokens

    const plain = tokens.map((tk) => tk.text).join('')
    const lineClass = classifyLine(plain, diffMode)
    if (lineClass) return [{ text: plain, className: lineClass }]
    return inlineTokens(plain, '')
  })
}

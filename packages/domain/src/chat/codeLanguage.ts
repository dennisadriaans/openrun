/**
 * Fence info string → the pieces the transcript needs to render a code block.
 *
 * Our highlighter keys off a file path (`lib/highlight.ts` → `editorTheme.ts`),
 * because that is what the diff panel has. A markdown fence only names a
 * language, so this module maps it onto a synthetic filename and pulls an
 * optional title out of the fence meta (```ts title="x.ts" / ```ts src/x.ts).
 */

const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: 'ts',
  typescriptreact: 'tsx',
  javascript: 'js',
  javascriptreact: 'jsx',
  node: 'js',
  shell: 'sh',
  bash: 'sh',
  zsh: 'sh',
  console: 'sh',
  shellsession: 'sh',
  python3: 'py',
  python: 'py',
  rust: 'rs',
  golang: 'go',
  yml: 'yaml',
  markdown: 'md',
  jsonc: 'json',
  dockerfile: 'docker',
  htm: 'html',
}

/** Extension used for the synthetic filename; the highlighter reads only this. */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
  md: 'md',
  mdx: 'mdx',
  py: 'py',
  rs: 'rs',
  sql: 'sql',
  yaml: 'yaml',
  sh: 'sh',
  go: 'go',
  rb: 'rb',
  php: 'php',
  java: 'java',
  swift: 'swift',
  kt: 'kt',
  c: 'c',
  cpp: 'cpp',
  toml: 'toml',
  docker: 'dockerfile',
  diff: 'diff',
}

/** The bare language id from a fence info string, lowercased. */
export function normalizeFenceLanguage(info: string | undefined): string {
  const first = (info ?? '').trim().split(/\s+/)[0] ?? ''
  const lang = first.replace(/^language-/, '').toLowerCase()
  if (!lang) return ''
  return LANGUAGE_ALIASES[lang] ?? lang
}

/**
 * A filename the highlighter can resolve, or an extensionless one when we have
 * no grammar for the language — `languageSupportForPath` then renders plain.
 */
export function syntheticPathForLanguage(language: string): string {
  const normalized = normalizeFenceLanguage(language)
  const ext = LANGUAGE_EXTENSIONS[normalized]
  return ext ? `snippet.${ext}` : 'snippet'
}

const FENCE_TITLE_ATTR = /(?:^|\s)(?:title|file(?:name)?)=(?:"([^"]+)"|'([^']+)'|(\S+))/i
const FENCE_FILENAME_TOKEN = /^[\w@][\w@./-]*\.[A-Za-z0-9]+$/

/** `title="x.ts"`, `file=x.ts`, or a bare filename token in the fence meta. */
export function fenceTitleFromInfo(info: string | undefined): string | null {
  const meta = (info ?? '').trim().split(/\s+/).slice(1).join(' ')
  if (!meta) return null
  const attr = FENCE_TITLE_ATTR.exec(meta)
  const title = attr?.[1] ?? attr?.[2] ?? attr?.[3]
  if (title) return title
  return meta.split(/\s+/).find((token) => FENCE_FILENAME_TOKEN.test(token)) ?? null
}

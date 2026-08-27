// Biome has no comment-length rule, so cap comments here: max 3 lines of text per block
// (delimiter-only and blank lines inside a block do not count).
import { globSync, readFileSync } from 'node:fs'

const MAX_LINES = 3

const files = globSync(['src/**/*.ts', 'src/**/*.tsx', 'scripts/**/*.ts']).filter(
  (file) => !file.endsWith('routeTree.gen.ts') && !file.startsWith('src/vendor/'),
)

type Violation = { file: string; line: number; end: number; length: number }
const violations: Violation[] = []

const isText = (raw: string) => {
  const text = raw
    .trim()
    .replace(/^\/\*+|^\/\/+|^\*+|\*\/$/g, '')
    .trim()
  return text.length > 0
}

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  let start = -1
  let end = -1
  let text = 0
  let inBlock = false

  const flush = () => {
    if (start !== -1 && text > MAX_LINES)
      violations.push({ file, line: start + 1, end: end + 1, length: text })
    start = -1
    end = -1
    text = 0
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (inBlock) {
      if (isText(line)) text++
      end = i
      if (trimmed.includes('*/')) {
        inBlock = false
        flush()
      }
      continue
    }

    if (trimmed.startsWith('/*')) {
      flush()
      start = i
      end = i
      if (isText(line)) text++
      if (!trimmed.includes('*/')) inBlock = true
      else flush()
      continue
    }

    if (trimmed.startsWith('//')) {
      if (start === -1) start = i
      end = i
      if (isText(line)) text++
      continue
    }

    flush()
  }

  flush()
}

if (violations.length > 0) {
  for (const v of violations) {
    console.error(
      `${v.file}:${v.line}-${v.end}  comment has ${v.length} lines of text (max ${MAX_LINES})`,
    )
  }
  console.error(`\n${violations.length} comment(s) exceed ${MAX_LINES} lines.`)
  process.exit(1)
}

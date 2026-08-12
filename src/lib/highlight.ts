import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight'
import type { DiffHunk, DiffLine } from './diff'
import { languageSupportForPath } from './editorTheme'

export type HighlightToken = {
  text: string
  className: string
}

const highlighter = tagHighlighter([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], class: 'hl-keyword' },
  { tag: [t.string, t.special(t.string)], class: 'hl-string' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'hl-function' },
  { tag: [t.number, t.bool], class: 'hl-number' },
  { tag: [t.comment, t.blockComment, t.lineComment], class: 'hl-comment' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], class: 'hl-constant' },
  { tag: [t.propertyName, t.attributeName], class: 'hl-parameter' },
  { tag: [t.punctuation, t.separator, t.bracket], class: 'hl-punctuation' },
  { tag: [t.typeName, t.className, t.namespace], class: 'hl-keyword' },
  { tag: [t.link, t.url], class: 'hl-link' },
  { tag: [t.heading], class: 'hl-function' },
  { tag: [t.invalid], class: 'hl-invalid' },
])

function plainLines(code: string): HighlightToken[][] {
  return code.split('\n').map((line) => [{ text: line, className: '' }])
}

/** Highlight a multi-line string; returns one token list per line. */
export function highlightLines(code: string, path: string): HighlightToken[][] {
  const support = languageSupportForPath(path)
  if (!support || !code) return plainLines(code)

  const tree = support.language.parser.parse(code)
  const lines: HighlightToken[][] = [[]]
  highlightCode(
    code,
    tree,
    highlighter,
    (text, className) => {
      lines[lines.length - 1]!.push({ text, className })
    },
    () => {
      lines.push([])
    },
  )
  return lines
}

/**
 * Highlight old/new sides of a hunk separately so deletions and additions
 * each get tokens from their own reconstructed source.
 */
export function highlightHunk(hunk: DiffHunk, path: string): Map<DiffLine, HighlightToken[]> {
  const map = new Map<DiffLine, HighlightToken[]>()
  const oldSide = hunk.lines.filter((line) => line.type !== 'add')
  const newSide = hunk.lines.filter((line) => line.type !== 'delete')

  const oldTokens = highlightLines(oldSide.map((line) => line.content).join('\n'), path)
  const newTokens = highlightLines(newSide.map((line) => line.content).join('\n'), path)

  oldSide.forEach((line, i) => {
    if (line.type === 'delete') {
      map.set(line, oldTokens[i] ?? [{ text: line.content, className: '' }])
    }
  })
  newSide.forEach((line, i) => {
    if (line.type === 'add' || line.type === 'context') {
      map.set(line, newTokens[i] ?? [{ text: line.content, className: '' }])
    }
  })

  return map
}

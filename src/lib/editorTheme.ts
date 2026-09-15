/**
 * CodeMirror theme + language wiring.
 *
 * Colors are pulled from the same `--syntax-*` custom properties the rest of
 * the app uses, so the editor matches the workspace chrome exactly.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import { languageSupportForPath } from './languageSupport.ts'

/** Editor chrome — transparent so the panel background shows through. */
export const workspaceEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--syntax-foreground)',
      fontSize: '12.5px',
      height: '100%',
    },
    '.cm-content': {
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      caretColor: 'var(--base)',
      padding: '8px 0',
    },
    '.cm-scroller': { overflow: 'auto', lineHeight: '1.6' },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--syntax-comment)',
      border: 'none',
      paddingRight: '4px',
    },
    '.cm-activeLine': { backgroundColor: 'var(--bg-luminous-quaternary)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--bg-luminous-quaternary)',
      color: 'var(--text-gray-600)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--inactive-selection-background)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--base)' },
    '.cm-searchMatch': { backgroundColor: 'var(--modified)33' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--modified)55' },
    // Merge view (diff) gutters and changed-line tints.
    '.cm-changedLine': { backgroundColor: 'var(--diffs-bg-addition-override)' },
    '.cm-deletedChunk': { backgroundColor: 'var(--diffs-bg-deletion-override)' },
    '.cm-changedText': { backgroundColor: 'var(--diffs-bg-addition-override)' },
  },
  { dark: true },
)

const workspaceHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: 'var(--syntax-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syntax-string)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: 'var(--syntax-function)',
  },
  { tag: [t.number, t.bool], color: 'var(--syntax-number)' },
  {
    tag: [t.comment, t.blockComment, t.lineComment],
    color: 'var(--syntax-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [t.constant(t.variableName), t.standard(t.variableName)],
    color: 'var(--syntax-constant)',
  },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syntax-parameter)' },
  { tag: [t.punctuation, t.separator, t.bracket], color: 'var(--syntax-punctuation)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syntax-keyword)' },
  { tag: [t.link, t.url], color: 'var(--syntax-link)', textDecoration: 'underline' },
  { tag: [t.heading], color: 'var(--syntax-function)', fontWeight: 'bold' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.invalid], color: 'var(--red)' },
])

export const workspaceSyntaxHighlighting = syntaxHighlighting(workspaceHighlight)

/** Pick a language extension from the file extension. */
export function languageForPath(path: string): Extension[] {
  const support = languageSupportForPath(path)
  return support ? [support] : []
}

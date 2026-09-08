/**
 * File extension → CodeMirror language support.
 *
 * Split out of `editorTheme.ts` so the highlighter can be reached without
 * pulling in `EditorView` and the editor chrome: `server/core.ts` tokenizes
 * snippets for clients that have no highlighter of their own.
 */
import type { LanguageSupport } from '@codemirror/language'

import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'

/** Pick a language support from the file extension. */
export function languageSupportForPath(path: string): LanguageSupport | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true })
    case 'tsx':
      return javascript({ typescript: true, jsx: true })
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript()
    case 'jsx':
      return javascript({ jsx: true })
    case 'json':
    case 'jsonc':
      return json()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return html()
    case 'md':
    case 'mdx':
    case 'markdown':
      return markdown()
    case 'py':
      return python()
    case 'rs':
      return rust()
    case 'sql':
      return sql()
    case 'yaml':
    case 'yml':
      return yaml()
    default:
      return null
  }
}

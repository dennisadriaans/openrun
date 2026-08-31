/**
 * Assistant prose in the transcript.
 *
 * GitHub-flavoured markdown via `react-markdown` (raw HTML stays off — agent
 * output is never trusted as markup), with two app-specific touches:
 * fenced code is highlighted by the same lezer highlighter the git panel uses
 * (`lib/highlight.ts`), and inline code that names a workspace file becomes a
 * button that opens it in the right panel.
 *
 * Layout is adapted from the t3code chat view (MIT, T3 Tools Inc.).
 */
import { memo, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, WrapText } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  fenceTitleFromInfo,
  normalizeFenceLanguage,
  syntheticPathForLanguage,
} from '../../lib/codeLanguage'
import { parseFilePathToken, relativeToWorkspace } from '../../lib/filePathToken'
import { highlightLines } from '../../lib/highlight'
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard'
import { FileTypeIcon } from '../FileTypeIcon'

const REMARK_PLUGINS = [remarkGfm]

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return nodeText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-luminous-tertiary)] hover:text-foreground ${
        active ? 'bg-[var(--bg-luminous-tertiary)] text-foreground' : 'text-muted-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function CodeBlock({ code, info }: { code: string; info: string | undefined }) {
  const [wrapped, setWrapped] = useState(false)
  const { copyToClipboard, isCopied } = useCopyToClipboard()
  const language = normalizeFenceLanguage(info)
  const title = fenceTitleFromInfo(info)
  const path = title ?? syntheticPathForLanguage(language)
  const lines = useMemo(() => highlightLines(code, path), [code, path])

  return (
    <div className="chat-code" data-wrap={wrapped ? 'true' : 'false'}>
      <div className="chat-code__header">
        <span className="flex min-w-0 items-center gap-1.5">
          <FileTypeIcon path={path} className="size-3.5 shrink-0" />
          <span className="truncate mono text-[11px] text-muted-foreground">
            {title ?? language ?? ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={wrapped ? 'Disable line wrap' : 'Wrap lines'}
            active={wrapped}
            onClick={() => setWrapped((value) => !value)}
          >
            <WrapText className="size-3" />
          </IconButton>
          <IconButton
            label={isCopied ? 'Copied' : 'Copy code'}
            onClick={() => void copyToClipboard(code)}
          >
            {isCopied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          </IconButton>
        </span>
      </div>
      <pre className="chat-code__body scroll-thin">
        <code>
          {lines.map((tokens, i) => (
            <span key={i} className="chat-code__line">
              {tokens.map((token, j) =>
                token.className ? (
                  <span key={j} className={token.className}>
                    {token.text}
                  </span>
                ) : (
                  <span key={j}>{token.text}</span>
                ),
              )}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function FileChip({
  path,
  line,
  label,
  onSelectFile,
}: {
  path: string
  line?: number
  label: string
  onSelectFile: (path: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelectFile(path)}
      title={line ? `${path}:${line}` : path}
      className="chat-markdown__file-chip"
    >
      <FileTypeIcon path={path} className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
      {line ? <span className="text-tier-quaternary">:{line}</span> : null}
    </button>
  )
}

export type ChatMarkdownProps = {
  text: string
  /** Opens a file in the right panel; without it, paths render as plain code. */
  onSelectFile?: (path: string) => void
  /** Trimmed off absolute agent paths so chips read repo-relative. */
  workspaceRoot?: string
  className?: string
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  onSelectFile,
  workspaceRoot,
  className,
}: ChatMarkdownProps) {
  const components = useMemo<Components>(() => {
    return {
      code({ node, className: codeClass, children, ...props }) {
        const isFence = typeof codeClass === 'string' && codeClass.includes('language-')
        if (isFence) {
          return (
            <code {...props} className={codeClass}>
              {children}
            </code>
          )
        }
        const raw = nodeText(children)
        const token = onSelectFile ? parseFilePathToken(raw) : null
        if (token && onSelectFile) {
          return (
            <FileChip
              path={token.path}
              {...(token.line === undefined ? {} : { line: token.line })}
              label={relativeToWorkspace(token.path, workspaceRoot)}
              onSelectFile={onSelectFile}
            />
          )
        }
        return <code {...props}>{children}</code>
      },
      pre({ node, children, ...props }) {
        // react-markdown hands the fence through as <pre><code class="language-x">.
        const child = Array.isArray(children) ? children[0] : children
        const childProps =
          child && typeof child === 'object' && 'props' in child
            ? (child as { props: { className?: string; children?: ReactNode } }).props
            : null
        if (!childProps) {
          return <pre {...props}>{children}</pre>
        }
        const info = childProps.className?.match(/language-([^\s]+)/)?.[1]
        return <CodeBlock code={nodeText(childProps.children).replace(/\n$/, '')} info={info} />
      },
      a({ node, href, children, ...props }) {
        const token = onSelectFile && href ? parseFilePathToken(href) : null
        if (token && onSelectFile) {
          return (
            <FileChip
              path={token.path}
              {...(token.line === undefined ? {} : { line: token.line })}
              label={nodeText(children) || relativeToWorkspace(token.path, workspaceRoot)}
              onSelectFile={onSelectFile}
            />
          )
        }
        return (
          <a {...props} href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        )
      },
      table({ node, children, ...props }) {
        return (
          <div className="chat-markdown__table scroll-thin">
            <table {...props}>{children}</table>
          </div>
        )
      },
      // Task-list checkboxes reflect the agent's own todo state — never ours
      // to toggle, so they render checked-and-frozen rather than disabled.
      input({ node: _node, type, checked, className: inputClass }) {
        if (type !== 'checkbox') return null
        return <input type="checkbox" checked={Boolean(checked)} readOnly className={inputClass} />
      },
    }
  }, [onSelectFile, workspaceRoot])

  return (
    <div className={`chat-markdown min-w-0 ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

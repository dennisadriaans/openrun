/**
 * A `<pre>` whose contents are tokenized by {@link terminalOutputLines} — the
 * program's own ANSI colors where it emitted them, heuristic ones where it did
 * not. The `term-*` classes are inert until a theme paints them.
 */
import { Fragment, useMemo } from 'react'
import { terminalOutputLines } from '../../lib/terminalOutput'

export function TerminalOutput({ text, className }: { text: string; className?: string }) {
  const lines = useMemo(() => terminalOutputLines(text), [text])

  return (
    <pre className={`term-surface ${className ?? ''}`}>
      {lines.map((tokens, i) => (
        <Fragment key={i}>
          {i > 0 ? '\n' : null}
          {tokens.map((token, j) => (
            <span key={j} className={token.className || undefined}>
              {token.text}
            </span>
          ))}
        </Fragment>
      ))}
    </pre>
  )
}

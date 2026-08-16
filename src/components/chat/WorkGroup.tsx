/**
 * A run of consecutive tool rows. Past `MAX_VISIBLE_WORK_ROWS` the oldest ones
 * hide behind a "+N previous tool calls" toggle so a long turn stays readable
 * while it streams.
 */
import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { workOverflow } from '../../lib/turnFold'

export function WorkGroup({ rows }: { rows: { id: string; node: ReactNode }[] }) {
  const [expanded, setExpanded] = useState(false)
  const { hidden, visible } = workOverflow(rows)
  const shown = expanded ? rows : visible

  return (
    <div className="space-y-px">
      {shown.map((row) => (
        <div key={row.id}>{row.node}</div>
      ))}
      {hidden.length > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[12px] leading-5 text-foreground transition-colors hover:bg-accent/20"
        >
          <ChevronDown
            className={`size-3.5 shrink-0 opacity-70 transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
          <span className="font-medium">
            {expanded
              ? 'Show fewer tool calls'
              : `+${hidden.length} previous tool call${hidden.length === 1 ? '' : 's'}`}
          </span>
        </button>
      ) : null}
    </div>
  )
}

import { ListTodo } from 'lucide-react'
import type { PlanEntry } from '../../lib/acp'
import { ChatEventShell } from './ChatEventShell'
import { useState } from 'react'

/** Agent todo list. Style via `.chat-event--plan`. */
export function PlanEvent({ plan }: { plan: PlanEntry[] }) {
  const [open, setOpen] = useState(true)
  return (
    <ChatEventShell
      kind="plan"
      title="Plan"
      icon={ListTodo}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <ul className="chat-event__plan space-y-1">
        {plan.map((entry, i) => (
          <li
            key={`${i}-${entry.content}`}
            className={`chat-event__plan-item flex items-start gap-2 text-[12px] leading-relaxed ${
              entry.status === 'completed'
                ? 'text-muted-foreground/60 line-through'
                : entry.status === 'in_progress'
                  ? 'text-foreground'
                  : 'text-muted-foreground'
            }`}
            data-plan-status={entry.status}
          >
            <span className="mt-[3px] shrink-0">
              {entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? '⟳' : '○'}
            </span>
            <span className="min-w-0">{entry.content}</span>
          </li>
        ))}
      </ul>
    </ChatEventShell>
  )
}

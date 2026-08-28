import { useState } from 'react'
import { Brain } from 'lucide-react'
import { ChatEventShell } from './ChatEventShell'
import { ActivityOrb } from './ActivityOrb'

/** Agent reasoning — collapsed by default. Style via `.chat-event--thought`. */
export function ThoughtEvent({ text, live = false }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(live)
  return (
    <ChatEventShell
      kind="thought"
      title="Thinking"
      icon={Brain}
      lead={live ? <ActivityOrb state="solving" live /> : undefined}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      {text.trim() ? (
        <div className="chat-event__thought whitespace-pre-wrap text-[12px] italic leading-relaxed text-muted-foreground/80">
          {text}
        </div>
      ) : null}
    </ChatEventShell>
  )
}

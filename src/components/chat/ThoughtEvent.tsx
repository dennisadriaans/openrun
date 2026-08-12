import { useState } from 'react'
import { Brain } from 'lucide-react'
import { ChatEventShell } from './ChatEventShell'

/** Agent reasoning — collapsed by default. Style via `.chat-event--thought`. */
export function ThoughtEvent({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <ChatEventShell
      kind="thought"
      title="Thinking"
      icon={Brain}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <div className="chat-event__thought whitespace-pre-wrap text-[12px] italic leading-relaxed text-muted-foreground/80">
        {text}
      </div>
    </ChatEventShell>
  )
}

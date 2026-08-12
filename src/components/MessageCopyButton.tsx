import { Check, Copy } from 'lucide-react'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard'

export function MessageCopyButton({ text }: { text: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard()

  if (!text.trim()) return null

  return (
    <button
      type="button"
      title={isCopied ? 'Copied!' : 'Copy to clipboard'}
      aria-label="Copy to clipboard"
      onClick={() => void copyToClipboard(text)}
      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {isCopied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
    </button>
  )
}

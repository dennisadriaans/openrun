/**
 * "What will actually run" — the resolved argv for a runtime, rendered before
 * anyone spends a run finding out. Template tokens stay neutral; tokens
 * Open Run injects (session id, model/effort, access mode, output format) are
 * tinted, and the prompt-delivery line says how the CLI receives the prompt.
 */
import { AlertTriangle, Check, Copy, Terminal } from 'lucide-react'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard'
import {
  promptDeliveryLabel,
  type CommandPreview as CommandPreviewData,
  type CommandPreviewWarningCode,
} from '../lib/commandPreview'

function ArgToken({ value, origin }: { value: string; origin: 'template' | 'agentops' }) {
  const injected = origin === 'agentops'
  return (
    <span
      title={
        injected
          ? 'Added by Open Run for this run (session, model/effort, access mode, or output format)'
          : 'From this runtime’s args template'
      }
      className={
        injected
          ? 'rounded bg-[var(--bg-quaternary)] px-1 text-tier-secondary ring-1 ring-inset ring-border'
          : 'text-tier-tertiary'
      }
    >
      {/\s/.test(value) ? JSON.stringify(value) : value}
    </span>
  )
}

export function CommandPreview({
  preview,
  error,
  isLoading,
  title = 'Command preview',
  omitWarnings,
}: {
  preview: CommandPreviewData | null | undefined
  error?: string | null
  isLoading?: boolean
  title?: string
  /** Codes the surrounding screen already surfaces (avoids saying it twice). */
  omitWarnings?: CommandPreviewWarningCode[]
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard()
  const warnings = (preview?.warnings ?? []).filter(
    (w) => !(omitWarnings ?? []).includes(w.code),
  )

  return (
    <div className="rounded-xl border border-border bg-elevated">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Terminal className="h-3.5 w-3.5 text-tier-quaternary" />
        <span className="text-ui-sm text-tier-secondary">{title}</span>
        {preview ? (
          <>
            <span className="ml-auto text-ui-sm text-tier-quaternary">
              {preview.installed ? (preview.binaryPath || 'on PATH') : 'not on PATH'}
            </span>
            <button
              type="button"
              title={isCopied ? 'Copied!' : 'Copy the command'}
              aria-label="Copy the command"
              onClick={() => void copyToClipboard(preview.commandLine)}
              className="inline-flex size-6 items-center justify-center rounded-md text-tier-quaternary transition-colors hover:bg-hover hover:text-foreground"
            >
              {isCopied ? (
                <Check className="size-3 text-success" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
          </>
        ) : null}
      </div>

      <div className="px-3 py-2.5">
        {isLoading && !preview && !error ? (
          <p className="mono text-ui-sm text-tier-quaternary">Resolving…</p>
        ) : error ? (
          <p className="text-ui-sm text-danger">{error}</p>
        ) : preview ? (
          <>
            <div className="mono flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[12.5px] leading-relaxed">
              <span className="text-foreground">{preview.bin}</span>
              {preview.args.map((arg, i) => (
                <ArgToken key={`${i}-${arg.value}`} value={arg.value} origin={arg.origin} />
              ))}
            </div>

            <p className="mt-2 text-[12px] text-tier-quaternary">
              {promptDeliveryLabel(preview.channels)}
              {preview.canResume
                ? ' · follow-ups resume this session'
                : ' · no resume (each turn is a fresh session)'}
            </p>

            {warnings.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {warnings.map((w) => (
                  <li
                    key={w.code}
                    className="flex items-start gap-1.5 text-[12px] leading-relaxed text-amber-300/90"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

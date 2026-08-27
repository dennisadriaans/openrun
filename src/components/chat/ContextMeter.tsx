/**
 * How full the agent's context window is, without a click.
 *
 * The numbers come from whatever the runtime streams about itself (see
 * `lib/turnUsage.ts`); a CLI that reports nothing renders nothing rather than
 * a zero pretending to be a measurement.
 */
import { formatTokens } from '../../lib/usage'
import {
  cachedPercent,
  contextPercent,
  contextPressure,
  isEmptyTurnUsage,
  type TurnUsage,
} from '../../lib/turnUsage'

const PRESSURE_TEXT = {
  ok: 'text-muted-foreground',
  warn: 'text-warn',
  danger: 'text-danger',
} as const

const PRESSURE_FILL = {
  ok: 'var(--accent)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
} as const

export function ContextMeter({ usage }: { usage: TurnUsage | null | undefined }) {
  if (!usage || isEmptyTurnUsage(usage)) return null

  const percent = contextPercent(usage)
  const cached = cachedPercent(usage)
  const pressure = contextPressure(usage)
  const limit = usage.contextLimit
  // The cached share is drawn dimmer inside the same bar, so the bright part
  // is what this turn actually paid for.
  const cachedWidth = limit ? Math.min(100, (usage.cacheRead / limit) * 100) : 0

  const title = [
    `Context ${formatTokens(usage.contextTokens)}${limit ? ` of ${formatTokens(limit)}` : ''}`,
    percent !== null ? `${Math.round(percent)}% full` : null,
    `${formatTokens(usage.cacheRead)} cached${cached !== null ? ` (${Math.round(cached)}%)` : ''}`,
    `${formatTokens(usage.input)} fresh input · ${formatTokens(usage.output)} output`,
    usage.model || null,
    pressure === 'danger' ? 'Nearly full — start a new chat or clear the context.' : null,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 text-ui-sm tabular-nums ${PRESSURE_TEXT[pressure]}`}
      title={title}
      aria-label={title.replace(/\n/g, '. ')}
    >
      {percent !== null ? (
        <span
          className="relative h-1.5 w-12 overflow-hidden rounded-full bg-[var(--bg-luminous-tertiary)]"
          aria-hidden
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full opacity-40"
            style={{ width: `${cachedWidth}%`, background: PRESSURE_FILL[pressure] }}
          />
          <span
            className="absolute inset-y-0 rounded-full"
            style={{
              left: `${cachedWidth}%`,
              width: `${Math.max(0, percent - cachedWidth)}%`,
              background: PRESSURE_FILL[pressure],
            }}
          />
        </span>
      ) : null}
      <span>
        {formatTokens(usage.contextTokens)}
        {limit ? `/${formatTokens(limit)}` : ' ctx'}
      </span>
      <span className="text-muted-foreground/70">·</span>
      <span title="Tokens served from cache">{formatTokens(usage.cacheRead)} cached</span>
    </div>
  )
}

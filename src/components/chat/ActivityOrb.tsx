import { ThinkingOrb, type OrbSize } from 'thinking-orbs'
import type { ActivityOrbState } from '../../lib/orbState'

export function ActivityOrb({
  state,
  live = true,
  size = 20,
  label,
}: {
  state: ActivityOrbState
  live?: boolean
  size?: OrbSize
  /** When set, the canvas announces this instead of being hidden. */
  label?: string
}) {
  return (
    <ThinkingOrb
      state={state}
      size={size}
      theme="dark"
      paused={!live}
      className="shrink-0"
      {...(label ? { 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}

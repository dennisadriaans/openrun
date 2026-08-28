import { useState } from 'react'
import { randomOrbState, type ActivityOrbState } from '../../lib/orbState'
import { ThinkingOrb, type OrbSize } from '../../vendor/thinking-orbs'

export function ActivityOrb({
  state,
  live = true,
  size = 20,
  label,
  randomize = true,
}: {
  state: ActivityOrbState
  live?: boolean
  size?: OrbSize
  /** When set, the canvas announces this instead of being hidden. */
  label?: string
  /** Off pins the orb to `state` instead of a per-mount random shape. */
  randomize?: boolean
}) {
  // picked once per mount so the shape does not flip mid-turn
  const [random] = useState(randomOrbState)
  return (
    <ThinkingOrb
      state={randomize ? random : state}
      size={size}
      theme="dark"
      paused={!live}
      className="shrink-0"
      {...(label ? { 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}

/**
 * What a paired phone is allowed to do — the one allowlist.
 *
 * Same rule-module contract as `runNowGate` / `enableGate`: the server route
 * guard (`server/mobile/auth.ts`) and the desktop Devices page both read this,
 * so the explanation a user sees on screen is the exact rule the server
 * enforces. A new mobile endpoint adds its op here or it cannot be reached.
 *
 * `scope` is stored on the device row as an opaque version tag, deliberately
 * *not* a free-form permission list: a per-device list would be a second
 * policy engine that drifts from this one. Widening what phones may do means
 * adding a new tag here and migrating devices onto it.
 *
 * Browser-safe: no `node:` imports.
 */

/**
 * Capability tier granted at pairing time.
 *
 * Tags are frozen once shipped. Widening what phones may do adds a *new* tag
 * rather than editing an old one, so a device paired months ago keeps exactly
 * the powers its owner saw on the pairing screen until they pair it again.
 */
export type MobileScope = 'control' | 'control-v2'

/** Every operation a mobile route can ask for. */
export type MobileOp =
  // Read
  | 'dashboard'
  | 'runs.startOptions'
  | 'runs.list'
  | 'runs.read'
  | 'runs.stream'
  | 'runs.diff'
  | 'runs.files'
  | 'activity.stream'
  | 'tasks.list'
  // Act on a run
  | 'runs.create'
  | 'runs.cancel'
  | 'runs.message'
  | 'approvals.answer'
  // Act on an automation
  | 'tasks.toggle'
  | 'tasks.runNow'
  // Manage this device
  | 'device.unpair'
  | 'device.push'

export const MOBILE_OPS: readonly MobileOp[] = [
  'dashboard',
  'runs.startOptions',
  'runs.list',
  'runs.read',
  'runs.stream',
  'runs.diff',
  'runs.files',
  'activity.stream',
  'tasks.list',
  'runs.create',
  'runs.cancel',
  'runs.message',
  'approvals.answer',
  'tasks.toggle',
  'tasks.runNow',
  'device.unpair',
  'device.push',
]

/**
 * Ops the original `control` tag shipped with. Written out rather than derived
 * by subtraction: a frozen tag must not quietly change shape the next time an
 * op is added to `MOBILE_OPS`.
 */
const CONTROL_OPS: readonly MobileOp[] = [
  'dashboard',
  'runs.list',
  'runs.read',
  'runs.stream',
  'runs.diff',
  'runs.files',
  'activity.stream',
  'tasks.list',
  'runs.cancel',
  'runs.message',
  'approvals.answer',
  'tasks.toggle',
  'tasks.runNow',
  'device.unpair',
  'device.push',
]

/**
 * Ops granted by each scope tag.
 *
 * `control` is monitor + review + approve + automation on/off + Run now.
 * `control-v2` adds starting a new chat in an existing workspace — the same
 * class of power `tasks.runNow` and `runs.message` already carry (spawn an
 * agent, hand it a prompt), not a new one, but a widening all the same, so it
 * rides on its own tag and a phone paired before it stays on `control` until
 * it is paired again.
 *
 * Both tiers deliberately exclude everything that edits configuration or
 * writes to a repo: a phone token travels over the LAN in cleartext, so its
 * blast radius is capped at things that are visible and reversible from the
 * desktop.
 *
 * `runs.diff` / `runs.files` are read-only by construction — they reach
 * `core.getFileDiff` / `core.listWorkspaceFiles` / `core.readWorkspaceFile` and
 * never `writeWorkspaceFile`. They do widen the token to "can read source", so
 * an untrusted network wants the https tunnel, not the LAN address.
 */
const SCOPE_OPS: Record<MobileScope, readonly MobileOp[]> = {
  control: CONTROL_OPS,
  'control-v2': MOBILE_OPS,
}

export const DEFAULT_MOBILE_SCOPE: MobileScope = 'control-v2'

/** True when `scope` is a tag this build understands. */
export function isMobileScope(value: string): value is MobileScope {
  return Object.hasOwn(SCOPE_OPS, value)
}

/**
 * The op ids a scope tag grants, for a client that needs to *feature-detect*
 * rather than read prose. The phone hides a control it may not use instead of
 * offering a button that comes back 403.
 *
 * An unrecognised tag grants nothing, same as `mobileScopeAllows`.
 */
export function mobileScopeOps(scope: string): MobileOp[] {
  if (!isMobileScope(scope)) return []
  return [...SCOPE_OPS[scope]]
}

/**
 * What a paired device is missing because it holds an older tag, or `null`
 * when it is current. Shown on the desktop Devices page so "why can't my phone
 * do that" has an answer that is not "read the source".
 */
export function mobileScopeOutdatedHint(scope: string): string | null {
  if (!isMobileScope(scope) || scope === DEFAULT_MOBILE_SCOPE) return null
  const missing = MOBILE_OPS.filter((op) => !SCOPE_OPS[scope].includes(op))
  if (missing.length === 0) return null
  return `Paired before this build. Pair it again to add: ${missing
    .map((op) => OP_LABELS[op].toLowerCase())
    .join(', ')}.`
}

/**
 * Whether a device holding `scope` may perform `op`.
 *
 * An unrecognised scope tag denies everything — a device paired by a newer
 * build must not silently gain access after a downgrade.
 */
export function mobileScopeAllows(scope: string, op: MobileOp): boolean {
  if (!isMobileScope(scope)) return false
  return SCOPE_OPS[scope].includes(op)
}

/** User-facing label per op, for the "what your phone can do" panel. */
const OP_LABELS: Record<MobileOp, string> = {
  dashboard: 'See the dashboard',
  'runs.startOptions': 'See which workspaces and runtimes can take a run',
  'runs.list': 'Browse run history',
  'runs.read': 'Read a run transcript',
  'runs.stream': 'Watch run output live',
  'runs.diff': "Review a run's diff",
  'runs.files': 'Read workspace files (read-only)',
  'activity.stream': 'Get live run activity',
  'tasks.list': 'Browse automations',
  'runs.create': 'Start a new run in an existing workspace',
  'runs.cancel': 'Cancel a running run',
  'runs.message': 'Send a chat follow-up',
  'approvals.answer': 'Allow or deny tool approvals',
  'tasks.toggle': 'Enable or disable an automation',
  'tasks.runNow': 'Trigger a run now',
  'device.unpair': 'Unpair itself',
  'device.push': 'Receive approval push notifications',
}

/**
 * Things a phone can never do, whatever its scope. Kept as prose rather than
 * derived from `MobileOp` because these ops do not exist on the mobile surface
 * at all — there is no route to name.
 */
const NEVER_ALLOWED: readonly string[] = [
  'Edit runtimes or app settings',
  'Commit, push, or open a pull request',
  'Write or delete workspace files',
  'Add, edit, or remove projects',
  'Create or edit automations',
  'Manage integrations or webhooks',
]

/**
 * Human-readable split for the desktop Devices page and the 403 body, so a
 * phone that asks for something out of scope gets the same words the desktop
 * shows.
 */
export function mobileScopeSummary(scope: string): {
  allowed: string[]
  denied: string[]
} {
  if (!isMobileScope(scope)) {
    return { allowed: [], denied: [...NEVER_ALLOWED] }
  }
  const granted = SCOPE_OPS[scope]
  return {
    allowed: granted.map((op) => OP_LABELS[op]),
    denied: [
      ...MOBILE_OPS.filter((op) => !granted.includes(op)).map((op) => OP_LABELS[op]),
      ...NEVER_ALLOWED,
    ],
  }
}

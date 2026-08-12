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

/** Capability tier granted at pairing time. */
export type MobileScope = 'control'

/** Every operation a mobile route can ask for. */
export type MobileOp =
  // Read
  | 'dashboard'
  | 'runs.list'
  | 'runs.read'
  | 'runs.stream'
  | 'runs.diff'
  | 'runs.files'
  | 'activity.stream'
  | 'tasks.list'
  // Act on a run
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
 * `control` is monitor + review + approve + automation on/off + Run now. It
 * deliberately excludes everything that edits configuration or writes to a
 * repo: a phone token travels over the LAN in cleartext, so its blast radius is
 * capped at things that are visible and reversible from the desktop.
 *
 * `runs.diff` / `runs.files` are read-only by construction — they reach
 * `core.getFileDiff` / `core.listWorkspaceFiles` / `core.readWorkspaceFile` and
 * never `writeWorkspaceFile`. They do widen the token to "can read source", so
 * an untrusted network wants the https tunnel, not the LAN address.
 */
const SCOPE_OPS: Record<MobileScope, readonly MobileOp[]> = {
  control: MOBILE_OPS,
}

export const DEFAULT_MOBILE_SCOPE: MobileScope = 'control'

/** True when `scope` is a tag this build understands. */
export function isMobileScope(value: string): value is MobileScope {
  return Object.prototype.hasOwnProperty.call(SCOPE_OPS, value)
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
  'runs.list': 'Browse run history',
  'runs.read': 'Read a run transcript',
  'runs.stream': 'Watch run output live',
  'runs.diff': "Review a run's diff",
  'runs.files': 'Read workspace files (read-only)',
  'activity.stream': 'Get live run activity',
  'tasks.list': 'Browse automations',
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

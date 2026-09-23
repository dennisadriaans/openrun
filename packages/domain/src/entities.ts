/** Persisted resource shapes shared by transports; no database dependency. */
export type RuntimeRow = {
  id: string
  label: string
  /** The binary to invoke, e.g. "claude", "codex", "grok", "fx". */
  bin: string
  /**
   * Argument template as a JSON array of tokens. Tokens support the
   * placeholders {prompt} and {cwd}. If promptViaStdin is true, omit {prompt}
   * from the args and it is piped to stdin instead.
   */
  argsTemplate: string
  promptViaStdin: number
  description: string
  enabled: number
  /**
   * 1 = this runtime is allowed to open its own pull request during a run.
   * When set, eligible runs get a prompt appendix telling the agent it may
   * branch / commit / push / `gh pr create` (see lib/prCapability.ts).
   */
  canOpenPrs: number
  /**
   * How the executor talks to this runtime: `cli` parses the binary's stdout,
   * `acp` drives it over the Agent Client Protocol. See `lib/acpTransport.ts`.
   */
  transport: string
  createdAt: number
}

export type TaskRow = {
  /** Branch/ref resolved to an immutable commit for each isolated invocation. */
  baseRef?: string
  id: string
  name: string
  description: string
  runtimeId: string
  prompt: string
  cwd: string
  /**
   * Workspace the task runs in. Empty on rows that predate workspaces, which
   * fall back to `cwd` — kept in sync with the workspace path when set.
   */
  workspaceId: string
  /** Standard 5-field cron expression, or empty string for manual-only. */
  cron: string
  enabled: number
  /** Selected model slug for runs of this task (empty = CLI default). */
  model: string
  /** Selected effort / thinking level (empty = model default). */
  effort: string
  /**
   * Optional webhook connection this automation listens on.
   * Empty = no webhook trigger. Pair with webhookEvents / webhookFilters.
   */
  webhookIntegrationId: string
  /** JSON string array of provider event ids; empty array = all events. */
  webhookEvents: string
  /** JSON WebhookFilters object. */
  webhookFilters: string
  /** 0 = skip post-run verification checks for this automation. */
  verifyEnabled: number
  /**
   * How many times a `failed-checks` run may hand the failures back to the
   * agent as a follow-up turn. 0 = never; capped by MAX_REPAIR_ATTEMPTS.
   */
  maxRepairAttempts: number
  /** Per-run wall-clock budget in ms. 0 = the app default. */
  timeoutMs: number
  /**
   * Native CLI session to resume on the first turn instead of minting
   * a new UUID. Empty = start a new conversation (the default).
   */
  resumeSessionId: string
  /** Picker title captured at save, used as the run stub. */
  resumeSessionLabel: string
  /**
   * 1 = disable the automation after the next successful scheduled fire, so a
   * wall-clock "once at 03:01" does not repeat every night.
   */
  fireOnce: number
  /** Absolute local wall-clock fire time for one-shot automations. */
  scheduledAt: number
  /**
   * 1 = scheduled / webhook fires require an app-managed worktree of their own
   * rather than the project's shared main checkout. Default on: unattended
   * runs sharing one checkout is what lets a branch switch and a broken build
   * from one automation become the next automation's starting point.
   */
  requireIsolation: number
  /**
   * 1 = refuse to arm or fire this automation unless `gh` is installed and
   * authenticated. Implied by a runtime with `canOpenPrs`; set explicitly for
   * automations that shell out to GitHub without the PR capability.
   */
  requireGhAuth: number
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
}

export type RunStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled'

export type RunRow = {
  id: string
  taskId: string | null
  taskName: string
  runtimeId: string
  trigger: 'manual' | 'schedule' | 'planner' | 'chat' | 'webhook'
  status: RunStatus
  command: string
  cwd: string
  /**
   * Workspace the run executed in. Empty on runs that predate workspaces; those
   * fall back to `cwd` throughout.
   */
  workspaceId: string
  pid: number | null
  exitCode: number | null
  stdout: string
  stderr: string
  startedAt: number
  finishedAt: number | null
  /**
   * Agent session identifier used to resume the conversation on follow-up
   * turns. For Claude we generate the UUID up front and pass --session-id; for
   * Codex we parse it out of the CLI output. Empty when the runtime has no
   * resume support (e.g. Gemini).
   */
  sessionId: string
  /** Git branch the run's cwd was on when the run started. */
  baseBranch: string
  /** Git branch the run finished on, captured before workspace reuse can change it. */
  headBranch: string
  /**
   * Immutable object-db commit of the working tree (incl. uncommitted/untracked)
   * at run start. Diffs/commits/discards for the run are scoped to the delta
   * from this snapshot. Empty on legacy runs — those fall back to HEAD.
   */
  baseSnapshot: string
  /** Selected model slug for this conversation (empty = CLI default). */
  model: string
  /** Selected effort / thinking level (empty = model default). */
  effort: string
  /**
   * Access mode for the agent CLI:
   * `approval-required` | `auto-accept-edits` | `full-access`.
   */
  runtimeMode: string
  /** Set when the user archives a run; hidden from default history lists. */
  archivedAt: number | null
  /**
   * What actually came out of the run — see lib/verdict.ts. Empty while the
   * run is live, on cancelled runs, and on rows that predate verification.
   */
  verdict: string
  /** How many repair turns this run has already spent on red checks. */
  repairAttempts: number
  /** 1 = the run was killed because it exceeded its wall-clock budget. */
  timedOut: number
  /** When the user last opened this run; agent messages after it read as unread. */
  lastReadAt: number
  /**
   * Last known pull request for the run's named head branch — cached from
   * `gh pr list --state all` so
   * the chip paints before (and without) a network round trip. `prNumber` 0
   * means "no PR seen yet"; `prState` is one of lib/pullRequest.ts's states.
   */
  prNumber: number
  prUrl: string
  prTitle: string
  prState: string
  prChecks: string
  /** JSON array of `FailingCheck`; '' on a row cached before it existed. */
  prFailingChecks: string
  /** When the cache above was last refreshed; 0 = never probed. */
  prCheckedAt: number
}

export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageRow = {
  id: string
  runId: string
  role: MessageRole
  content: string
  /** Raw stdout for this turn, kept so the log view can show the unparsed output. */
  stdout: string
  stderr: string
  status: RunStatus
  exitCode: number | null
  /** JSON array of DiffFile summaries captured after this turn finished. */
  diffSummary: string
  /** Integration this message was triggered by; empty for anything else. */
  sourceProvider: string
  /** The ticket the webhook fired for. Rendered as a badge, never prompted. */
  sourceUrl: string
  sourceLabel: string
  createdAt: number
  finishedAt: number | null
}

export type {
  TurnEventKind,
  TurnEventPayload,
  TurnEventRow,
} from './chat/turnEvents.ts'

export type ProjectRow = {
  id: string
  name: string
  slug: string
  /** Absolute path to the repo root. */
  path: string
  defaultBranch: string
  remoteUrl: string
  /** 1 = app cloned it (safe to delete), 0 = an existing local repo the user registered. */
  managed: number
  setupCommand: string
  /**
   * JSON array of CheckDef (see lib/checks.ts) — the commands that judge a run
   * in this project's worktrees. Sits next to setupCommand deliberately: setup
   * prepares a worktree, checks decide whether what came out of it is good.
   */
  checks: string
  createdAt: number
}

/**
 * A trigger that fired while its workspace was busy. Deliberately not a `runs`
 * row: nothing has been spawned yet, and the runtime/prompt are re-resolved
 * from the task when it finally starts, so a task edited while queued runs
 * with its current definition.
 */
export type RunQueueRow = {
  id: string
  taskId: string
  workspaceId: string
  trigger: string
  /** Rendered prompt for webhook fires; empty means "use the task prompt". */
  prompt: string
  /** Origin ticket of a parked webhook fire; survives the wait. */
  sourceProvider: string
  sourceUrl: string
  sourceLabel: string
  /** Schedule-fire audit row this pending run belongs to; empty for webhooks. */
  scheduleFireId: string
  queuedAt: number
}

export type ScheduleFireOutcome = 'started' | 'queued' | 'skipped' | 'failed' | 'missed'

/** Durable account of every cron/one-shot fire, including ones with no run row. */
export type ScheduleFireRow = {
  id: string
  taskId: string
  scheduledFor: number
  observedAt: number
  outcome: ScheduleFireOutcome
  runId: string
  detail: string
}

export type MessageQueueRow = {
  id: string
  runId: string
  prompt: string
  model: string
  effort: string
  runtimeMode: string
  /** Non-empty only when the queued turn also switches runtime. */
  runtimeId: string
  queuedAt: number
}

export type NotifierRow = {
  id: string
  /** 'webhook' | 'desktop' — see lib/notify.ts. */
  kind: string
  name: string
  /** Webhook URL; empty for desktop notifications. */
  target: string
  /** JSON array of RunVerdict; empty array = the needs-attention set. */
  verdicts: string
  enabled: number
  createdAt: number
  updatedAt: number
}

/**
 * A phone paired to this Open Run install.
 *
 * The bearer token itself is never persisted — only `tokenHash`. Lookup is by
 * hash on a unique index; see `server/mobile/devices.ts`.
 */
export type DeviceRow = {
  id: string
  /** User-visible label chosen on the phone, e.g. "Dennis' iPhone". */
  name: string
  /** 'ios' today; the column exists so a second client kind needs no migration. */
  platform: string
  /** SHA-256 hex of the bearer token. Never the token. */
  tokenHash: string
  /** Capability tag interpreted by lib/mobileScope.ts. */
  scope: string
  /** APNs device token, registered after pairing; empty until then. */
  pushToken: string
  /** 'sandbox' | 'production' | '' — which APNs host to send to. */
  pushEnv: string
  createdAt: number
  /** Last authenticated request, throttled to ~1/min so SSE pings do not write. */
  lastSeenAt: number | null
  /** Set when revoked from the desktop or by the device unpairing itself. */
  revokedAt: number | null
}

/**
 * A short-lived, single-use code shown on the desktop to pair a phone.
 *
 * Only the hash is stored, same reasoning as `devices.tokenHash`. Redemption
 * claims the row atomically (`UPDATE … WHERE usedAt IS NULL`) so two phones
 * racing on the same code cannot both succeed.
 */
export type DevicePairingRow = {
  id: string
  /** SHA-256 hex of the normalized code. */
  codeHash: string
  /** Scope the resulting device will be granted. */
  scope: string
  createdAt: number
  /** createdAt + PAIRING_TTL_MS; past this the code is dead. */
  expiresAt: number
  /** Set on successful redemption; non-null means spent. */
  usedAt: number | null
  /** Device minted from this code; empty until redeemed. */
  deviceId: string
}

export type NotificationDeliveryRow = {
  id: string
  notifierId: string
  runId: string
  verdict: string
  /** 'ok' | 'error'. */
  status: string
  detail: string
  sentAt: number
}

/** One check's outcome within one verification pass of a run. */
export type CheckResultRow = {
  id: string
  runId: string
  /** Assistant message whose turn this pass followed; empty on legacy rows. */
  messageId: string
  /** 0 = the first verification pass; 1+ = after that many repair turns. */
  attempt: number
  /** CheckDef.id this result came from. */
  checkId: string
  name: string
  command: string
  blocking: number
  /** 'passed' | 'failed' | 'timeout' | 'skipped' — see lib/verdict.ts. */
  outcome: string
  exitCode: number | null
  /** Tail of combined stdout+stderr, bounded by CHECK_OUTPUT_TAIL_CHARS. */
  output: string
  durationMs: number
  startedAt: number
  finishedAt: number | null
}

export type WorkspaceRow = {
  id: string
  projectId: string
  name: string
  branch: string
  /** Absolute path to the worktree (or the repo root itself when kind='main'). */
  path: string
  /** 'main' = the project's primary checkout (registered projects only); 'worktree' = an app-managed worktree. */
  kind: 'main' | 'worktree' | 'external'
  status: 'creating' | 'ready' | 'error' | 'archived'
  setupLog: string
  setupExitCode: number | null
  /**
   * Why this workspace is quarantined from unattended runs: 'run' when a
   * crashed / timed-out / red-checks run left it in an unknown state, or
   * 'baseline' when a verification pass against it went red. Empty when the
   * workspace is fit for automation. See lib/workspaceHealth.ts.
   */
  blockedKind: '' | 'run' | 'baseline'
  /** Human-readable reason paired with blockedKind. */
  blockedReason: string
  /** When the block was recorded; 0 when not blocked. */
  blockedAt: number
  /** Immutable commit the worktree was created from; empty on legacy rows. */
  baseCommit: string
  createdAt: number
  archivedAt: number | null
}

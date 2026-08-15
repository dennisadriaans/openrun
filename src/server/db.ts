/**
 * SQLite persistence layer.
 *
 * Everything is stored in a single local file (./data/agentops.db) so the whole
 * proof-of-concept is self-contained and requires no external services. This
 * module is server-only — it is never imported into client bundles (route
 * components reach it exclusively through server functions).
 */
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { dirname, resolve } from 'node:path'
import { RUNTIME_PRESETS } from '../lib/runtimePresets.ts'
import { ensureProcessPathAugmented } from './userPath.ts'

export type RuntimeRow = {
  id: string
  label: string
  /** The binary to invoke, e.g. "claude", "codex", "grok". */
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
  createdAt: number
  finishedAt: number | null
}

export type {
  TurnEventKind,
  TurnEventPayload,
  TurnEventRow,
} from '../lib/turnEvents'

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
  kind: 'main' | 'worktree'
  status: 'creating' | 'ready' | 'error' | 'archived'
  setupLog: string
  setupExitCode: number | null
  createdAt: number
  archivedAt: number | null
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Root directory for everything this app manages on disk (managed clones,
 * worktrees). Worktrees for a project always live under here rather than
 * inside the project's own repo directory — that keeps them out of the way
 * of the user's own editor/working copy and means removing a workspace never
 * risks touching files the user didn't ask us to manage.
 */
export function agentopsHome(): string {
  return process.env.AGENTOPS_HOME || path.join(os.homedir(), '.agentops')
}

/** Filesystem/URL-safe slug for project and branch directory names. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  const dbPath = resolve(process.cwd(), 'data', 'agentops.db')
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Webhook signing secrets are stored here in the
  // clear, so file permissions are the only thing protecting them from other
  // accounts on the machine. Applied after open so the file exists, and to the
  // WAL sidecars too — they hold the same rows before a checkpoint.
  // Best-effort: Windows and some network filesystems ignore POSIX modes.
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (existsSync(file)) chmodSync(file, 0o600)
    } catch {
      // Non-POSIX filesystem; documented in SECURITY.md.
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS runtimes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      bin TEXT NOT NULL,
      argsTemplate TEXT NOT NULL,
      promptViaStdin INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      runtimeId TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cwd TEXT NOT NULL,
      cron TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      model TEXT NOT NULL DEFAULT '',
      effort TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      lastRunAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      taskId TEXT,
      taskName TEXT NOT NULL,
      runtimeId TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      command TEXT NOT NULL,
      cwd TEXT NOT NULL,
      pid INTEGER,
      exitCode INTEGER,
      stdout TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      startedAt INTEGER NOT NULL,
      finishedAt INTEGER,
      sessionId TEXT NOT NULL DEFAULT '',
      baseBranch TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      stdout TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      exitCode INTEGER,
      diffSummary TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      finishedAt INTEGER,
      FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      path TEXT NOT NULL,
      defaultBranch TEXT NOT NULL DEFAULT 'main',
      remoteUrl TEXT NOT NULL DEFAULT '',
      managed INTEGER NOT NULL DEFAULT 0,
      setupCommand TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      name TEXT NOT NULL,
      branch TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'worktree',
      status TEXT NOT NULL DEFAULT 'ready',
      setupLog TEXT NOT NULL DEFAULT '',
      setupExitCode INTEGER,
      createdAt INTEGER NOT NULL,
      archivedAt INTEGER,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(taskId);
    CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(startedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_run ON messages(runId, createdAt ASC);
    CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(projectId, createdAt DESC);
  `)

  migrate(db)
  _db = db
  // GUI/IDE launches often miss login-shell PATH entries (~/.local/bin, …).
  // Do this before any runtime install checks or spawn.
  ensureProcessPathAugmented()
  seedRuntimes(db)
  ensureBuiltinRuntimeSeeds(db)
  // Reconstructs projects/workspaces from pre-workspace run/task cwds. Runs
  // once per database (see app_meta); re-running every boot would resurrect
  // projects the user deliberately deleted while historical cwds remain.
  backfillWorkspaces(db)
  return db
}

/**
 * Adds `column` to `table` if it's missing. SQLite has no "ADD COLUMN IF NOT
 * EXISTS", so we diff against table_info instead.
 */
function addColumn(db: Database.Database, table: string, column: string, ddl: string) {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
  )
  if (!cols.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
}

/**
 * Additive column migrations for databases created before a column existed.
 */
function migrate(db: Database.Database) {
  addColumn(db, 'runs', 'sessionId', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'baseBranch', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'baseSnapshot', "TEXT NOT NULL DEFAULT ''")
  // Links a run/task to its workspace row. Kept alongside cwd (not instead of
  // it) — cwd remains the source of truth for git operations, workspaceId is
  // additive metadata backfilled below for rows that predate workspaces.
  addColumn(db, 'runs', 'workspaceId', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'tasks', 'workspaceId', "TEXT NOT NULL DEFAULT ''")
  // Persist the task's picked model/effort so runs use the UI selection instead
  // of falling through to the CLI default (which is Opus for Claude).
  addColumn(db, 'tasks', 'model', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'tasks', 'effort', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'model', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'effort', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'runtimeMode', "TEXT NOT NULL DEFAULT 'full-access'")
  addColumn(db, 'runs', 'archivedAt', 'INTEGER')
  // Runtime capability: may the agent open its own PR during a run (ticket 05).
  addColumn(db, 'runtimes', 'canOpenPrs', 'INTEGER NOT NULL DEFAULT 0')
  // How we talk to the runtime. Existing rows are all stdout-parsing CLIs, and
  // the default keeps them that way — ACP is opt-in per runtime.
  addColumn(db, 'runtimes', 'transport', "TEXT NOT NULL DEFAULT 'cli'")

  // Webhook triggers on automations (integrations connections).
  addColumn(db, 'tasks', 'webhookIntegrationId', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'tasks', 'webhookEvents', "TEXT NOT NULL DEFAULT '[]'")
  addColumn(db, 'tasks', 'webhookFilters', "TEXT NOT NULL DEFAULT '{}'")

  // Verified runs: post-turn checks, the repair budget and the wall-clock cap.
  // Existing rows default to verification on with one repair attempt — the
  // checks list is per project and empty until configured, so nothing actually
  // runs until the user opts in by adding one.
  addColumn(db, 'projects', 'checks', "TEXT NOT NULL DEFAULT '[]'")
  addColumn(db, 'tasks', 'verifyEnabled', 'INTEGER NOT NULL DEFAULT 1')
  addColumn(db, 'tasks', 'maxRepairAttempts', 'INTEGER NOT NULL DEFAULT 1')
  addColumn(db, 'tasks', 'timeoutMs', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'runs', 'verdict', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'repairAttempts', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'runs', 'timedOut', 'INTEGER NOT NULL DEFAULT 0')

  db.exec(`
    CREATE TABLE IF NOT EXISTS check_results (
      id TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      messageId TEXT NOT NULL DEFAULT '',
      attempt INTEGER NOT NULL DEFAULT 0,
      checkId TEXT NOT NULL,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      blocking INTEGER NOT NULL DEFAULT 1,
      outcome TEXT NOT NULL,
      exitCode INTEGER,
      output TEXT NOT NULL DEFAULT '',
      durationMs INTEGER NOT NULL DEFAULT 0,
      startedAt INTEGER NOT NULL,
      finishedAt INTEGER,
      FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_check_results_run
      ON check_results(runId, attempt ASC, startedAt ASC);

    CREATE TABLE IF NOT EXISTS notifiers (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      verdicts TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      notifierId TEXT NOT NULL,
      runId TEXT NOT NULL,
      verdict TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      sentAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notifier
      ON notification_deliveries(notifierId, sentAt DESC);

    CREATE TABLE IF NOT EXISTS run_queue (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      workspaceId TEXT NOT NULL,
      trigger TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      queuedAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_queue_workspace
      ON run_queue(workspaceId, queuedAt ASC);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      secret TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      integrationId TEXT NOT NULL,
      deliveryKey TEXT NOT NULL,
      eventType TEXT NOT NULL,
      status TEXT NOT NULL,
      runIds TEXT NOT NULL DEFAULT '[]',
      error TEXT NOT NULL DEFAULT '',
      receivedAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_integration
      ON webhook_deliveries(integrationId, receivedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_key
      ON webhook_deliveries(integrationId, deliveryKey);
    CREATE INDEX IF NOT EXISTS idx_tasks_webhook ON tasks(webhookIntegrationId);
  `)

  // Paired mobile devices. The bearer token is never stored — only its SHA-256,
  // so a leaked database does not hand out working credentials.
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'ios',
      tokenHash TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'control',
      pushToken TEXT NOT NULL DEFAULT '',
      pushEnv TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      lastSeenAt INTEGER,
      revokedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS device_pairings (
      id TEXT PRIMARY KEY,
      codeHash TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'control',
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      usedAt INTEGER,
      deviceId TEXT NOT NULL DEFAULT ''
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_token ON devices(tokenHash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_device_pairings_code
      ON device_pairings(codeHash);
  `)

  // Grok: migrate legacy argv-prompt templates to --prompt-file + streaming-json.
  const grok = db.prepare(`SELECT argsTemplate FROM runtimes WHERE id = 'grok'`).get() as
    | { argsTemplate: string }
    | undefined
  const grokLegacy = new Set([
    JSON.stringify(['--prompt', '{prompt}']),
    JSON.stringify(['-p', '{prompt}', '--always-approve']),
  ])
  if (grok && grokLegacy.has(grok.argsTemplate)) {
    db.prepare(
      `UPDATE runtimes
       SET argsTemplate = @argsTemplate,
           promptViaStdin = 0,
           description = @description
       WHERE id = 'grok'`,
    ).run({
      argsTemplate: JSON.stringify([
        '--prompt-file',
        '{promptFile}',
        '--output-format',
        'streaming-json',
      ]),
      description:
        'xAI Grok build CLI (headless). Prompt via temp file; resume + models supported. Full-access maps to --always-approve.',
    })
  }

  // Drop runtime rows that are no longer part of the builtin seed set. Tasks
  // that still pointed at them move to Claude so Enable / Run now keep a valid
  // runtimeId.
  for (const id of ['ai' + 'der', 'shell' + '-echo'] as const) {
    db.prepare(`UPDATE tasks SET runtimeId = 'claude' WHERE runtimeId = ?`).run(id)
    db.prepare(`DELETE FROM runtimes WHERE id = ?`).run(id)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deleted_project_paths (
      path TEXT PRIMARY KEY,
      deletedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turn_events (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL,
      runId TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_turn_events_message
      ON turn_events(messageId, seq ASC);
  `)
}

function backfillId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Older databases have runs/tasks with a `cwd` but no project/workspace —
 * those tables didn't exist yet. This reconstructs projects and a `kind='main'`
 * workspace for each distinct cwd that turns out to be a git repo, then links
 * the existing rows to it via workspaceId.
 *
 * One-shot: after a successful pass we set `backfill_workspaces_v1` in
 * app_meta so intentional project deletes are not undone on the next boot /
 * HMR reload. Paths in `deleted_project_paths` are always skipped.
 *
 * Deliberately non-destructive: it only INSERTs new projects/workspaces and
 * UPDATEs the workspaceId column. The whole body is wrapped in try/catch so a
 * missing directory or missing `git` binary can never break app startup.
 */
function backfillWorkspaces(db: Database.Database) {
  try {
    const done = db
      .prepare("SELECT value FROM app_meta WHERE key = 'backfill_workspaces_v1'")
      .get() as { value: string } | undefined
    if (done?.value === '1') return

    const cwds = new Set<string>()
    for (const row of db.prepare("SELECT DISTINCT cwd FROM tasks WHERE cwd != ''").all() as Array<{
      cwd: string
    }>) {
      cwds.add(row.cwd)
    }
    for (const row of db.prepare("SELECT DISTINCT cwd FROM runs WHERE cwd != ''").all() as Array<{
      cwd: string
    }>) {
      cwds.add(row.cwd)
    }
    if (cwds.size === 0) {
      db.prepare(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('backfill_workspaces_v1', '1')",
      ).run()
      return
    }

    const excludedPaths = new Set(
      (db.prepare('SELECT path FROM deleted_project_paths').all() as Array<{ path: string }>).map(
        (r) => r.path,
      ),
    )

    const existingWorkspacePaths = new Set(
      (db.prepare('SELECT path FROM workspaces').all() as Array<{ path: string }>).map(
        (w) => w.path,
      ),
    )
    const projectByPath = new Map(
      (
        db.prepare('SELECT id, path FROM projects').all() as Array<{ id: string; path: string }>
      ).map((p) => [p.path, p.id] as const),
    )
    const mainWorkspaceByProject = new Set(
      (
        db.prepare("SELECT projectId FROM workspaces WHERE kind = 'main'").all() as Array<{
          projectId: string
        }>
      ).map((w) => w.projectId),
    )

    const insertProject = db.prepare(
      `INSERT INTO projects (id, name, slug, path, defaultBranch, remoteUrl, managed, setupCommand, createdAt)
       VALUES (@id, @name, @slug, @path, @defaultBranch, @remoteUrl, 0, '', @createdAt)`,
    )
    const insertWorkspace = db.prepare(
      `INSERT INTO workspaces (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
       VALUES (@id, @projectId, 'main checkout', @branch, @path, 'main', 'ready', '', NULL, @createdAt, NULL)`,
    )
    const updateTasks = db.prepare('UPDATE tasks SET workspaceId = @workspaceId WHERE cwd = @cwd')
    const updateRuns = db.prepare('UPDATE runs SET workspaceId = @workspaceId WHERE cwd = @cwd')

    for (const cwd of cwds) {
      if (existingWorkspacePaths.has(cwd)) continue
      if (!existsSync(cwd)) continue

      const toplevel = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
      })
      if (toplevel.status !== 0) continue // not a git repo — nothing to back-fill
      const repoRoot = toplevel.stdout.trim()
      if (!repoRoot) continue
      if (excludedPaths.has(repoRoot) || excludedPaths.has(cwd)) continue

      // Dedupe: reuse a project already keyed to this resolved toplevel,
      // whether it pre-existed in the DB or was just created earlier in this
      // same backfill pass (multiple distinct cwds can resolve to one repo).
      let projectId = projectByPath.get(repoRoot)
      if (!projectId) {
        const branchRes = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: repoRoot,
          encoding: 'utf8',
        })
        const defaultBranch = branchRes.status === 0 ? branchRes.stdout.trim() || 'main' : 'main'

        const remoteRes = spawnSync('git', ['remote', 'get-url', 'origin'], {
          cwd: repoRoot,
          encoding: 'utf8',
        })
        const remoteUrlValue = remoteRes.status === 0 ? remoteRes.stdout.trim() : ''

        const name = path.basename(repoRoot)
        projectId = backfillId('proj')
        insertProject.run({
          id: projectId,
          name,
          slug: slugify(name),
          path: repoRoot,
          defaultBranch,
          remoteUrl: remoteUrlValue,
          createdAt: Date.now(),
        })
        projectByPath.set(repoRoot, projectId)
      }

      // Only the toplevel itself gets the 'main' workspace (one per project);
      // a cwd that's a subdirectory of the repo just links below, via the
      // project's existing main workspace.
      if (repoRoot === cwd && !mainWorkspaceByProject.has(projectId)) {
        const branchRes = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: repoRoot,
          encoding: 'utf8',
        })
        const branch = branchRes.status === 0 ? branchRes.stdout.trim() || 'main' : 'main'
        const workspaceId = backfillId('ws')
        insertWorkspace.run({
          id: workspaceId,
          projectId,
          branch,
          path: repoRoot,
          createdAt: Date.now(),
        })
        mainWorkspaceByProject.add(projectId)
        existingWorkspacePaths.add(repoRoot)
        updateTasks.run({ workspaceId, cwd })
        updateRuns.run({ workspaceId, cwd })
        continue
      }

      // cwd is inside the repo but not the toplevel (e.g. a subdirectory) —
      // link it to the project's main workspace if one exists.
      const mainWs = db
        .prepare("SELECT id FROM workspaces WHERE projectId = @projectId AND kind = 'main'")
        .get({ projectId }) as { id: string } | undefined
      if (mainWs) {
        updateTasks.run({ workspaceId: mainWs.id, cwd })
        updateRuns.run({ workspaceId: mainWs.id, cwd })
      }
    }

    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('backfill_workspaces_v1', '1')",
    ).run()
  } catch {
    // Backfill is best-effort convenience metadata — never let it block boot.
  }
}

/** Remember a path so boot backfill will not recreate a deleted project. */
export function rememberDeletedProjectPath(projectPath: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO deleted_project_paths (path, deletedAt) VALUES (?, ?)')
    .run(projectPath, Date.now())
}

/** Allow an explicitly re-added project path to be registered again. */
export function forgetDeletedProjectPath(projectPath: string): void {
  getDb().prepare('DELETE FROM deleted_project_paths WHERE path = ?').run(projectPath)
}

/** Map gallery presets → DB seed rows (canOpenPrs stays at column default 0). */
function builtinRuntimeSeeds(): Array<Omit<RuntimeRow, 'createdAt' | 'canOpenPrs'>> {
  return RUNTIME_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    bin: p.bin,
    argsTemplate: JSON.stringify(p.argsTemplate),
    promptViaStdin: p.promptViaStdin ? 1 : 0,
    description: p.description,
    enabled: 1,
    transport: p.transport ?? 'cli',
  }))
}

/**
 * Default local CLI runtimes. Only seeds an empty table — existing DBs keep
 * user edits; missing builtins are filled by ensureBuiltinRuntimeSeeds().
 */
function seedRuntimes(db: Database.Database) {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM runtimes').get() as { n: number }).n
  if (count > 0) return

  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO runtimes (id, label, bin, argsTemplate, promptViaStdin, description, enabled, transport, createdAt)
     VALUES (@id, @label, @bin, @argsTemplate, @promptViaStdin, @description, @enabled, @transport, @createdAt)`,
  )

  // canOpenPrs is omitted here — it falls back to the column's DEFAULT 0, so
  // seeded runtimes ship without PR-opening rights until a user opts in.
  const tx = db.transaction(() => {
    for (const r of builtinRuntimeSeeds()) insert.run({ ...r, createdAt: now })
  })
  tx()
}

/**
 * Insert any missing builtin presets so older DBs (e.g. ones that only got
 * Gemini after a partial seed) pick up Claude / Codex / Grok without wiping
 * user-edited rows. Presets on the Runtimes page cover the same templates
 * for manual add.
 */
function ensureBuiltinRuntimeSeeds(db: Database.Database) {
  const now = Date.now()
  const exists = db.prepare('SELECT 1 AS ok FROM runtimes WHERE id = ?')
  const insert = db.prepare(
    `INSERT INTO runtimes (id, label, bin, argsTemplate, promptViaStdin, description, enabled, transport, createdAt)
     VALUES (@id, @label, @bin, @argsTemplate, @promptViaStdin, @description, @enabled, @transport, @createdAt)`,
  )

  const tx = db.transaction(() => {
    for (const r of builtinRuntimeSeeds()) {
      if (exists.get(r.id)) continue
      insert.run({ ...r, createdAt: now })
    }
  })
  tx()
}

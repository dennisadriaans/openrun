/**
 * SQLite persistence layer.
 *
 * App state (runs, automations, projects) lives in `~/.openrun/openrun.db`,
 * next to the wrapping key and managed clones — one machine, one dataset,
 * regardless of which checkout you boot from. `OPENRUN_HOME` relocates the
 * whole directory. This module is server-only — it is never imported into
 * client bundles (route components reach it exclusively through server
 * functions).
 */
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import * as path from 'node:path'
import { openrunHome } from '../paths.ts'
export { openrunHome } from '../paths.ts'
import { RUNTIME_PRESETS } from '@openrun/domain/runtimes/runtimePresets'
import { ensureProcessPathAugmented } from '../process/userPath.ts'

import type { RuntimeRow } from '@openrun/domain/entities'
export type * from '@openrun/domain/entities'

// Paths
// ---------------------------------------------------------------------------

/**
 * Root directory for everything this app manages on disk (the database,
 * wrapping key, managed clones, worktrees). Worktrees for a project always
 * live under here rather than inside the project's own repo directory — that
 * keeps them out of the way of the user's own editor/working copy and means
 * removing a workspace never risks touching files the user didn't ask us to
 * manage.
 */

export function openrunDbPath(): string {
  return path.join(openrunHome(), 'openrun.db')
}

/** Filesystem/URL-safe slug for project and branch directory names. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const DB_SIDECARS = ['-wal', '-shm'] as const

type DatabaseCounts = {
  runtimes: number
  projects: number
  runs: number
  tasks: number
}

function databaseCounts(file: string): DatabaseCounts | null {
  let probe: Database.Database | null = null
  try {
    probe = new Database(file, { readonly: true, fileMustExist: true })
    const counted = (table: string): number => {
      const row = probe!
        .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table) as { n: number }
      if (row.n === 0) return 0
      return (probe!.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    }
    return {
      runtimes: counted('runtimes'),
      projects: counted('projects'),
      runs: counted('runs'),
      tasks: counted('tasks'),
    }
  } catch {
    return null
  } finally {
    try {
      probe?.close()
    } catch {
      // Nothing to do; we only ever read.
    }
  }
}

/**
 * True when `file` is a SQLite database that no one ever finished setting up.
 *
 * A healthy boot seeds `runtimes` from `RUNTIME_PRESETS`, so an openable file
 * with no runtimes and no projects is the residue of a process that died
 * partway through `getDb()` — not something worth keeping.
 */
function isAbandonedDatabase(file: string): boolean {
  const counts = databaseCounts(file)
  if (!counts) return true
  return counts.runtimes === 0 && counts.projects === 0
}

/** Seeded presets only — never used for a project, automation, or run. */
function isUnusedInstall(file: string): boolean {
  const counts = databaseCounts(file)
  if (!counts) return true
  return counts.projects === 0 && counts.runs === 0 && counts.tasks === 0
}

function moveWithSidecars(from: string, to: string): void {
  renameSync(from, to)
  for (const suffix of DB_SIDECARS) {
    if (existsSync(from + suffix)) renameSync(from + suffix, to + suffix)
  }
}

/**
 * Move `legacy` onto `next`, once.
 *
 * A read-only fallback ("use the old file if the new one is absent") is a
 * one-way trap: anything that creates an empty `openrun.db` — a build served
 * from a stale cwd, a boot killed mid-migration — permanently hides a
 * database full of real projects and runs, and the app comes up looking
 * factory-reset. So move the file instead of reading past it, and refuse to
 * let an abandoned stub shadow a legacy DB that still has data.
 */
function adoptLegacyDatabase(next: string, legacy: string): string {
  if (!existsSync(legacy)) return next

  if (existsSync(next)) {
    const nextYields =
      isAbandonedDatabase(next) || (isUnusedInstall(next) && !isUnusedInstall(legacy))
    if (!nextYields) return next
    try {
      moveWithSidecars(next, `${next}.abandoned-${Date.now()}`)
    } catch {
      return next
    }
  }

  try {
    moveWithSidecars(legacy, next)
  } catch {
    // Could not migrate (permissions, open handle) — keep serving the old file
    // rather than silently starting empty.
    return legacy
  }
  return next
}

/**
 * Canonical path, adopting a leftover checkout database if we have never
 * written one under `OPENRUN_HOME`.
 *
 * Older builds stored `data/openrun.db` (and before that `data/agentops.db`)
 * next to the process cwd, so each git worktree looked empty. First boot
 * after the move picks that file up rather than starting from scratch.
 */
function resolveDatabasePath(): string {
  const home = openrunHome()
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 })

  const next = openrunDbPath()
  const cwdNext = path.resolve(process.cwd(), 'data', 'openrun.db')
  const cwdLegacy = path.resolve(process.cwd(), 'data', 'agentops.db')
  const fromCwd = existsSync(cwdNext) ? cwdNext : cwdLegacy
  return adoptLegacyDatabase(next, fromCwd)
}

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  const dbPath = resolveDatabasePath()

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Prompts, run output, and device tokens are stored here in the clear, so
  // file permissions are the only thing protecting them from other accounts on
  // the machine. Applied after open so the file exists, and to the
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
      baseBranch TEXT NOT NULL DEFAULT '',
      headBranch TEXT NOT NULL DEFAULT ''
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
      blockedKind TEXT NOT NULL DEFAULT '',
      blockedReason TEXT NOT NULL DEFAULT '',
      blockedAt INTEGER NOT NULL DEFAULT 0,
      baseCommit TEXT NOT NULL DEFAULT '',
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

export function closeDb(): void {
  if (!_db) return
  try {
    _db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {}
  _db.close()
  _db = null
}

/**
 * Adds `column` to `table` if it's missing. SQLite has no "ADD COLUMN IF NOT
 * EXISTS", so we diff against table_info instead.
 */
function addColumn(db: Database.Database, table: string, column: string, ddl: string): boolean {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  // A table created further down this same migration does not exist yet on a
  // fresh database, and `table_info` answers with an empty list rather than an
  // error — so without this the ALTER below throws and first boot dies.
  if (info.length === 0) return false
  const cols = new Set(info.map((c) => c.name))
  if (cols.has(column)) return false
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  return true
}

/**
 * Additive column migrations for databases created before a column existed.
 */
function migrate(db: Database.Database) {
  // Schema creation runs first: the data migrations below write into these
  // tables (deleted_runtime_ids among them), and on a fresh database they do
  // not exist yet unless they are created up front.
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deleted_project_paths (
      path TEXT PRIMARY KEY,
      deletedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deleted_runtime_ids (
      id TEXT PRIMARY KEY,
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
    CREATE INDEX IF NOT EXISTS idx_turn_events_run
      ON turn_events(runId, createdAt ASC, seq ASC);
    -- Models the installed CLIs actually offer, discovered in the background so
    -- the composer never pays for it. The fingerprint identifies the binary the
    -- rows came from; a mismatch is what schedules the next refresh. Pure
    -- cache: safe to delete, rebuilt on the next boot.
    CREATE TABLE IF NOT EXISTS model_catalog (
      kind TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      models TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    -- One row per CLI history file we have already totalled up, so the Usage
    -- page re-reads only what changed since the last scan. version bumps
    -- when the parser or the price table changes. Pure cache: safe to delete.
    -- OAuth for a hosted MCP server, run by Open Run instead of by each CLI.
    -- The vendors publish RFC 9728/8414 metadata and accept dynamic client
    -- registration, so there is no vendor secret here: 'clientId' is one we
    -- registered ourselves. Access, refresh, clientSecret and pendingVerifier
    -- are AES-GCM sealed with ~/.openrun/data-key, which is not in this file.
    -- The access token is copied into every CLI config as an Authorization
    -- header, which is also why refreshing it rewrites those files.
    -- 'pendingState'/'pendingVerifier' hold one PKCE flow in progress and are
    -- cleared the moment it lands.
    CREATE TABLE IF NOT EXISTS mcp_oauth (
      name TEXT PRIMARY KEY,
      resource TEXT NOT NULL,
      issuer TEXT NOT NULL,
      authorizationEndpoint TEXT NOT NULL,
      tokenEndpoint TEXT NOT NULL,
      registrationEndpoint TEXT NOT NULL DEFAULT '',
      revocationEndpoint TEXT NOT NULL DEFAULT '',
      clientId TEXT NOT NULL DEFAULT '',
      clientSecret TEXT NOT NULL DEFAULT '',
      redirectUri TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT '',
      accessToken TEXT NOT NULL DEFAULT '',
      refreshToken TEXT NOT NULL DEFAULT '',
      expiresAt INTEGER NOT NULL DEFAULT 0,
      pendingState TEXT NOT NULL DEFAULT '',
      pendingVerifier TEXT NOT NULL DEFAULT '',
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_file_cache (
      path TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtimeMs INTEGER NOT NULL,
      version INTEGER NOT NULL,
      stats TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );
  `)

  addColumn(db, 'runs', 'sessionId', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'baseBranch', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'headBranch', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'baseSnapshot', "TEXT NOT NULL DEFAULT ''")
  // Links a run/task to its workspace row. Kept alongside cwd (not instead of
  // it) — cwd remains the source of truth for git operations, workspaceId is
  // additive metadata backfilled below for rows that predate workspaces.
  addColumn(db, 'runs', 'workspaceId', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'tasks', 'workspaceId', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'tasks', 'baseRef', "TEXT NOT NULL DEFAULT ''")
  // Execution ownership is independent of workspace inventory and survives
  // deleting run history. Orphan results must remain recoverable.
  db.exec(`CREATE TABLE IF NOT EXISTS run_environments (
    runId TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    repoPath TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    baseRef TEXT NOT NULL,
    baseCommit TEXT NOT NULL,
    branch TEXT NOT NULL,
    gitDir TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'creating',
    resultCommit TEXT NOT NULL DEFAULT '',
    resultView TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    setupLog TEXT NOT NULL DEFAULT '',
    createdAt INTEGER NOT NULL
  )`)
  // A shipped automation run whose pull request is watched until it is green
  // and mergeable. The row is the watch: it is deleted when the watch ends.
  db.exec(`CREATE TABLE IF NOT EXISTS pr_watches (
    runId TEXT PRIMARY KEY,
    prNumber INTEGER NOT NULL,
    prUrl TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    repairedSha TEXT NOT NULL DEFAULT '',
    activityAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
  )`)
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
  addColumn(db, 'run_environments', 'setupArtifacts', "TEXT NOT NULL DEFAULT '{}'")
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

  // Unread markers on the runs list. Existing rows are backfilled to "now" so
  // upgrading does not light up every historical run as unread.
  if (addColumn(db, 'runs', 'lastReadAt', 'INTEGER NOT NULL DEFAULT 0')) {
    db.prepare('UPDATE runs SET lastReadAt = ?').run(Date.now())
  }

  // Cached pull request for a run's branch (opened by the user or by the agent).
  addColumn(db, 'runs', 'prNumber', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'runs', 'prUrl', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'prTitle', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'prState', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'prChecks', "TEXT NOT NULL DEFAULT ''")
  // JSON array of the red checks, so "Fix CI" can name them without a
  // second gh round trip. Rows written before this simply have '[]'.
  addColumn(db, 'runs', 'prFailingChecks', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'runs', 'prCheckedAt', 'INTEGER NOT NULL DEFAULT 0')

  addColumn(db, 'tasks', 'resumeSessionId', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'tasks', 'resumeSessionLabel', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'tasks', 'fireOnce', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'tasks', 'scheduledAt', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'tasks', 'requireIsolation', 'INTEGER NOT NULL DEFAULT 1')
  addColumn(db, 'tasks', 'requireGhAuth', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'workspaces', 'blockedKind', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'workspaces', 'blockedReason', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'workspaces', 'blockedAt', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'workspaces', 'baseCommit', "TEXT NOT NULL DEFAULT ''")

  // Where a webhook-triggered message came from. Held beside the message
  // rather than inside it so the link never reaches the agent's prompt.
  // Live token accounting for the turn, as the CLI last reported it.
  addColumn(db, 'messages', 'sourceProvider', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'messages', 'sourceUrl', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'messages', 'sourceLabel', "TEXT NOT NULL DEFAULT ''")

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

    CREATE TABLE IF NOT EXISTS schedule_fires (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      scheduledFor INTEGER NOT NULL,
      observedAt INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      runId TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_schedule_fires_task
      ON schedule_fires(taskId, observedAt DESC);

    -- Follow-ups typed while the agent was still working. Each becomes its own
    -- turn when the queue drains; see server/messageQueue.ts.
    CREATE TABLE IF NOT EXISTS message_queue (
      id TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      effort TEXT NOT NULL DEFAULT '',
      runtimeMode TEXT NOT NULL DEFAULT '',
      runtimeId TEXT NOT NULL DEFAULT '',
      queuedAt INTEGER NOT NULL,
      FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_message_queue_run
      ON message_queue(runId, queuedAt ASC);
  `)

  // After the table exists: on a fresh database `run_queue` is created above,
  // and on an upgraded one these are the columns it is missing.
  addColumn(db, 'run_queue', 'sourceProvider', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'run_queue', 'sourceUrl', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'run_queue', 'sourceLabel', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'run_queue', 'scheduleFireId', "TEXT NOT NULL DEFAULT ''")

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

  // Antigravity: agy's `-p` takes the prompt on argv; flags must precede it.
  const antigravity = db
    .prepare(`SELECT argsTemplate FROM runtimes WHERE id = 'antigravity'`)
    .get() as { argsTemplate: string } | undefined
  const antigravityLegacy = new Set([
    JSON.stringify(['-p', '--output-format', 'stream-json', '--dangerously-skip-permissions']),
  ])
  if (antigravity && antigravityLegacy.has(antigravity.argsTemplate)) {
    db.prepare(
      `UPDATE runtimes
       SET argsTemplate = @argsTemplate,
           promptViaStdin = 0
       WHERE id = 'antigravity'`,
    ).run({
      argsTemplate: JSON.stringify([
        '--output-format',
        'stream-json',
        '--dangerously-skip-permissions',
        '-p',
        '{prompt}',
      ]),
    })
  }

  // Drop runtime rows that are no longer part of the builtin seed set. Tasks
  // that still pointed at them move to Claude so Enable / Run now keep a valid
  // runtimeId.
  for (const id of ['ai' + 'der', 'shell' + '-echo', 'gemini', 'gemini-acp'] as const) {
    db.prepare(`UPDATE tasks SET runtimeId = 'claude' WHERE runtimeId = ?`).run(id)
    db.prepare(`DELETE FROM runtimes WHERE id = ?`).run(id)
    db.prepare(`INSERT OR REPLACE INTO deleted_runtime_ids (id, deletedAt) VALUES (?, ?)`).run(
      id,
      Date.now(),
    )
  }
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

/** Remember a builtin id so boot seed will not recreate a deleted runtime. */
export function rememberDeletedRuntimeId(runtimeId: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO deleted_runtime_ids (id, deletedAt) VALUES (?, ?)')
    .run(runtimeId, Date.now())
}

/** Allow an explicitly re-added runtime id to be seeded / saved again. */
export function forgetDeletedRuntimeId(runtimeId: string): void {
  getDb().prepare('DELETE FROM deleted_runtime_ids WHERE id = ?').run(runtimeId)
}

function deletedRuntimeIdSet(db: Database.Database): Set<string> {
  return new Set(
    (db.prepare('SELECT id FROM deleted_runtime_ids').all() as Array<{ id: string }>).map(
      (row) => row.id,
    ),
  )
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
  const deleted = deletedRuntimeIdSet(db)
  const tx = db.transaction(() => {
    for (const r of builtinRuntimeSeeds()) {
      if (deleted.has(r.id)) continue
      insert.run({ ...r, createdAt: now })
    }
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

  const deleted = deletedRuntimeIdSet(db)
  const tx = db.transaction(() => {
    for (const r of builtinRuntimeSeeds()) {
      if (exists.get(r.id) || deleted.has(r.id)) continue
      insert.run({ ...r, createdAt: now })
    }
  })
  tx()
}

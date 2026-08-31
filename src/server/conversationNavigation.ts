import { runListTitle } from '../lib/runPreview'
import { getDb } from './db'

export type ConversationNavigationRun = {
  id: string
  chatTitle: string
  runtimeId: string
  runtimeLabel: string
  startedAt: number
  workspaceId: string
  workspaceBranch: string
  projectId: string
  projectName: string
  unread: boolean
}

export function listConversationNavigationRuns(): ConversationNavigationRun[] {
  const db = getDb()
  const labels = new Map(
    (
      db.prepare('SELECT id, label FROM runtimes').all() as Array<{ id: string; label: string }>
    ).map((row) => [row.id, row.label] as const),
  )
  const rows = db
    .prepare(
      `SELECT r.id, r.runtimeId, r.trigger, r.taskName, r.startedAt, r.workspaceId,
              r.lastReadAt, w.branch AS workspaceBranch, w.projectId,
              p.name AS projectName,
              (SELECT content FROM messages
               WHERE runId = r.id AND role = 'user'
               ORDER BY createdAt ASC LIMIT 1) AS firstPrompt,
              (SELECT MAX(createdAt) FROM messages
               WHERE runId = r.id AND role = 'assistant') AS lastAgentAt
       FROM runs r
       LEFT JOIN workspaces w ON w.id = r.workspaceId
       LEFT JOIN projects p ON p.id = w.projectId
       WHERE r.archivedAt IS NULL
       ORDER BY r.startedAt DESC`,
    )
    .all() as Array<{
    id: string
    runtimeId: string
    trigger: string
    taskName: string | null
    startedAt: number
    workspaceId: string
    lastReadAt: number
    workspaceBranch: string | null
    projectId: string | null
    projectName: string | null
    firstPrompt: string | null
    lastAgentAt: number | null
  }>

  return rows.map((row) => ({
    id: row.id,
    chatTitle: runListTitle({
      trigger: row.trigger,
      taskName: row.taskName ?? '',
      prompt: row.firstPrompt ?? '',
    }),
    runtimeId: row.runtimeId,
    runtimeLabel: labels.get(row.runtimeId) ?? row.runtimeId,
    startedAt: row.startedAt,
    workspaceId: row.workspaceId,
    workspaceBranch: row.workspaceBranch ?? '',
    projectId: row.projectId ?? '',
    projectName: row.projectName ?? '',
    unread: (row.lastAgentAt ?? 0) > row.lastReadAt,
  }))
}

export function getLatestRunForProject(projectId: string): { id: string } | null {
  const row = getDb()
    .prepare(
      `SELECT r.id FROM runs r
       JOIN workspaces w ON w.id = r.workspaceId
       WHERE w.projectId = ? AND r.archivedAt IS NULL
       ORDER BY r.startedAt DESC LIMIT 1`,
    )
    .get(projectId) as { id: string } | undefined
  return row ?? null
}

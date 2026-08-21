/**
 * MCP servers — an editor over the agent CLIs' own config files.
 *
 * Nothing here is Open Run state: each card is one real file on disk
 * (`~/.claude.json`, `<repo>/.mcp.json`, `~/.codex/config.toml`, …), so a
 * server added here is the same one the user's own `claude` session sees. The
 * per-runtime file list comes from `lib/mcpTargets.ts`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  Blocks,
  Download,
  FileWarning,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Button, Card, EmptyState, Field, Modal, PageHeader, inputClass } from '../components/ui'
import {
  MCP_TRANSPORT_KINDS,
  mcpServerRefusal,
  mcpServerSummary,
  mcpTransportLabel,
  type McpServerConfig,
  type McpTransportKind,
} from '../lib/mcp'
import {
  discoveredOrigin,
  sharedSyncLabel,
  type DiscoveredServer,
  type SharedSyncState,
} from '../lib/mcpShared'
import { OPENRUN_MCP_SERVER_NAME, OPENRUN_TOOLS } from '../lib/openrunTools'
import {
  useImportMcpServers,
  useMcpConfig,
  useMcpDiscovery,
  useProjects,
  useRemoveMcpServer,
  useRemoveSharedMcpServer,
  useRuntimes,
  useSaveMcpServer,
  useSaveSharedMcpServer,
  useSharedMcp,
  useSyncSharedMcp,
  useWorkspaces,
} from '../lib/queries'

export const Route = createFileRoute('/mcp')({ component: McpPage })

const openrunToolNames = OPENRUN_TOOLS.map((t) => t.name).join(', ')

/** Sentinel `targetId` for a draft that belongs to the shared list. */
const SHARED_TARGET_ID = '__shared__'

/** `Claude Code — this machine` → `Claude Code`, for a per-CLI status chip. */
function cliName(label: string): string {
  return label.split('—')[0]?.trim() ?? label
}

const SYNC_CHIP: Record<SharedSyncState, string> = {
  synced: 'border-border text-tier-tertiary',
  missing: 'border-border text-tier-quaternary',
  drifted: 'border-amber-500/40 text-amber-400',
  conflict: 'border-red-500/40 text-red-400',
  unsupported: 'border-border text-tier-quaternary',
  off: 'border-border text-tier-quaternary',
}

type ServerDraft = {
  targetId: string
  previousName?: string
  name: string
  transport: McpTransportKind
  command: string
  args: string
  url: string
  env: string
  headers: string
}

function emptyDraft(targetId: string): ServerDraft {
  return {
    targetId,
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    url: '',
    env: '',
    headers: '',
  }
}

/** `KEY=value` lines ⇄ the record every config format stores. */
function parsePairs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

function formatPairs(record: Record<string, string> | undefined): string {
  return Object.entries(record ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

/** Split a command line on spaces, honouring quoted arguments. */
function parseArgLine(text: string): string[] {
  const matches = text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return matches.map((token) =>
    (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))
      ? token.slice(1, -1)
      : token,
  )
}

function formatArgLine(args: string[] | undefined): string {
  return (args ?? []).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')
}

function draftFromServer(targetId: string, server: McpServerConfig): ServerDraft {
  return {
    targetId,
    previousName: server.name,
    name: server.name,
    transport: server.transport,
    command: server.command ?? '',
    args: formatArgLine(server.args),
    url: server.url ?? '',
    env: formatPairs(server.env),
    headers: formatPairs(server.headers),
  }
}

function serverFromDraft(draft: ServerDraft): McpServerConfig {
  const name = draft.name.trim()
  if (draft.transport === 'stdio') {
    const args = parseArgLine(draft.args)
    const env = parsePairs(draft.env)
    return {
      name,
      transport: 'stdio',
      command: draft.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    }
  }
  const headers = parsePairs(draft.headers)
  return {
    name,
    transport: draft.transport,
    url: draft.url.trim(),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

function McpPage() {
  const { data: runtimes } = useRuntimes()
  const { data: projects } = useProjects()
  const [runtimeId, setRuntimeId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [draft, setDraft] = useState<ServerDraft | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedRuntime = useMemo(() => {
    if (runtimes && runtimes.length > 0) {
      return runtimes.find((r) => r.id === runtimeId) ?? runtimes[0]
    }
    return undefined
  }, [runtimes, runtimeId])

  const { data: workspaces } = useWorkspaces()
  const key = { runtimeId: selectedRuntime?.id ?? '', workspaceId: workspaceId || undefined }
  const { data: config, isLoading } = useMcpConfig(key, { enabled: !!selectedRuntime })
  const save = useSaveMcpServer(key)
  const remove = useRemoveMcpServer(key)

  const { data: shared } = useSharedMcp()
  const { data: discovery } = useMcpDiscovery()
  const importServers = useImportMcpServers()
  const [pickedVariant, setPickedVariant] = useState<Record<string, string>>({})
  const [pendingRemoval, setPendingRemoval] = useState<string>('')
  const saveShared = useSaveSharedMcpServer()
  const removeShared = useRemoveSharedMcpServer()
  const syncShared = useSyncSharedMcp()
  const sharedBusy =
    saveShared.isPending ||
    removeShared.isPending ||
    syncShared.isPending ||
    importServers.isPending
  const hasConflict = shared?.conflicted ?? false

  /** Turn a fan-out result into the one line the page shows after a write. */
  const reportNotice = (report: { written: string[]; skipped: { reason: string }[] }): string => {
    const blocked = report.skipped.filter((s) => !s.reason.startsWith('Open Run did not add'))
    const wrote = `${report.written.length} config file${report.written.length === 1 ? '' : 's'} updated`
    return blocked.length === 0 ? wrote : `${wrote}. Skipped: ${blocked[0]?.reason ?? ''}`
  }

  const readyWorkspaces = (workspaces ?? []).filter((w) => w.status === 'ready')
  const projectName = (projectId: string) =>
    projects?.find((p) => p.id === projectId)?.name ?? 'Project'

  const submit = async () => {
    if (!draft) return
    const server = serverFromDraft(draft)
    const refusal = mcpServerRefusal(server)
    if (refusal) {
      setError(refusal)
      return
    }
    const previous = draft.previousName ? { previousName: draft.previousName } : {}
    try {
      if (draft.targetId === SHARED_TARGET_ID) {
        const { report } = await saveShared.mutateAsync({ server, ...previous })
        setNotice(reportNotice(report))
      } else {
        await save.mutateAsync({ targetId: draft.targetId, server, ...previous })
      }
      setDraft(null)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const dropShared = async (name: string, scope: 'registry' | 'everywhere') => {
    setPendingRemoval('')
    try {
      const { report } = await removeShared.mutateAsync({ name, scope })
      setNotice(
        scope === 'registry'
          ? `Removed "${name}" from Open Run. Every CLI config was left alone.`
          : reportNotice(report),
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }

  /** Which copy to take for a name that differs between CLIs. */
  const variantFor = (entry: DiscoveredServer): string =>
    pickedVariant[entry.name] ?? entry.variants[0]?.targetId ?? ''

  const runImport = async (entries: DiscoveredServer[]) => {
    const choices = entries.map((entry) => ({ name: entry.name, fromTargetId: variantFor(entry) }))
    if (choices.length === 0) return
    try {
      const { report } = await importServers.mutateAsync({ choices })
      const failed = report.skipped[0]
      setNotice(
        `Imported ${report.imported.length} server${report.imported.length === 1 ? '' : 's'}, ${reportNotice(report.fanOut).toLowerCase()}${failed ? `. Skipped ${failed.name}: ${failed.reason}` : ''}`,
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }

  const runSync = async (force: boolean) => {
    try {
      const { report } = await syncShared.mutateAsync({ ...(force ? { force: true } : {}) })
      setNotice(reportNotice(report))
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }

  const addOpenrunTools = async (targetId: string) => {
    const server = config?.openrunTools
    if (!server) return
    try {
      await save.mutateAsync({ targetId, server })
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const drop = async (targetId: string, name: string) => {
    if (!confirm(`Remove "${name}" from this config file?`)) return
    try {
      await remove.mutateAsync({ targetId, name })
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="MCP servers"
        description="Define a server once under Shared and Open Run writes it into every CLI's own config, so any runtime can use it. Below that, each config file is editable on its own. Every turn spawns the CLI afresh, so a server added here is live on your next message — including in a chat that is already running."
      />

      {(discovery?.servers.length ?? 0) > 0 ? (
        <Card className="mb-6 border-ring/40">
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-ui-base text-foreground">
                <Download className="h-3.5 w-3.5" /> Servers already in your CLIs
              </div>
              <div className="mt-0.5 text-ui-sm text-tier-tertiary">
                Open Run found these in config files you already had. Import one and it joins the
                shared list, then goes to every other CLI that can use it. Nothing is written to the
                CLI it came from.
              </div>
            </div>
            <div className="shrink-0">
              <Button
                variant="default"
                disabled={sharedBusy}
                title="Import every server whose copies agree across CLIs"
                onClick={() =>
                  void runImport((discovery?.servers ?? []).filter((entry) => !entry.ambiguous))
                }
              >
                <Download className="h-3.5 w-3.5" /> Import all that agree
              </Button>
            </div>
          </div>

          <div className="divide-y divide-[var(--border-quaternary)]">
            {(discovery?.servers ?? []).map((entry) => (
              <div key={entry.name} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-ui-base text-foreground">{entry.name}</span>
                    <span className="text-ui-xs text-tier-quaternary">
                      {mcpTransportLabel(entry.variants[0]?.server.transport ?? 'stdio')}
                    </span>
                  </div>
                  <div className="mt-0.5 text-ui-sm text-tier-tertiary">
                    {discoveredOrigin(entry)}
                  </div>
                  {entry.secretKeys.length > 0 ? (
                    <div className="mt-0.5 flex items-center gap-1.5 text-ui-sm text-amber-400">
                      <KeyRound className="h-3 w-3 shrink-0" />
                      Carries {entry.secretKeys.join(', ')} — importing copies it into the other CLI
                      configs on this machine.
                    </div>
                  ) : null}
                  {entry.ambiguous ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-ui-sm text-amber-400">
                        These configs disagree. Pick the one to keep:
                      </span>
                      <select
                        className={inputClass}
                        value={variantFor(entry)}
                        onChange={(e) =>
                          setPickedVariant((prev) => ({ ...prev, [entry.name]: e.target.value }))
                        }
                      >
                        {entry.variants.map((v) => (
                          <option key={v.targetId} value={v.targetId}>
                            {cliName(v.targetLabel)} · {mcpServerSummary(v.server)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="mt-0.5 truncate mono text-ui-sm text-tier-quaternary">
                      {mcpServerSummary(
                        entry.variants[0]?.server ?? { name: '', transport: 'stdio' },
                      )}
                    </div>
                  )}
                </div>
                <Button
                  variant="default"
                  disabled={sharedBusy}
                  onClick={() => void runImport([entry])}
                >
                  Import
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="mb-6">
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-ui-base text-foreground">
              <Share2 className="h-3.5 w-3.5" /> Shared servers
            </div>
            <div className="mt-0.5 text-ui-sm text-tier-tertiary">
              Defined once here and written into every CLI's machine-wide config, so a run picks
              them up whichever runtime it uses. Removing one takes back only the copies Open Run
              made.
            </div>
            <div className="mt-1 truncate mono text-ui-sm text-tier-quaternary">
              {shared?.file ?? ''}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {hasConflict ? (
              <Button
                variant="default"
                disabled={sharedBusy}
                title="Replace the CLI's own entry of the same name with the shared one"
                onClick={() => {
                  if (confirm('Replace same-named servers in each CLI config with the shared one?'))
                    void runSync(true)
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Overwrite
              </Button>
            ) : null}
            {shared?.outOfSync ? (
              <Button
                variant="default"
                disabled={sharedBusy}
                title="Write every shared server into each CLI config again"
                onClick={() => void runSync(false)}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Sync
              </Button>
            ) : null}
            <Button
              variant="default"
              disabled={sharedBusy}
              onClick={() => {
                setError('')
                setNotice('')
                setDraft(emptyDraft(SHARED_TARGET_ID))
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </div>

        {notice ? (
          <div className="border-b border-border px-4 py-2 text-ui-sm text-tier-tertiary">
            {notice}
          </div>
        ) : null}

        {(shared?.servers.length ?? 0) === 0 ? (
          <div className="px-4 py-3 text-ui-sm text-tier-quaternary">
            No shared servers yet. Adding one here writes it to{' '}
            {(shared?.targets ?? [])
              .filter((t) => t.installed)
              .map((t) => cliName(t.label))
              .join(', ') || 'every CLI you have set up'}
            .
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-quaternary)]">
            {(shared?.servers ?? []).map(({ server, targets }) => (
              <div key={server.name} className="group px-4 py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-ui-base text-foreground">{server.name}</span>
                      <span className="text-ui-xs text-tier-quaternary">
                        {mcpTransportLabel(server.transport)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate mono text-ui-sm text-tier-quaternary">
                      {mcpServerSummary(server)}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${server.name}`}
                      onClick={() => {
                        setError('')
                        setNotice('')
                        setDraft(draftFromServer(SHARED_TARGET_ID, server))
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${server.name}`}
                      onClick={() => setPendingRemoval(server.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {targets
                    .filter((t) => t.installed)
                    .map((t) => (
                      <span
                        key={t.targetId}
                        title={t.refusal ?? `${t.file} — ${sharedSyncLabel(t.state)}`}
                        className={`rounded border px-1.5 py-0.5 text-ui-xs ${SYNC_CHIP[t.state]}`}
                      >
                        {cliName(t.label)} · {sharedSyncLabel(t.state)}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Runtime">
          <select
            className={inputClass}
            value={selectedRuntime?.id ?? ''}
            onChange={(e) => setRuntimeId(e.target.value)}
          >
            {(runtimes ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Workspace" hint="for project-scoped files">
          <select
            className={inputClass}
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            <option value="">None</option>
            {readyWorkspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {projectName(w.projectId)} · {w.branch || w.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {config?.refusal ? (
        <EmptyState icon={<Blocks className="h-5 w-5" />} title="No MCP config for this runtime">
          {config.refusal}
        </EmptyState>
      ) : isLoading ? (
        <div className="py-16 text-center text-ui-base text-tier-tertiary">Loading…</div>
      ) : (
        <div className="space-y-4">
          {(config?.targets ?? []).map((target) => (
            <Card key={target.id}>
              <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <div className="text-ui-base text-foreground">{target.label}</div>
                  <div className="mt-0.5 text-ui-sm text-tier-tertiary">{target.description}</div>
                  <div className="mt-1 truncate mono text-ui-sm text-tier-quaternary">
                    {target.file || 'no workspace selected'}
                    {target.file && !target.exists ? ' · not created yet' : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {config?.openrunTools &&
                  !target.servers.some((s) => s.name === OPENRUN_MCP_SERVER_NAME) ? (
                    <Button
                      variant="default"
                      disabled={!!target.refusal || save.isPending}
                      title={`Give the agent Open Run's own tools: ${openrunToolNames}`}
                      onClick={() => addOpenrunTools(target.id)}
                    >
                      <Wrench className="h-3.5 w-3.5" /> Open Run tools
                    </Button>
                  ) : null}
                  <Button
                    variant="default"
                    disabled={!!target.refusal}
                    title={target.refusal ?? `Add a server to ${target.label}`}
                    onClick={() => {
                      setError('')
                      setDraft(emptyDraft(target.id))
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              </div>

              {target.refusal ? (
                <div className="flex items-center gap-2 px-4 py-3 text-ui-sm text-tier-tertiary">
                  <FileWarning className="h-3.5 w-3.5 shrink-0" />
                  {target.refusal}
                </div>
              ) : target.servers.length === 0 ? (
                <div className="px-4 py-3 text-ui-sm text-tier-quaternary">No servers yet.</div>
              ) : (
                <div className="divide-y divide-[var(--border-quaternary)]">
                  {target.servers.map((server) => (
                    <div
                      key={server.name}
                      className="group flex items-center justify-between gap-4 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-ui-base text-foreground">{server.name}</span>
                          <span className="text-ui-xs text-tier-quaternary">
                            {mcpTransportLabel(server.transport)}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate mono text-ui-sm text-tier-quaternary">
                          {mcpServerSummary(server)}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button
                          variant="ghost"
                          aria-label={`Edit ${server.name}`}
                          onClick={() => {
                            setError('')
                            setDraft(draftFromServer(target.id, server))
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Remove ${server.name}`}
                          onClick={() => drop(target.id, server.name)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {pendingRemoval ? (
        <Modal title={`Remove ${pendingRemoval}`} onClose={() => setPendingRemoval('')}>
          <div className="space-y-3 p-4">
            <p className="text-ui-sm text-tier-secondary">
              <strong className="text-foreground">Open Run only</strong> stops sharing it and leaves
              every CLI config exactly as it is — the right choice for a server you imported.
            </p>
            <p className="text-ui-sm text-tier-secondary">
              <strong className="text-foreground">Remove everywhere</strong> also deletes the copies
              Open Run wrote. Entries it did not write are never touched.
            </p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="default" onClick={() => setPendingRemoval('')}>
                Cancel
              </Button>
              <Button
                variant="default"
                disabled={sharedBusy}
                onClick={() => void dropShared(pendingRemoval, 'registry')}
              >
                Open Run only
              </Button>
              <Button
                variant="danger"
                disabled={sharedBusy}
                onClick={() => void dropShared(pendingRemoval, 'everywhere')}
              >
                Remove everywhere
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {draft ? (
        <ServerModal
          value={draft}
          error={error}
          saving={save.isPending || saveShared.isPending}
          onChange={setDraft}
          onClose={() => {
            setDraft(null)
            setError('')
          }}
          onSave={submit}
        />
      ) : null}
    </div>
  )
}

function ServerModal({
  value,
  error,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  value: ServerDraft
  error: string
  saving: boolean
  onChange: (v: ServerDraft) => void
  onClose: () => void
  onSave: () => void
}) {
  const set = <K extends keyof ServerDraft>(k: K, v: ServerDraft[K]) =>
    onChange({ ...value, [k]: v })

  return (
    <Modal
      title={value.previousName ? `Edit ${value.previousName}` : 'Add MCP server'}
      onClose={onClose}
    >
      <div className="space-y-3">
        <Field label="Name" hint="letters, digits, dashes">
          <input
            className={inputClass}
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="github"
          />
        </Field>

        <Field label="Transport">
          <select
            className={inputClass}
            value={value.transport}
            onChange={(e) => set('transport', e.target.value as McpTransportKind)}
          >
            {MCP_TRANSPORT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {mcpTransportLabel(kind)}
              </option>
            ))}
          </select>
        </Field>

        {value.transport === 'stdio' ? (
          <>
            <Field label="Command">
              <input
                className={inputClass}
                value={value.command}
                onChange={(e) => set('command', e.target.value)}
                placeholder="npx"
              />
            </Field>
            <Field label="Arguments" hint="space separated, quote to keep spaces">
              <input
                className={inputClass}
                value={value.args}
                onChange={(e) => set('args', e.target.value)}
                placeholder="-y @modelcontextprotocol/server-github"
              />
            </Field>
            <Field label="Environment" hint="one KEY=value per line">
              <textarea
                className={`${inputClass} min-h-20 mono text-ui-sm`}
                value={value.env}
                onChange={(e) => set('env', e.target.value)}
                placeholder={'GITHUB_TOKEN=ghp_…'}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <input
                className={inputClass}
                value={value.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://mcp.example.com/sse"
              />
            </Field>
            <Field label="Headers" hint="one Name=value per line">
              <textarea
                className={`${inputClass} min-h-20 mono text-ui-sm`}
                value={value.headers}
                onChange={(e) => set('headers', e.target.value)}
                placeholder={'Authorization=Bearer …'}
              />
            </Field>
          </>
        )}

        {error ? <div className="text-ui-sm text-danger">{error}</div> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

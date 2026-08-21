/**
 * MCP servers — the shared registry, and what Open Run found in the CLIs.
 *
 * Nothing here is Open Run state: a shared server is written into each CLI's
 * own config file (`~/.claude.json`, `~/.codex/config.toml`, …), so it is the
 * same server the user's own `claude` session sees.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ClipboardPaste,
  Download,
  KeyRound,
  Library,
  LogIn,
  Pencil,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { Button, Card, Field, Modal, PageHeader, inputClass } from '../components/ui'
import { parseMcpPaste } from '../lib/mcpPaste'
import {
  MCP_REGISTRY,
  registryEntryAuthLabel,
  registryEntrySummary,
  registryEntryToServer,
  type RegistryEntry,
} from '../lib/mcpRegistry'
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
import {
  useDisconnectMcpServer,
  useImportMcpServers,
  useMcpDiscovery,
  useMcpOAuth,
  useRemoveSharedMcpServer,
  useSaveSharedMcpServer,
  useSharedMcp,
  useStartMcpOAuth,
  useSyncSharedMcp,
} from '../lib/queries'
import {
  mcpOAuthRedirectUri,
  mcpOAuthRefusal,
  mcpOAuthStateLabel,
  type McpOAuthState,
  type McpOAuthView,
} from '../lib/mcpOAuth'

export const Route = createFileRoute('/mcp')({ component: McpPage })

/** `Claude Code — this machine` → `Claude Code`, for a per-CLI status chip. */
function cliName(label: string): string {
  return label.split('—')[0]?.trim() ?? label
}

const AUTH_CHIP: Record<McpOAuthState, string> = {
  connected: 'border-emerald-500/40 text-emerald-400',
  expired: 'border-amber-500/40 text-amber-400',
  pending: 'border-border text-tier-quaternary',
  none: 'border-border text-tier-quaternary',
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
  previousName?: string
  name: string
  transport: McpTransportKind
  command: string
  args: string
  url: string
  env: string
  headers: string
}

const emptyDraft: ServerDraft = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  env: '',
  headers: '',
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

function draftFromServer(server: McpServerConfig): ServerDraft {
  return {
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
  const [draft, setDraft] = useState<ServerDraft | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pickedVariant, setPickedVariant] = useState<Record<string, string>>({})
  const [pendingRemoval, setPendingRemoval] = useState<string>('')
  const [showRegistry, setShowRegistry] = useState(false)
  const [showPaste, setShowPaste] = useState(false)
  const [connecting, setConnecting] = useState('')

  const { data: shared } = useSharedMcp()
  const { data: discovery } = useMcpDiscovery()
  const importServers = useImportMcpServers()
  const saveShared = useSaveSharedMcpServer()
  const removeShared = useRemoveSharedMcpServer()
  const syncShared = useSyncSharedMcp()
  const oauth = useMcpOAuth()
  const startOAuth = useStartMcpOAuth()
  const disconnect = useDisconnectMcpServer()
  const busy =
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
      const { report } = await saveShared.mutateAsync({ server, ...previous })
      setNotice(reportNotice(report))
      setDraft(null)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Write a batch — a paste, or a library entry — into the shared registry. */
  const install = async (servers: McpServerConfig[], onDone: () => void, connectAfter = '') => {
    let written = 0
    try {
      for (const server of servers) {
        const { report } = await saveShared.mutateAsync({ server })
        written += report.written.length
      }
      onDone()
      setNotice(
        `Added ${servers.length} server${servers.length === 1 ? '' : 's'}, ${written} config file${written === 1 ? '' : 's'} updated. Restart any CLI session already open — it reads its config at startup.`,
      )
      if (connectAfter) void connect(connectAfter)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
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

  const connections = useMemo(() => {
    const map = new Map<string, McpOAuthView>()
    for (const view of oauth.data?.connections ?? []) map.set(view.name, view)
    return map
  }, [oauth.data])

  /**
   * Sign in as a full-page redirect rather than a popup: the vendor sends the
   * browser back to `/api/mcp/oauth/callback`, which stores the token, writes
   * it into every CLI config and returns here with the outcome in the query.
   */
  const connect = async (name: string) => {
    setError('')
    setNotice('')
    setConnecting(name)
    try {
      const { authorizeUrl } = await startOAuth.mutateAsync({
        name,
        redirectUri: mcpOAuthRedirectUri(window.location.origin),
      })
      window.location.href = authorizeUrl
    } catch (err) {
      setConnecting('')
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }

  const dropConnection = async (name: string) => {
    try {
      await disconnect.mutateAsync({ name })
      setNotice(`Disconnected ${name} and cleared its token from every CLI config.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }

  // The callback route redirects back with its outcome in the query string.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('mcpConnected')
    const failed = params.get('mcpAuthError')
    if (!connected && !failed) return
    setNotice(
      connected
        ? `Connected ${connected}. Its token is now in every CLI config — restart any session already open.`
        : `Sign-in failed: ${failed}`,
    )
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  const runSync = async (force: boolean) => {
    try {
      const { report } = await syncShared.mutateAsync({ ...(force ? { force: true } : {}) })
      setNotice(reportNotice(report))
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="MCP servers"
        description="Defined once, written into every CLI's own config."
        actions={
          <>
            {hasConflict ? (
              <Button
                variant="default"
                disabled={busy}
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
                disabled={busy}
                title="Write every shared server into each CLI config again"
                onClick={() => void runSync(false)}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Sync
              </Button>
            ) : null}
            <NewServerMenu
              disabled={busy}
              onPick={(choice) => {
                setError('')
                setNotice('')
                if (choice === 'registry') setShowRegistry(true)
                else if (choice === 'paste') setShowPaste(true)
                else setDraft({ ...emptyDraft })
              }}
            />
          </>
        }
      />

      {notice ? <div className="mb-3 text-ui-sm text-tier-tertiary">{notice}</div> : null}

      {(discovery?.servers.length ?? 0) > 0 ? (
        <Card className="mb-6 border-ring/40">
          <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-ui-base text-foreground">
              <Download className="h-3.5 w-3.5" /> Found in your CLIs
            </div>
            <Button
              variant="default"
              disabled={busy}
              title="Import every server whose copies agree across CLIs"
              onClick={() =>
                void runImport((discovery?.servers ?? []).filter((entry) => !entry.ambiguous))
              }
            >
              Import all
            </Button>
          </div>

          <div className="divide-y divide-[var(--border-quaternary)]">
            {(discovery?.servers ?? []).map((entry) => (
              <div key={entry.name} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-ui-base text-foreground">{entry.name}</span>
                    <span className="text-ui-xs text-tier-quaternary">
                      {discoveredOrigin(entry)}
                    </span>
                    {entry.secretKeys.length > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 text-ui-xs text-amber-400"
                        title={`Importing copies ${entry.secretKeys.join(', ')} into the other CLI configs on this machine`}
                      >
                        <KeyRound className="h-3 w-3 shrink-0" />
                        {entry.secretKeys.join(', ')}
                      </span>
                    ) : null}
                  </div>
                  {entry.ambiguous ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-ui-sm text-amber-400">
                        Configs disagree — pick one:
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
                <Button variant="default" disabled={busy} onClick={() => void runImport([entry])}>
                  Import
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {(shared?.servers.length ?? 0) === 0 ? (
        <div className="py-16 text-center text-ui-sm text-tier-quaternary">No servers yet.</div>
      ) : (
        <Card className="divide-y divide-[var(--border-quaternary)]">
          {(shared?.servers ?? []).map(({ server, targets }) => {
            const view = connections.get(server.name)
            const managed = view?.state === 'connected' || view?.state === 'expired'
            const refusal = mcpOAuthRefusal(server, managed)
            return (
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
                    {server.transport === 'stdio' ? null : (
                      <Button
                        variant="ghost"
                        aria-label={`Connect ${server.name}`}
                        disabled={connecting === server.name || Boolean(refusal)}
                        title={
                          refusal ??
                          "Sign in once here; Open Run keeps the token in every CLI's config"
                        }
                        onClick={() => void connect(server.name)}
                      >
                        <LogIn className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${server.name}`}
                      onClick={() => {
                        setError('')
                        setNotice('')
                        setDraft(draftFromServer(server))
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
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {view ? (
                    <span
                      className={`rounded border px-1.5 py-0.5 text-ui-xs ${AUTH_CHIP[view.state]}`}
                      title={`Signed in at ${view.issuer}. Open Run holds the token and refreshes it.`}
                    >
                      {mcpOAuthStateLabel(view)}
                    </span>
                  ) : null}
                  {view ? (
                    <button
                      type="button"
                      className="rounded border border-border px-1.5 py-0.5 text-ui-xs text-tier-quaternary hover:text-foreground"
                      onClick={() => void dropConnection(server.name)}
                    >
                      Disconnect
                    </button>
                  ) : null}
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
            )
          })}
        </Card>
      )}

      {pendingRemoval ? (
        <Modal title={`Remove ${pendingRemoval}`} onClose={() => setPendingRemoval('')}>
          <div className="flex flex-wrap justify-end gap-2 p-4">
            <Button variant="default" onClick={() => setPendingRemoval('')}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={busy}
              title="Stop sharing it and leave every CLI config as it is"
              onClick={() => void dropShared(pendingRemoval, 'registry')}
            >
              Open Run only
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              title="Also delete the copies Open Run wrote; entries it did not write are untouched"
              onClick={() => void dropShared(pendingRemoval, 'everywhere')}
            >
              Everywhere
            </Button>
          </div>
        </Modal>
      ) : null}

      {showRegistry ? (
        <RegistryModal
          installed={new Set((shared?.servers ?? []).map((s) => s.server.name))}
          busy={busy}
          onClose={() => setShowRegistry(false)}
          onInstall={(server, entry) =>
            void install(
              [server],
              () => setShowRegistry(false),
              entry.auth === 'oauth' ? server.name : '',
            )
          }
        />
      ) : null}

      {showPaste ? (
        <PasteModal
          busy={busy}
          onClose={() => setShowPaste(false)}
          onInstall={(servers) => void install(servers, () => setShowPaste(false))}
        />
      ) : null}

      {draft ? (
        <ServerModal
          value={draft}
          error={error}
          saving={saveShared.isPending}
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

const menuItem =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-base text-foreground transition-colors hover:bg-hover'

function NewServerMenu({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: (choice: 'registry' | 'paste' | 'manual') => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (choice: 'registry' | 'paste' | 'manual') => {
    setOpen(false)
    onPick(choice)
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="primary"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="h-3.5 w-3.5" /> New
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 min-w-52 rounded-xl border border-border bg-elevated p-1.5 shadow-2xl shadow-[var(--shadow-primary)]"
        >
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => pick('registry')}
          >
            <Library className="h-3.5 w-3.5" /> Browse registry
          </button>
          <button type="button" role="menuitem" className={menuItem} onClick={() => pick('paste')}>
            <ClipboardPaste className="h-3.5 w-3.5" /> Add mcp.json
          </button>
          <button type="button" role="menuitem" className={menuItem} onClick={() => pick('manual')}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Enter details
          </button>
        </div>
      ) : null}
    </div>
  )
}

function RegistryModal({
  installed,
  busy,
  onClose,
  onInstall,
}: {
  installed: Set<string>
  busy: boolean
  onClose: () => void
  onInstall: (server: McpServerConfig, entry: RegistryEntry) => void
}) {
  const [openId, setOpenId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})

  const start = (entry: RegistryEntry) => {
    if ((entry.secrets ?? []).length === 0) {
      onInstall(registryEntryToServer(entry), entry)
      return
    }
    setOpenId(entry.id === openId ? '' : entry.id)
  }

  return (
    <Modal title="Registry" onClose={onClose} wide>
      <div className="divide-y divide-[var(--border-quaternary)]">
        {MCP_REGISTRY.map((entry) => {
          const already = installed.has(entry.name)
          const expanded = openId === entry.id
          return (
            <div key={entry.id} className="py-2.5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-ui-base text-foreground">{entry.name}</span>
                    <span className="text-ui-xs text-tier-quaternary">
                      {mcpTransportLabel(entry.transport)}
                    </span>
                    <span className="text-ui-xs text-tier-quaternary">
                      · {registryEntryAuthLabel(entry)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-ui-sm text-tier-tertiary">{entry.summary}</div>
                  <div className="mt-0.5 truncate mono text-ui-sm text-tier-quaternary">
                    {registryEntrySummary(entry)}
                  </div>
                </div>
                <Button
                  variant={expanded ? 'primary' : 'default'}
                  disabled={busy || already}
                  title={already ? 'Already shared' : `Add ${entry.name} to every CLI`}
                  onClick={() =>
                    expanded ? onInstall(registryEntryToServer(entry, values), entry) : start(entry)
                  }
                >
                  {already ? 'Added' : expanded ? 'Install' : 'Add'}
                </Button>
              </div>

              {entry.auth === 'oauth' ? (
                <div className="mt-1 text-ui-sm text-tier-quaternary">
                  No token to paste — Open Run opens {entry.name}'s sign-in page after you add it,
                  and writes the token into every CLI config.
                </div>
              ) : null}

              {expanded ? (
                <div className="mt-2 space-y-2">
                  {(entry.secrets ?? []).map((secret) => (
                    <Field
                      key={secret.key}
                      label={secret.label}
                      hint={secret.hint ?? `blank = read \${${secret.key}} from your environment`}
                    >
                      <input
                        className={`${inputClass} mono`}
                        type="password"
                        value={values[secret.key] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [secret.key]: e.target.value }))
                        }
                        placeholder={`\${${secret.key}}`}
                      />
                    </Field>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function PasteModal({
  busy,
  onClose,
  onInstall,
}: {
  busy: boolean
  onClose: () => void
  onInstall: (servers: McpServerConfig[]) => void
}) {
  const [text, setText] = useState('')
  const result = useMemo(() => parseMcpPaste(text), [text])

  return (
    <Modal title="Add mcp.json" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="chat-code" data-wrap="true">
          <div className="chat-code__header">
            <span className="text-ui-xs text-tier-quaternary">
              mcpServers, VS Code servers, or a Codex [mcp_servers] table
            </span>
          </div>
          <textarea
            className="chat-code__body w-full resize-y border-0 bg-transparent outline-none"
            rows={12}
            spellCheck={false}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              '{\n  "mcpServers": {\n    "github": {\n      "type": "http",\n      "url": "https://api.githubcopilot.com/mcp/"\n    }\n  }\n}'
            }
          />
        </div>

        {result.error ? <div className="text-ui-sm text-danger">{result.error}</div> : null}
        {result.servers.length > 0 ? (
          <div className="text-ui-sm text-tier-tertiary">
            {result.servers.map((s) => s.name).join(', ')} — written into every CLI's own config.
          </div>
        ) : null}
        {result.warnings.map((warning) => (
          <div key={warning} className="text-ui-sm text-amber-400">
            {warning}
          </div>
        ))}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || result.servers.length === 0}
            onClick={() => onInstall(result.servers)}
          >
            {busy ? 'Adding…' : `Add ${result.servers.length || ''}`.trim()}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Each CLI's real history layout is built on disk and its home override points
 * at it. OPENRUN_HOME isolates `usage_file_cache` from the developer's database.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'openrun-usage-'))
const home = join(root, 'home')
const project = join(root, 'code', 'openrun')
const worktree = join(project, '.worktrees', 'fix')
const cwdBefore = process.cwd()
const previousHome = process.env.OPENRUN_HOME
process.env.OPENRUN_HOME = join(root, '.openrun')
process.chdir(root)

process.env.OPENRUN_CLAUDE_LIMITS = '0'
process.env.CLAUDE_CONFIG_DIR = join(home, '.claude')
process.env.CODEX_HOME = join(home, '.codex')
process.env.GROK_HOME = join(home, '.grok')
process.env.GEMINI_HOME = join(home, '.gemini')
process.env.ANTIGRAVITY_CLI_ROOT = join(home, '.antigravity')

const { collectUsage, readUsagePressure } = await import('./usage.ts')
const { getDb, closeDb } = await import('./db.ts')

const DAY = 86_400_000
const now = Date.now()
const latestClaudeDay = new Date(now - 2 * 3_600_000).toISOString().slice(0, 10)

function write(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

function claudeMessage(input: {
  id: string
  model: string
  ts: number
  cwd: string
  usage: Record<string, unknown>
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(input.ts).toISOString(),
    cwd: input.cwd,
    message: { id: input.id, model: input.model, usage: input.usage },
  })
}

function codexRollout(input: {
  model: string
  cwd: string
  ts: number
  total: Record<string, number>
  limits?: Record<string, unknown>
}): string {
  const head = JSON.stringify({
    timestamp: new Date(input.ts).toISOString(),
    payload: { type: 'session_meta', model: input.model, cwd: input.cwd },
  })
  const tokenCount = JSON.stringify({
    timestamp: new Date(input.ts).toISOString(),
    payload: {
      type: 'token_count',
      info: { total_token_usage: input.total },
      ...(input.limits ? { rate_limits: input.limits } : {}),
    },
  })
  return `${head}\n${tokenCount}\n`
}

const runtimes = [
  { id: 'rt_claude', label: 'Claude Code', bin: 'claude', installed: true },
  { id: 'rt_codex', label: 'Codex', bin: 'codex', installed: true },
  { id: 'rt_grok', label: 'Grok', bin: 'grok', installed: true },
  { id: 'rt_custom', label: 'My agent', bin: 'my-agent', installed: true },
]

const projects = [
  { id: 'proj_1', name: 'openrun', path: project },
  { id: 'proj_2', name: 'openrun · fix', path: worktree },
]

before(() => {
  // Claude: one session per project folder, one duplicated message id.
  write(
    join(home, '.claude', 'projects', '-code-openrun', 'session-a.jsonl'),
    [
      claudeMessage({
        id: 'msg_1',
        model: 'claude-opus-5',
        ts: now - 2 * 3_600_000,
        cwd: project,
        usage: {
          input_tokens: 1_000,
          output_tokens: 500,
          cache_read_input_tokens: 10_000,
          cache_creation: { ephemeral_5m_input_tokens: 2_000, ephemeral_1h_input_tokens: 0 },
        },
      }),
      // The same billed request, rewritten when the chat was resumed.
      claudeMessage({
        id: 'msg_1',
        model: 'claude-opus-5',
        ts: now - 2 * 3_600_000,
        cwd: project,
        usage: { input_tokens: 1_000, output_tokens: 500 },
      }),
      // Synthetic rows are Claude's own bookkeeping, not a billed call.
      claudeMessage({
        id: 'msg_2',
        model: '<synthetic>',
        ts: now - 3_600_000,
        cwd: project,
        usage: { input_tokens: 999_999, output_tokens: 999_999 },
      }),
      '',
    ].join('\n'),
  )
  write(
    join(home, '.claude', 'projects', '-code-openrun-worktrees-fix', 'session-b.jsonl'),
    `${claudeMessage({
      id: 'msg_3',
      model: 'claude-sonnet-5',
      ts: now - 40 * DAY,
      cwd: worktree,
      usage: { input_tokens: 4_000, output_tokens: 1_000 },
    })}\n`,
  )

  // Codex: rollouts under YYYY/MM/DD, cumulative totals on the last event.
  write(
    join(home, '.codex', 'sessions', '2026', '08', '20', 'rollout-old.jsonl'),
    codexRollout({
      model: 'gpt-5-codex',
      cwd: project,
      ts: now - DAY,
      total: { input_tokens: 5_000, cached_input_tokens: 1_000, output_tokens: 2_000 },
    }),
  )
  write(
    join(home, '.codex', 'sessions', '2026', '08', '21', 'rollout-new.jsonl'),
    codexRollout({
      model: 'gpt-5-codex',
      cwd: project,
      ts: now,
      total: { input_tokens: 9_000, cached_input_tokens: 3_000, output_tokens: 4_000 },
      limits: {
        plan_type: 'pro',
        primary: { used_percent: 42, window_minutes: 300, resets_at: Math.floor(now / 1000) + 900 },
        secondary: { used_percent: 8, window_minutes: 10_080 },
      },
    }),
  )

  // Grok: a session summary with message counts but no token counts.
  write(
    join(home, '.grok', 'sessions', 'abc', 'summary.json'),
    JSON.stringify({
      info: { cwd: project },
      num_chat_messages: 12,
      updated_at: new Date(now - 2 * DAY).toISOString(),
    }),
  )
})

after(() => {
  closeDb()
  process.chdir(cwdBefore)
  if (previousHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousHome
  rmSync(root, { recursive: true, force: true })
  for (const key of [
    'OPENRUN_CLAUDE_LIMITS',
    'CLAUDE_CONFIG_DIR',
    'CODEX_HOME',
    'GROK_HOME',
    'GEMINI_HOME',
    'ANTIGRAVITY_CLI_ROOT',
  ]) {
    delete process.env[key]
  }
})

function report(range: '7d' | '30d' | 'all' = 'all', runCounts: Record<string, number> = {}) {
  return collectUsage({ runtimes, projects, range, runCounts })
}

function rowFor(id: string) {
  const row = report().runtimes.find((r) => r.runtimeId === id)
  assert.ok(row, `no row for ${id}`)
  return row
}

describe('collectUsage: Claude', () => {
  it('bills each message once, even when a resume rewrote the row', () => {
    const claude = rowFor('rt_claude')
    assert.equal(claude.status, 'ok')
    assert.equal(claude.tokens.input, 5_000)
    assert.equal(claude.tokens.output, 1_500)
    assert.equal(claude.tokens.cacheRead, 10_000)
    assert.equal(claude.tokens.cacheWrite5m, 2_000)
    assert.equal(claude.messages, 2)
    assert.equal(claude.sessions, 2)
  })

  it('leaves synthetic rows out of the total', () => {
    assert.ok(rowFor('rt_claude').totalTokens < 100_000)
  })

  it('prices what it can and splits the models by spend', () => {
    const claude = rowFor('rt_claude')
    assert.deepEqual(
      claude.models.map((m) => m.model),
      ['claude-opus-5', 'claude-sonnet-5'],
    )
    assert.ok((claude.costUsd ?? 0) > 0)
    assert.equal(claude.unpricedTokens, 0)
  })

  it('attributes a worktree to its own project, not the repo above it', () => {
    const claude = rowFor('rt_claude')
    const byId = new Map(claude.projects.map((p) => [p.projectId, p]))
    assert.equal(byId.get('proj_2')?.tokens, 5_000)
    assert.equal(byId.get('proj_1')?.tokens, 13_500)
  })

  it('derives its own windows when the account limits are switched off', () => {
    const claude = rowFor('rt_claude')
    assert.deepEqual(
      claude.windows.map((w) => w.id),
      ['session', 'weekly'],
    )
    assert.ok(claude.windows.every((w) => w.reported === false))
    assert.match(claude.note, /derived from message timestamps/)
  })
})

describe('collectUsage: Codex', () => {
  it('reads the cumulative total and subtracts the cached part from input', () => {
    const codex = rowFor('rt_codex')
    assert.equal(codex.tokens.input, 4_000 + 6_000)
    assert.equal(codex.tokens.cacheRead, 1_000 + 3_000)
    assert.equal(codex.tokens.output, 6_000)
  })

  it('takes the limits and plan from the newest rollout only', () => {
    const codex = rowFor('rt_codex')
    assert.equal(codex.plan, 'pro')
    assert.deepEqual(
      codex.windows.map((w) => [w.id, w.usedPercent, w.reported]),
      [
        ['session', 42, true],
        ['weekly', 8, true],
      ],
    )
  })

  it('shows no price for a CLI that bills by subscription', () => {
    const codex = rowFor('rt_codex')
    assert.equal(codex.costUsd, null)
    assert.equal(codex.unpricedTokens, codex.totalTokens)
    assert.deepEqual(
      codex.models.map((m) => m.costUsd),
      [null],
    )
  })
})

describe('collectUsage: CLIs with no token counts', () => {
  it('separates "no token data" from "no history"', () => {
    const grok = rowFor('rt_grok')
    assert.equal(grok.status, 'no-token-data')
    assert.equal(grok.sessions, 1)
    assert.equal(grok.messages, 12)
    assert.equal(grok.totalTokens, 0)
  })

  it('says plainly that an unknown CLI keeps no record it can read', () => {
    const custom = rowFor('rt_custom')
    assert.equal(custom.status, 'unsupported')
    assert.equal(custom.source, '')
    assert.match(custom.note, /keeps no usage record/)
  })

  it('reports a runtime that is not on PATH as such, whatever is on disk', () => {
    const [row] = collectUsage({
      runtimes: [{ id: 'rt_claude', label: 'Claude Code', bin: 'claude', installed: false }],
      projects,
      range: 'all',
      runCounts: {},
    }).runtimes
    assert.equal(row?.status, 'not-installed')
  })
})

describe('collectUsage: ranges and totals', () => {
  it('drops history older than the range', () => {
    const claude = collectUsage({ runtimes, projects, range: '7d', runCounts: {} }).runtimes.find(
      (r) => r.runtimeId === 'rt_claude',
    )
    assert.equal(claude?.tokens.input, 1_000)
    assert.equal(claude?.sessions, 1)
  })

  it('counts a CLI once in the totals even when two runtimes share it', () => {
    const shared = collectUsage({
      runtimes: [
        ...runtimes,
        {
          id: 'rt_claude_acp',
          label: 'Claude ACP',
          bin: 'claude',
          transport: 'acp',
          installed: true,
        },
      ],
      projects,
      range: 'all',
      runCounts: { rt_claude: 3, rt_claude_acp: 1 },
    })
    const oneCli = report()
    assert.equal(shared.totals.tokens, oneCli.totals.tokens)
    assert.equal(shared.totals.sessions, oneCli.totals.sessions)
    // Runs are per-runtime, so they still add up.
    assert.equal(shared.totals.openRunRuns, 4)

    const acp = shared.runtimes.find((r) => r.runtimeId === 'rt_claude_acp')
    assert.equal(acp?.transport, 'acp')
    assert.match(String(acp?.note), /Shared with Claude Code/)
  })

  it('ranks cross-CLI project totals without double-counting a shared history', () => {
    const totals = report().projects
    assert.deepEqual(
      totals.map((p) => p.projectId),
      ['proj_1', 'proj_2'],
    )
    assert.ok((totals[0]?.tokens ?? 0) > (totals[1]?.tokens ?? 0))
  })

  it('carries the run counts Open Run started itself', () => {
    const withRuns = report('all', { rt_claude: 7 })
    assert.equal(withRuns.runtimes.find((r) => r.runtimeId === 'rt_claude')?.openRunRuns, 7)
    assert.equal(withRuns.totals.openRunRuns, 7)
  })

  it('dates daily rows by the day the tokens landed on', () => {
    const claude = rowFor('rt_claude')
    assert.ok(claude.daily.some((d) => d.date === latestClaudeDay))
    assert.deepEqual(
      [...claude.daily].sort((a, b) => (a.date < b.date ? -1 : 1)),
      claude.daily,
    )
  })
})

describe('the per-file cache', () => {
  it('re-reads nothing on a second scan, and still reports the same totals', () => {
    const first = report()
    const second = report()
    assert.equal(second.totals.tokens, first.totals.tokens)

    const cached = getDb()
      .prepare('SELECT COUNT(*) AS n FROM usage_file_cache WHERE kind = ?')
      .get('claude') as { n: number }
    assert.equal(cached.n, 2)
  })
})

describe('readUsagePressure', () => {
  it('reports the tightest limit a CLI on this machine is claiming', () => {
    const pressure = readUsagePressure()
    assert.equal(pressure.usedPercent, 42)
    assert.equal(pressure.runtime, 'Codex')
    assert.equal(pressure.label, '5-hour limit')
    assert.ok((pressure.resetsAt ?? 0) > now)
  })
})

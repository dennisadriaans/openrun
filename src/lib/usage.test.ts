import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SESSION_WINDOW_MINUTES,
  addTokens,
  costForTokens,
  currentSessionWindow,
  emptyTokens,
  formatCost,
  formatRate,
  formatResetIn,
  formatTokens,
  matchProject,
  modelRows,
  parseUsageRange,
  pathTail,
  priceForModel,
  rangeCutoff,
  rollingWeekWindow,
  totalTokens,
  usageStatusMessage,
  withBurn,
  type RuntimeUsage,
  type UsageTokens,
} from './usage.ts'

const HOUR = 3_600_000
const DAY = 86_400_000

function tokens(partial: Partial<UsageTokens>): UsageTokens {
  return addTokens(emptyTokens(), partial)
}

describe('priceForModel', () => {
  it('prices a dated model id by its longest matching prefix', () => {
    assert.deepEqual(priceForModel('claude-opus-4-5-20250929'), { input: 5, output: 25 })
    assert.deepEqual(priceForModel('claude-opus-4-1-20250805'), { input: 15, output: 75 })
    assert.deepEqual(priceForModel('claude-haiku-4-5-20251001'), { input: 1, output: 5 })
  })

  it('has no price for the CLIs that bill by subscription', () => {
    assert.equal(priceForModel('gpt-5-codex'), null)
    assert.equal(priceForModel('grok-code-fast-1'), null)
    assert.equal(priceForModel(''), null)
  })
})

describe('costForTokens', () => {
  it('bills cache reads at a tenth of input and cache writes above it', () => {
    const cost = costForTokens(
      'claude-sonnet-5',
      tokens({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000 }),
    )
    // 3 (input) + 15 (output) + 0.3 (cache read)
    assert.ok(Math.abs((cost ?? 0) - 18.3) < 1e-9)

    const writes = costForTokens(
      'claude-sonnet-5',
      tokens({ cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000 }),
    )
    assert.ok(Math.abs((writes ?? 0) - (3 * 1.25 + 3 * 2)) < 1e-9)
  })

  it('returns null rather than zero for a model it cannot price', () => {
    assert.equal(costForTokens('gpt-5-codex', tokens({ input: 500_000 })), null)
  })
})

describe('modelRows', () => {
  it('puts the biggest spender first and leaves an unpriced model at null', () => {
    const rows = modelRows(
      new Map([
        ['claude-haiku-4-5', tokens({ input: 10 })],
        ['claude-opus-5', tokens({ input: 1_000_000 })],
        ['some-local-model', tokens({ input: 5_000 })],
      ]),
    )
    assert.deepEqual(
      rows.map((r) => r.model),
      ['claude-opus-5', 'some-local-model', 'claude-haiku-4-5'],
    )
    assert.equal(rows[1]?.costUsd, null)
    assert.ok((rows[0]?.costUsd ?? 0) > 0)
  })
})

describe('currentSessionWindow', () => {
  const now = Date.parse('2026-08-21T14:30:00.000Z')

  it('opens the block on the hour of the first message and totals what follows', () => {
    const start = Date.parse('2026-08-21T12:00:00.000Z')
    const window = currentSessionWindow(
      [
        { ts: start + 20 * 60_000, tokens: 1_000 },
        { ts: start + 90 * 60_000, tokens: 2_000 },
      ],
      now,
    )
    assert.equal(window.tokens, 3_000)
    assert.equal(window.startedAt, start)
    assert.equal(window.resetsAt, start + SESSION_WINDOW_MINUTES * 60_000)
    assert.equal(window.reported, false)
  })

  it('starts a new block after a five-hour gap', () => {
    const older = Date.parse('2026-08-21T02:00:00.000Z')
    const window = currentSessionWindow(
      [
        { ts: older, tokens: 9_000 },
        { ts: Date.parse('2026-08-21T13:10:00.000Z'), tokens: 500 },
      ],
      now,
    )
    assert.equal(window.tokens, 500)
    assert.equal(window.startedAt, Date.parse('2026-08-21T13:00:00.000Z'))
  })

  it('reports nothing once the block has expired', () => {
    const window = currentSessionWindow([{ ts: now - 9 * HOUR, tokens: 4_000 }], now)
    assert.equal(window.tokens, 0)
    assert.equal(window.startedAt, null)
    assert.equal(window.resetsAt, null)
  })

  it('has no window at all with no samples', () => {
    const window = currentSessionWindow([], now)
    assert.equal(window.tokens, 0)
    assert.equal(window.startedAt, null)
  })
})

describe('withBurn', () => {
  const base = {
    id: 'session' as const,
    label: '5-hour block',
    windowMinutes: SESSION_WINDOW_MINUTES,
    tokens: 100_000,
    usedPercent: null,
    startedAt: null,
    resetsAt: null,
    reported: true,
    tokensPerHour: null,
    projectedTokens: null,
    projectedPercent: null,
  }

  it('projects the reported percentage to the end of the window', () => {
    const now = Date.now()
    const start = now - HOUR
    const w = withBurn({ ...base, startedAt: start, usedPercent: 20 }, now)
    assert.equal(w.tokensPerHour, 100_000)
    assert.equal(w.projectedTokens, 500_000)
    assert.equal(w.projectedPercent, 100)
  })

  it('derives the start from resetsAt when the CLI only reports a reset', () => {
    const now = Date.now()
    const w = withBurn({ ...base, resetsAt: now + 4 * HOUR, usedPercent: 20 }, now)
    assert.equal(w.projectedPercent, 100)
  })

  it('says nothing from a sample only a minute old', () => {
    const now = Date.now()
    const w = withBurn({ ...base, startedAt: now - 60_000, usedPercent: 20 }, now)
    assert.equal(w.tokensPerHour, null)
    assert.equal(w.projectedPercent, null)
  })

  it('caps a runaway projection instead of showing an absurd number', () => {
    const now = Date.now()
    const w = withBurn({ ...base, startedAt: now - 6 * 60_000, usedPercent: 90 }, now)
    assert.equal(w.projectedPercent, 999)
  })
})

describe('rollingWeekWindow', () => {
  it('counts only the last seven days', () => {
    const now = Date.now()
    const w = rollingWeekWindow(
      [
        { ts: now - 8 * DAY, tokens: 1_000 },
        { ts: now - 2 * DAY, tokens: 4_000 },
        { ts: now - HOUR, tokens: 500 },
      ],
      now,
    )
    assert.equal(w.tokens, 4_500)
    assert.equal(w.usedPercent, null)
  })
})

describe('matchProject', () => {
  const projects = [
    { id: 'p1', name: 'openrun', path: '/Users/dev/code/openrun' },
    { id: 'p2', name: 'openrun worktree', path: '/Users/dev/code/openrun/.worktrees/fix' },
    { id: 'p3', name: 'other', path: '/Users/dev/code/other' },
  ]

  it('prefers the worktree over the repo that contains it', () => {
    assert.deepEqual(matchProject('/Users/dev/code/openrun/.worktrees/fix/src', projects), {
      id: 'p2',
      name: 'openrun worktree',
    })
  })

  it('matches the project root itself, trailing slash or not', () => {
    assert.equal(matchProject('/Users/dev/code/openrun/', projects)?.id, 'p1')
  })

  it('matches Windows paths against project folders', () => {
    const windows = [
      { id: 'p1', name: 'openrun', path: 'C:\\Users\\dev\\code\\openrun' },
      { id: 'p2', name: 'openrun worktree', path: 'C:\\Users\\dev\\code\\openrun\\.worktrees\\fix' },
    ]
    assert.equal(
      matchProject('C:\\Users\\dev\\code\\openrun\\.worktrees\\fix\\src', windows)?.id,
      'p2',
    )
    assert.equal(matchProject('C:\\Users\\dev\\code\\openrun\\', windows)?.id, 'p1')
  })
})

describe('formatting', () => {
  it('scales token counts the way the page reads them', () => {
    assert.equal(formatTokens(0), '0')
    assert.equal(formatTokens(940), '940')
    assert.equal(formatTokens(1_500), '1.5K')
    assert.equal(formatTokens(84_000), '84K')
    assert.equal(formatTokens(2_400_000), '2.4M')
    assert.equal(formatTokens(41_000_000), '41M')
    assert.equal(formatTokens(3_200_000_000), '3.2B')
  })

  it('shows a rate only when there is one', () => {
    assert.equal(formatRate(null), '')
    assert.equal(formatRate(0), '')
    assert.equal(formatRate(120_000), '120K/h')
  })

  it('distinguishes no price from a free run and rounds big spend', () => {
    assert.equal(formatCost(null), '—')
    assert.equal(formatCost(0), '$0.00')
    assert.equal(formatCost(0.004), '<$0.01')
    assert.equal(formatCost(12.5), '$12.50')
    assert.equal(formatCost(1_234.6), '$1,235')
  })

  it('counts down to a reset in the units that fit', () => {
    const now = Date.now()
    assert.equal(formatResetIn(null, now), '')
    assert.equal(formatResetIn(now - 1_000, now), 'resets now')
    assert.equal(formatResetIn(now + 25 * 60_000, now), 'resets in 25m')
    assert.equal(formatResetIn(now + 2 * HOUR + 30 * 60_000, now), 'resets in 2h 30m')
    assert.equal(formatResetIn(now + 2 * DAY + 3 * HOUR, now), 'resets in 2d 3h')
  })

  it('names a folder by its tail', () => {
    assert.equal(pathTail('/Users/dev/code/openrun/'), 'openrun')
    assert.equal(pathTail('C:\\Users\\dev\\code\\openrun\\'), 'openrun')
    assert.equal(pathTail('openrun'), 'openrun')
  })
})

describe('parseUsageRange', () => {
  it('defaults to 30 days for anything it does not recognise', () => {
    assert.equal(parseUsageRange('7d'), '7d')
    assert.equal(parseUsageRange('all'), 'all')
    assert.equal(parseUsageRange(null), '30d')
    assert.equal(parseUsageRange('yesterday'), '30d')
  })

  it('has no cutoff for all time', () => {
    const now = Date.now()
    assert.equal(rangeCutoff('all', now), 0)
    assert.equal(rangeCutoff('7d', now), now - 7 * DAY)
  })
})

describe('usageStatusMessage', () => {
  function usage(partial: Partial<RuntimeUsage>): RuntimeUsage {
    return {
      runtimeId: 'r1',
      label: 'Claude Code',
      bin: 'claude',
      kind: 'claude',
      transport: 'cli',
      installed: true,
      status: 'ok',
      source: '~/.claude/projects',
      note: '',
      tokens: emptyTokens(),
      totalTokens: 0,
      costUsd: 0,
      unpricedTokens: 0,
      models: [],
      daily: [],
      windows: [],
      projects: [],
      sessions: 0,
      messages: 0,
      lastUsedAt: null,
      plan: '',
      openRunRuns: 0,
      ...partial,
    }
  }

  it('names the missing binary rather than pretending there is no history', () => {
    assert.match(usageStatusMessage(usage({ status: 'not-installed' })), /claude is not on PATH/)
  })

  it('separates "this CLI keeps no record" from "nothing in this range"', () => {
    assert.match(usageStatusMessage(usage({ status: 'unsupported' })), /keeps no usage record/)
    assert.match(usageStatusMessage(usage({ status: 'empty' })), /No local history yet/)
    assert.equal(usageStatusMessage(usage({ status: 'ok' })), 'Nothing in this range.')
  })

  it('keeps the scan note once there are real numbers', () => {
    const message = usageStatusMessage(
      usage({ status: 'ok', totalTokens: 12_000, sessions: 3, note: 'Shared with Claude ACP.' }),
    )
    assert.equal(message, 'Shared with Claude ACP.')
  })

  it('says a CLI records sessions but no tokens', () => {
    assert.match(
      usageStatusMessage(usage({ status: 'no-token-data', sessions: 4 })),
      /no token counts/,
    )
  })
})

describe('token arithmetic', () => {
  it('adds partial buckets and totals every bucket', () => {
    const acc = emptyTokens()
    addTokens(acc, { input: 10, output: 5 })
    addTokens(acc, { cacheRead: 100, cacheWrite5m: 2, cacheWrite1h: 3 })
    assert.deepEqual(acc, {
      input: 10,
      output: 5,
      cacheRead: 100,
      cacheWrite5m: 2,
      cacheWrite1h: 3,
    })
    assert.equal(totalTokens(acc), 120)
  })
})

/**
 * Credentials come from `CLAUDE_CONFIG_DIR` and `fetch` is stubbed: no network,
 * no Keychain prompt. Each test clears the `globalThis` snapshot slot first.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { readClaudeLimits } from './claudeLimits.ts'

const root = mkdtempSync(join(tmpdir(), 'openrun-limits-'))
const claudeHome = join(root, '.claude')
const realFetch = globalThis.fetch
const realWarn = console.warn

type LimitsState = { snapshot: unknown; inFlight: Promise<void> | null }
const slot = globalThis as unknown as { __openrunClaudeLimits?: LimitsState }

function credentials(overrides: Record<string, unknown> = {}): void {
  mkdirSync(claudeHome, { recursive: true })
  writeFileSync(
    join(claudeHome, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-oat-test',
        scopes: ['user:inference', 'user:profile'],
        expiresAt: Date.now() + 3_600_000,
        ...overrides,
      },
    }),
  )
}

function respondWith(body: unknown, init: { status?: number } = {}): { calls: number } {
  const counter = { calls: 0 }
  globalThis.fetch = (async () => {
    counter.calls += 1
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return counter
}

/** Read once to start the refresh, wait for it, then read the settled answer. */
async function settled(now = Date.now()) {
  readClaudeLimits(now)
  await slot.__openrunClaudeLimits?.inFlight
  return readClaudeLimits(now)
}

beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = claudeHome
  delete process.env.OPENRUN_CLAUDE_LIMITS
  delete slot.__openrunClaudeLimits
  console.warn = () => {}
})

afterEach(() => {
  rmSync(claudeHome, { recursive: true, force: true })
  globalThis.fetch = realFetch
  console.warn = realWarn
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.OPENRUN_CLAUDE_LIMITS
  delete slot.__openrunClaudeLimits
})

describe('readClaudeLimits', () => {
  it('maps every bucket the account reports onto a window', async () => {
    credentials()
    const resetsAt = new Date(Date.now() + 2 * 3_600_000).toISOString()
    respondWith({
      five_hour: { utilization: 42, resets_at: resetsAt },
      seven_day: { utilization: 11, resets_at: resetsAt },
      seven_day_opus: { utilization: 60, resets_at: resetsAt },
      seven_day_sonnet: { utilization: 5, resets_at: resetsAt },
    })

    const limits = await settled()
    assert.deepEqual(
      limits?.windows.map((w) => [w.id, w.usedPercent, w.reported]),
      [
        ['session', 42, true],
        ['weekly', 11, true],
        ['weekly-opus', 60, true],
        ['weekly-sonnet', 5, true],
      ],
    )
    assert.equal(limits?.windows[0]?.resetsAt, Date.parse(resetsAt))
  })

  it('clamps a utilization outside 0–100 rather than showing it raw', async () => {
    credentials()
    respondWith({ five_hour: { utilization: 128 }, seven_day: { utilization: -3 } })

    const limits = await settled()
    assert.deepEqual(
      limits?.windows.map((w) => w.usedPercent),
      [100, 0],
    )
  })

  it('drops a window whose reset has already passed', async () => {
    credentials()
    const now = Date.now()
    respondWith({
      five_hour: { utilization: 90, resets_at: new Date(now - 60_000).toISOString() },
      seven_day: { utilization: 20, resets_at: new Date(now + 60_000).toISOString() },
    })

    const limits = await settled(now)
    assert.deepEqual(
      limits?.windows.map((w) => w.id),
      ['weekly'],
    )
  })

  it('skips a bucket with no numeric utilization instead of reporting zero', async () => {
    credentials()
    respondWith({ five_hour: { resets_at: null }, seven_day: { utilization: 30 } })

    const limits = await settled()
    assert.deepEqual(
      limits?.windows.map((w) => w.id),
      ['weekly'],
    )
  })

  it('serves nothing rather than a stale reading', async () => {
    credentials()
    respondWith({ five_hour: { utilization: 42 } })
    await settled()

    // An hour on, the snapshot is past its shelf life.
    assert.equal(readClaudeLimits(Date.now() + 2 * 60 * 60_000), null)
  })

  it('is off entirely behind the environment switch', async () => {
    credentials()
    const counter = respondWith({ five_hour: { utilization: 42 } })
    process.env.OPENRUN_CLAUDE_LIMITS = '0'

    assert.equal(await settled(), null)
    assert.equal(counter.calls, 0)
  })
})

describe('the credential it will use', () => {
  it('never sends an inference-only token, which the endpoint would reject', async () => {
    credentials({ scopes: ['user:inference'] })
    const counter = respondWith({ five_hour: { utilization: 42 } })

    assert.equal(await settled(), null)
    assert.equal(counter.calls, 0)
  })

  it('treats a lapsed token as a miss and waits for Claude Code to renew it', async () => {
    credentials({ expiresAt: Date.now() - 1_000 })
    const counter = respondWith({ five_hour: { utilization: 42 } })

    assert.equal(await settled(), null)
    assert.equal(counter.calls, 0)
  })

  it('sends the token as a bearer when it does carry the scope', async () => {
    credentials()
    let auth = ''
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      auth = String(new Headers(init.headers).get('Authorization'))
      return new Response(JSON.stringify({ five_hour: { utilization: 1 } }), { status: 200 })
    }) as unknown as typeof fetch

    await settled()
    assert.equal(auth, 'Bearer sk-ant-oat-test')
  })
})

describe('when the endpoint says no', () => {
  it('reports nothing and does not retry a 401 on the next read', async () => {
    credentials()
    const counter = respondWith({}, { status: 401 })

    assert.equal(await settled(), null)
    assert.equal(counter.calls, 1)

    assert.equal(await settled(), null)
    assert.equal(counter.calls, 1)
  })

  it('reports nothing for a body it cannot read', async () => {
    credentials()
    respondWith({ something_else: true })
    assert.equal(await settled(), null)
  })

  it('never puts the token in the warning it logs', async () => {
    credentials()
    respondWith({}, { status: 403 })
    const lines: string[] = []
    console.warn = (...args: unknown[]) => lines.push(args.join(' '))

    await settled()
    assert.ok(lines.length > 0)
    assert.ok(
      lines.every((line) => !line.includes('sk-ant-oat-test')),
      lines.join('\n'),
    )
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertWebhookUrl,
  buildRunNotification,
  detectWebhookShape,
  notifierMatches,
  parseVerdictList,
  resolveNotifierName,
  unknownNotifierLabel,
  webhookPayload,
  type RunNotificationInput,
} from './notify.ts'

const input: RunNotificationInput = {
  runId: 'run_abc',
  taskName: 'Nightly dependency bump',
  verdict: 'failed-checks',
  trigger: 'schedule',
  durationMs: 95_000,
  changedFiles: 3,
  failedChecks: ['Types'],
  repairAttempts: 1,
}

describe('notifierMatches', () => {
  it('is silent when the notifier is disabled', () => {
    assert.equal(notifierMatches({ enabled: false, verdicts: [] }, 'crashed'), false)
  })

  it('never fires on a run with no verdict', () => {
    assert.equal(notifierMatches({ enabled: true, verdicts: [] }, ''), false)
  })

  it('defaults to the needs-attention set when no verdicts are chosen', () => {
    const rule = { enabled: true, verdicts: [] }
    assert.equal(notifierMatches(rule, 'failed-checks'), true)
    assert.equal(notifierMatches(rule, 'timeout'), true)
    assert.equal(notifierMatches(rule, 'crashed'), true)
    assert.equal(notifierMatches(rule, 'verified'), false)
    assert.equal(notifierMatches(rule, 'no-changes'), false)
  })

  it('honours an explicit verdict list, including quiet successes', () => {
    const rule = { enabled: true, verdicts: ['verified' as const] }
    assert.equal(notifierMatches(rule, 'verified'), true)
    assert.equal(notifierMatches(rule, 'crashed'), false)
  })
})

describe('parseVerdictList', () => {
  it('reads a stored list', () => {
    assert.deepEqual(parseVerdictList('["verified","crashed"]'), ['verified', 'crashed'])
  })

  it('degrades to empty on junk rather than throwing', () => {
    assert.deepEqual(parseVerdictList('nope'), [])
    assert.deepEqual(parseVerdictList('{"a":1}'), [])
    assert.deepEqual(parseVerdictList(''), [])
    assert.deepEqual(parseVerdictList(null), [])
  })

  it('drops non-string entries', () => {
    assert.deepEqual(parseVerdictList('["verified",3,null]'), ['verified'])
  })
})

describe('buildRunNotification', () => {
  it('leads with the verdict and the automation name', () => {
    const n = buildRunNotification(input)
    assert.equal(n.title, 'Checks failed · Nightly dependency bump')
  })

  it('names the failing checks first — that is the actionable part', () => {
    assert.match(buildRunNotification(input).body, /^Failing: Types/)
  })

  it('omits the failing-checks clause when nothing failed', () => {
    const n = buildRunNotification({ ...input, verdict: 'verified', failedChecks: [] })
    assert.doesNotMatch(n.body, /Failing/)
  })

  it('reports files changed, duration and trigger', () => {
    const body = buildRunNotification(input).body
    assert.match(body, /3 files changed/)
    assert.match(body, /1m 35s/)
    assert.match(body, /schedule/)
  })

  it('singularises a one-file change', () => {
    assert.match(buildRunNotification({ ...input, changedFiles: 1 }).body, /1 file changed/)
  })

  it('mentions repair turns only when some were spent', () => {
    assert.match(buildRunNotification(input).body, /after 1 repair turn/)
    assert.match(buildRunNotification({ ...input, repairAttempts: 2 }).body, /after 2 repair turns/)
    assert.doesNotMatch(buildRunNotification({ ...input, repairAttempts: 0 }).body, /repair/)
  })

  it('formats sub-minute and sub-second durations', () => {
    assert.match(buildRunNotification({ ...input, durationMs: 4_000 }).body, /4s/)
    assert.match(buildRunNotification({ ...input, durationMs: 120_000 }).body, /2m/)
  })

  it('links to the run', () => {
    assert.equal(buildRunNotification(input).path, '/runs/run_abc')
  })
})

describe('detectWebhookShape', () => {
  it('detects Discord incoming webhooks', () => {
    assert.equal(detectWebhookShape('https://discord.com/api/webhooks/1/abc'), 'discord')
    assert.equal(detectWebhookShape('https://discordapp.com/api/webhooks/1/abc'), 'discord')
  })

  it('falls back to generic for anything else', () => {
    assert.equal(detectWebhookShape('https://example.test/hook'), 'generic')
    assert.equal(detectWebhookShape('not a url'), 'generic')
  })
})

describe('webhookPayload', () => {
  const n = buildRunNotification(input)

  it('sends Discord a `content` field', () => {
    assert.ok(typeof webhookPayload(n, 'discord', 'http://localhost:3000').content === 'string')
  })

  it('includes an absolute run link', () => {
    const body = webhookPayload(n, 'discord', 'http://localhost:3000') as { content: string }
    assert.match(body.content, /http:\/\/localhost:3000\/runs\/run_abc/)
  })

  it('does not double the slash when the base URL has a trailing one', () => {
    const body = webhookPayload(n, 'discord', 'http://localhost:3000/') as { content: string }
    assert.doesNotMatch(body.content, /3000\/\/runs/)
  })

  it('gives a generic endpoint structured fields, not just prose', () => {
    const body = webhookPayload(n, 'generic', 'http://localhost:3000')
    assert.equal(body.event, 'run.finished')
    assert.equal(body.runId, 'run_abc')
    assert.equal(body.verdict, 'failed-checks')
    assert.deepEqual(body.failedChecks, ['Types'])
    assert.equal(body.url, 'http://localhost:3000/runs/run_abc')
  })
})

describe('assertWebhookUrl', () => {
  it('accepts http and https', () => {
    assert.equal(assertWebhookUrl(' https://example.test/hook '), 'https://example.test/hook')
    assert.equal(assertWebhookUrl('http://localhost:9000/x'), 'http://localhost:9000/x')
  })

  it('rejects anything we could not POST to', () => {
    assert.throws(() => assertWebhookUrl('ftp://example.test'), /http\(s\) URL/)
    assert.throws(() => assertWebhookUrl('file:///etc/passwd'), /http\(s\) URL/)
    assert.throws(() => assertWebhookUrl('nonsense'), /http\(s\) URL/)
    assert.throws(() => assertWebhookUrl(''), /http\(s\) URL/)
  })
})

describe('resolveNotifierName', () => {
  it('prefers a non-blank JOIN name', () => {
    assert.equal(resolveNotifierName(' Team Chat ', 'n_1'), 'Team Chat')
  })

  it('falls back to the notifier id when the name is blank', () => {
    assert.equal(resolveNotifierName('', 'n_orphan'), 'n_orphan')
    assert.equal(resolveNotifierName('   ', 'n_orphan'), 'n_orphan')
    assert.equal(resolveNotifierName(null, 'n_orphan'), 'n_orphan')
  })

  it('uses a stable unknown label when both name and id are missing', () => {
    assert.equal(resolveNotifierName(''), unknownNotifierLabel())
    assert.equal(resolveNotifierName(null, null), unknownNotifierLabel())
    assert.equal(resolveNotifierName(undefined, '  '), unknownNotifierLabel())
  })
})

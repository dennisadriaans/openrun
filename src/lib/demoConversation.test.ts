import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseUnifiedDiff } from './diff.ts'
import { DEMO_DETAIL_RUN_ID } from './demoData.ts'
import {
  DEMO_FILE_DIFFS,
  DEMO_VUE_PATHS,
  demoConversation,
  demoFileDiff,
} from './demoConversation.ts'
import { resolveCallRole } from './toolCallRole.ts'
import { toolCallView } from './toolCallView.ts'
import type { TurnEventPayload, TurnEventRow } from './turnEvents.ts'

function payload(event: TurnEventRow): TurnEventPayload {
  return JSON.parse(event.payload) as TurnEventPayload
}

describe('demoConversation', () => {
  it('is only served for the Vue waitlist run', () => {
    assert.equal(demoConversation('demo-run-1'), null)
    assert.ok(demoConversation(DEMO_DETAIL_RUN_ID))
  })

  it('includes an MCP call, a web fetch, and three Vue edits', () => {
    const convo = demoConversation(DEMO_DETAIL_RUN_ID, 1_700_000_000_000)
    const events = convo?.messages.find((m) => m.role === 'assistant')?.events ?? []
    const starts = events.filter((e) => e.kind === 'tool_start').map(payload)

    const mcp = starts.find((p) => resolveCallRole(p) === 'mcp')
    assert.equal(mcp?.name, 'mcp__linear__get_issue')
    assert.equal(mcp?.mcpServer, 'linear')

    const web = starts.find((p) => p.name === 'WebFetch')
    assert.equal(toolCallView({ ...web, toolInput: web?.input }).kind, 'fetch')
    assert.equal(toolCallView({ ...web, toolInput: web?.input }).target.type, 'url')

    const edits = starts.filter((p) => p.toolKind === 'edit')
    assert.equal(edits.length, 3)
    const names = edits.map((p) => {
      const target = toolCallView({ ...p, toolInput: p.input }).target
      return target.type === 'path' ? target.path.name : ''
    })
    assert.deepEqual(names, ['WaitlistHero.vue', 'PricingCard.vue', 'ThemeToggle.vue'])
  })

  it('ships unified diffs the review pane can parse', () => {
    for (const path of DEMO_VUE_PATHS) {
      const parsed = parseUnifiedDiff(DEMO_FILE_DIFFS[path])
      assert.ok(parsed.hunks.length > 0, path)
      assert.ok(parsed.additions > 0, path)
    }
    assert.equal(demoFileDiff(DEMO_DETAIL_RUN_ID, DEMO_VUE_PATHS[0])?.path, DEMO_VUE_PATHS[0])
  })
})

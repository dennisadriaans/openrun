import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import {
  DEMO_RUNNING_TASK_ID,
  demoRuns,
  demoTaskDetail,
  demoTasks,
  isDemoMode,
} from './demoData.ts'

describe('isDemoMode', () => {
  const prevOpenrun = process.env.OPENRUN_DEMO
  const prevAgentops = process.env.AGENTOPS_DEMO

  after(() => {
    if (prevOpenrun === undefined) delete process.env.OPENRUN_DEMO
    else process.env.OPENRUN_DEMO = prevOpenrun
    if (prevAgentops === undefined) delete process.env.AGENTOPS_DEMO
    else process.env.AGENTOPS_DEMO = prevAgentops
  })

  it('is off unless OPENRUN_DEMO or AGENTOPS_DEMO is a truthy flag', () => {
    delete process.env.OPENRUN_DEMO
    delete process.env.AGENTOPS_DEMO
    assert.equal(isDemoMode(), false)
    process.env.OPENRUN_DEMO = '0'
    assert.equal(isDemoMode(), false)
    process.env.OPENRUN_DEMO = '1'
    assert.equal(isDemoMode(), true)
    delete process.env.OPENRUN_DEMO
    process.env.AGENTOPS_DEMO = 'true'
    assert.equal(isDemoMode(), true)
  })
})

describe('demo lists', () => {
  it('fills one Runs page with mixed statuses and runtimes', () => {
    const rows = demoRuns(1_700_000_000_000)
    assert.equal(rows.length, 10)
    assert.equal(rows[0]?.status, 'running')
    assert.ok(rows.some((r) => r.status === 'error'))
    assert.ok(rows.some((r) => r.trigger === 'schedule'))
    assert.ok(rows.some((r) => r.id === 'demo-run-5' && r.chatTitle.includes('Vue')))
  })

  it('fills Automations with a live row, webhooks, and a paused job', () => {
    const rows = demoTasks(1_700_000_000_000)
    assert.equal(rows.length, 10)
    assert.equal(rows[0]?.id, DEMO_RUNNING_TASK_ID)
    assert.ok(rows.some((t) => t.webhookIntegrationId && !t.cron))
    assert.ok(rows.some((t) => t.enabled === 0))
    assert.ok(rows.some((t) => t.queuedCount > 1))
  })
})

describe('demo automation detail', () => {
  it('provides a ready, isolated preview for the featured automation', () => {
    const task = demoTaskDetail(DEMO_RUNNING_TASK_ID, 1_700_000_000_000)
    assert.equal(task?.name, 'Nightly dependency bump')
    assert.equal(task?.workspaceHealth?.code, 'ok')
    assert.equal(task?.readinessBlockers.length, 0)
  })

  it('does not fabricate details for the other demo rows', () => {
    assert.equal(demoTaskDetail('demo-task-2'), null)
  })
})

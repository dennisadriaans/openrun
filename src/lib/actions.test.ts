/**
 * The decisions must be exactly what the gates say — that is the whole point.
 *
 * These tests deliberately assert against `runNowBlockedReason` and
 * `enableBlockedReason` rather than against hard-coded copy, so a change to a
 * refuse message travels here automatically instead of being restated.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { allEnabled, decide, firstBlockedReason, taskActions } from './actions.ts'
import type { TaskActionInput } from './actions.ts'
import { runNowBlockedReason } from './runNowGate.ts'
import { enableBlockedReason } from './enableGate.ts'

/** A task with every gate green. Individual tests spoil one field at a time. */
function healthy(overrides: Partial<TaskActionInput> = {}): TaskActionInput {
  return {
    workspaceValid: true,
    workspaceReady: true,
    workspaceStatus: 'ready',
    workspaceHealth: null,
    runtimeInstalled: true,
    runtimeBin: 'claude',
    promptValid: true,
    resumeSessionId: '',
    resumeSessionValid: true,
    cron: '0 9 * * *',
    cronValid: true,
    unattendedBlockedReason: null,
    ...overrides,
  }
}

describe('decide', () => {
  it('enables with no reason attached', () => {
    assert.deepEqual(decide(null), { enabled: true })
    assert.deepEqual(decide(undefined), { enabled: true })
  })

  it('disables and carries the words through unchanged', () => {
    assert.deepEqual(decide('Nope.'), { enabled: false, reason: 'Nope.' })
  })

  it('never puts a reason on an enabled control', () => {
    assert.equal('reason' in decide(null), false)
  })
})

describe('taskActions', () => {
  it('enables both controls for a healthy automation', () => {
    const actions = taskActions(healthy())
    assert.deepEqual(actions.runNow, { enabled: true })
    assert.deepEqual(actions.enable, { enabled: true })
    assert.equal(allEnabled(actions), true)
  })

  it('says exactly what the gate says when a workspace is missing', () => {
    const input = healthy({ workspaceValid: false })
    const actions = taskActions(input)

    assert.equal(actions.runNow.enabled, false)
    assert.equal(actions.runNow.reason, runNowBlockedReason(input))
    assert.equal(actions.enable.reason, enableBlockedReason(input))
  })

  it('says exactly what the gate says when the binary is off PATH', () => {
    const input = healthy({ runtimeInstalled: false, runtimeBin: 'codex' })
    assert.equal(taskActions(input).runNow.reason, runNowBlockedReason(input))
  })

  it('says exactly what the gate says when the prompt is empty', () => {
    const input = healthy({ promptValid: false })
    assert.equal(taskActions(input).runNow.reason, runNowBlockedReason(input))
  })

  /**
   * The asymmetry the two gates exist to express: a bad cron stops arming but
   * not a manual run. A client that only read one decision would get this
   * wrong, which is why both are sent.
   */
  it('blocks Enable but not Run now on an invalid cron', () => {
    const actions = taskActions(healthy({ cron: 'not a cron', cronValid: false }))
    assert.equal(actions.runNow.enabled, true)
    assert.equal(actions.enable.enabled, false)
  })

  /** Same asymmetry from the other side: AFK rules gate arming only. */
  it('blocks Enable but not Run now when unattended work is refused', () => {
    const actions = taskActions(
      healthy({ unattendedBlockedReason: 'Shared checkout cannot run unattended.' }),
    )
    assert.equal(actions.runNow.enabled, true)
    assert.equal(actions.enable.enabled, false)
    assert.equal(actions.enable.reason, 'Shared checkout cannot run unattended.')
  })

  it('reports the first blocking reason across the map', () => {
    const actions = taskActions(healthy({ promptValid: false }))
    assert.equal(firstBlockedReason(actions), actions.runNow.reason)
    assert.equal(firstBlockedReason(taskActions(healthy())), null)
  })
})

describe('serialisability', () => {
  /**
   * These decisions cross the wire to a Swift client, so they must survive a
   * JSON round trip with no undefined, no functions and no class instances.
   */
  it('round-trips through JSON unchanged', () => {
    const actions = taskActions(healthy({ workspaceValid: false }))
    assert.deepEqual(JSON.parse(JSON.stringify(actions)), actions)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasInvalidSchedule,
  invalidTriggerEditorSeed,
  nextRunDetailLabel,
} from './scheduleHealth.ts'

describe('hasInvalidSchedule', () => {
  it('is false for empty (manual-only) and valid expressions', () => {
    assert.equal(hasInvalidSchedule(''), false)
    assert.equal(hasInvalidSchedule('   '), false)
    assert.equal(hasInvalidSchedule('0 9 * * 1-5'), false)
  })

  it('is true for non-empty junk', () => {
    assert.equal(hasInvalidSchedule('every day'), true)
    assert.equal(hasInvalidSchedule('60 9 * * *'), true)
  })
})

describe('nextRunDetailLabel', () => {
  it('says paused when the automation is disabled', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: false,
        cron: '0 9 * * *',
        cronValid: true,
        relativeNext: 'in 2h',
      }),
      'paused',
    )
  })

  it('says manual only when enabled with no cron', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: true,
        cron: '',
        cronValid: true,
        relativeNext: null,
      }),
      'manual only',
    )
  })

  it('flags invalid schedules instead of a blank dash', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: true,
        cron: 'every day',
        cronValid: false,
        relativeNext: null,
      }),
      "won't fire — invalid schedule",
    )
  })

  it('flags a missing workspace instead of a blank dash', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: true,
        cron: '0 9 * * *',
        cronValid: true,
        workspaceValid: false,
        workspaceReady: false,
        runtimeInstalled: true,
        relativeNext: null,
      }),
      "won't fire — no workspace",
    )
  })

  it('flags a non-ready workspace instead of a blank dash', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: true,
        cron: '0 9 * * *',
        cronValid: true,
        workspaceValid: true,
        workspaceReady: false,
        runtimeInstalled: true,
        relativeNext: null,
      }),
      "won't fire — workspace not ready",
    )
  })

  it('flags a missing runtime binary instead of a blank dash', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: true,
        cron: '0 9 * * *',
        cronValid: true,
        workspaceValid: true,
        workspaceReady: true,
        runtimeInstalled: false,
        relativeNext: null,
      }),
      "won't fire — runtime not on PATH",
    )
  })

  it('flags an empty prompt instead of a blank dash', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: true,
        cron: '0 9 * * *',
        cronValid: true,
        workspaceValid: true,
        workspaceReady: true,
        runtimeInstalled: true,
        promptValid: false,
        relativeNext: null,
      }),
      "won't fire — empty prompt",
    )
  })

  it('uses the relative next time when armed and valid', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: true,
        cron: '0 9 * * *',
        cronValid: true,
        workspaceValid: true,
        workspaceReady: true,
        runtimeInstalled: true,
        promptValid: true,
        relativeNext: 'in 3h',
      }),
      'in 3h',
    )
  })

  it('notes that a fire-once schedule pauses after the next run', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: true,
        cron: '1 3 * * *',
        cronValid: true,
        workspaceValid: true,
        workspaceReady: true,
        runtimeInstalled: true,
        promptValid: true,
        fireOnce: true,
        relativeNext: 'in 3h',
      }),
      'in 3h · then pause',
    )
  })

  it('falls back to an em dash when next time is missing', () => {
    assert.equal(
      nextRunDetailLabel({
        enabled: true,
        cron: '0 9 * * *',
        cronValid: true,
        workspaceValid: true,
        workspaceReady: true,
        runtimeInstalled: true,
        relativeNext: null,
      }),
      '—',
    )
  })
})

describe('invalidTriggerEditorSeed', () => {
  it('passes through a valid cron unchanged', () => {
    assert.deepEqual(invalidTriggerEditorSeed('0 9 * * 1-5'), {
      cron: '0 9 * * 1-5',
      addingTrigger: false,
      triggerDraft: '',
      showInvalid: false,
    })
  })

  it('opens the custom trigger editor with the bad draft for repair', () => {
    assert.deepEqual(invalidTriggerEditorSeed('every day'), {
      cron: '',
      addingTrigger: true,
      triggerDraft: 'every day',
      showInvalid: true,
    })
  })

  it('treats empty as a normal manual-only seed', () => {
    assert.deepEqual(invalidTriggerEditorSeed(''), {
      cron: '',
      addingTrigger: false,
      triggerDraft: '',
      showInvalid: false,
    })
    assert.deepEqual(invalidTriggerEditorSeed(null), {
      cron: '',
      addingTrigger: false,
      triggerDraft: '',
      showInvalid: false,
    })
  })
})

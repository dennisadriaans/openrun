import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bindAutomationEvents,
  cloudConnectionIdFromConfig,
  defaultAutomationPrompt,
  defaultInstallEvents,
} from './automation.ts'
import { providerMeta } from './catalog.ts'

test('default install events are non-empty per provider', () => {
  for (const provider of ['github', 'jira', 'linear'] as const) {
    assert.ok(defaultInstallEvents(provider).length > 0)
    assert.ok(defaultAutomationPrompt(provider).includes('{{issue.title}}'))
  }
})

test('cloudConnectionIdFromConfig reads the control-plane connection id', () => {
  assert.equal(
    cloudConnectionIdFromConfig('{"installMethod":"hosted","cloudConnectionId":"jconn_1"}'),
    'jconn_1',
  )
  assert.equal(cloudConnectionIdFromConfig('{"cloudConnectionId":"  "}'), null)
  assert.equal(cloudConnectionIdFromConfig('{}'), null)
  assert.equal(cloudConnectionIdFromConfig('not-json'), null)
})

test('bindAutomationEvents keeps only ids the provider can emit', () => {
  const jiraIds = providerMeta('jira')!.events.map((event) => event.id)

  assert.deepEqual(
    bindAutomationEvents('jira', ['jira:issue_created', 'jira:issue_updated'], jiraIds),
    ['jira:issue_created', 'jira:issue_updated'],
  )
  // An id no delivery can carry would bind an automation that never fires.
  assert.deepEqual(bindAutomationEvents('jira', ['issues.opened'], jiraIds), [
    'jira:issue_created',
    'jira:issue_status_changed',
  ])
  assert.deepEqual(bindAutomationEvents('jira', [], jiraIds), [
    'jira:issue_created',
    'jira:issue_status_changed',
  ])
  assert.deepEqual(bindAutomationEvents('jira', undefined, jiraIds), [
    'jira:issue_created',
    'jira:issue_status_changed',
  ])
})

test('bindAutomationEvents can keep an empty list for every-event triggers', () => {
  const jiraIds = providerMeta('jira')!.events.map((event) => event.id)
  assert.deepEqual(bindAutomationEvents('jira', [], jiraIds, { allowEmpty: true }), [])
  assert.deepEqual(
    bindAutomationEvents('jira', ['issues.opened'], jiraIds, { allowEmpty: true }),
    [],
  )
  assert.deepEqual(
    bindAutomationEvents('jira', ['jira:issue_created'], jiraIds, { allowEmpty: true }),
    ['jira:issue_created'],
  )
})

test('bindAutomationEvents trims and de-duplicates', () => {
  const linearIds = providerMeta('linear')!.events.map((event) => event.id)
  assert.deepEqual(bindAutomationEvents('linear', [' Issue.create ', 'Issue.create'], linearIds), [
    'Issue.create',
  ])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertPublicBaseUrl,
  cloudConnectionIdFromConfig,
  defaultAutomationPrompt,
  defaultInstallEvents,
  githubHookEventsFromCatalog,
  isLikelyLocalhostUrl,
  jiraRemoteEventsFromCatalog,
  linearResourceTypesFromCatalog,
  parseGithubOwnerRepo,
  remoteInstallBaseUrl,
} from './install.ts'

test('isLikelyLocalhostUrl detects loopback hosts', () => {
  assert.equal(isLikelyLocalhostUrl('http://localhost:3000'), true)
  assert.equal(isLikelyLocalhostUrl('http://127.0.0.1:3000'), true)
  assert.equal(isLikelyLocalhostUrl('https://abc.ngrok-free.app'), false)
})

test('assertPublicBaseUrl rejects localhost and accepts tunnels', () => {
  assert.throws(() => assertPublicBaseUrl('http://localhost:3000'), /cannot reach localhost/)
  assert.throws(() => assertPublicBaseUrl(''), /public base URL/i)
  assert.equal(assertPublicBaseUrl('https://abc.ngrok-free.app/'), 'https://abc.ngrok-free.app')
})

test('remoteInstallBaseUrl skips empty and localhost, validates the rest', () => {
  assert.equal(remoteInstallBaseUrl(''), null)
  assert.equal(remoteInstallBaseUrl('http://localhost:3001'), null)
  assert.equal(remoteInstallBaseUrl('https://abc.ngrok-free.app/'), 'https://abc.ngrok-free.app')
  assert.throws(() => remoteInstallBaseUrl('not-a-url'), /absolute/i)
})

test('parseGithubOwnerRepo accepts remotes and shorthand', () => {
  assert.deepEqual(parseGithubOwnerRepo('owner/repo'), { owner: 'owner', repo: 'repo' })
  assert.deepEqual(parseGithubOwnerRepo('https://github.com/acme/app.git'), {
    owner: 'acme',
    repo: 'app',
  })
  assert.deepEqual(parseGithubOwnerRepo('git@github.com:acme/app.git'), {
    owner: 'acme',
    repo: 'app',
  })
  assert.equal(parseGithubOwnerRepo('not-a-repo'), null)
})

test('default install events are non-empty per provider', () => {
  for (const provider of ['github', 'jira', 'linear'] as const) {
    assert.ok(defaultInstallEvents(provider).length > 0)
    assert.ok(defaultAutomationPrompt(provider).includes('{{issue.title}}'))
  }
})

test('cloudConnectionIdFromConfig only reads hosted rows', () => {
  assert.equal(
    cloudConnectionIdFromConfig('{"installMethod":"hosted","cloudConnectionId":"jconn_1"}'),
    'jconn_1',
  )
  assert.equal(
    cloudConnectionIdFromConfig('{"installMethod":"api","cloudConnectionId":"jconn_1"}'),
    null,
  )
  assert.equal(cloudConnectionIdFromConfig('{}'), null)
  assert.equal(cloudConnectionIdFromConfig('not-json'), null)
})

test('catalog events map to remote provider subscriptions', () => {
  assert.deepEqual(githubHookEventsFromCatalog(['issues.opened', 'issues.closed']), ['issues'])
  assert.deepEqual(linearResourceTypesFromCatalog(['Issue.create', 'Comment.create']), [
    'Issue',
    'Comment',
  ])
  assert.deepEqual(
    jiraRemoteEventsFromCatalog(['jira:issue_created', 'jira:issue_status_changed']),
    ['jira:issue_created', 'jira:issue_updated'],
  )
})

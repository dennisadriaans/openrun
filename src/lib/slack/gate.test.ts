import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSlackUserAllowed,
  normalizeUserIds,
  slackAuthRefusal,
  slackConfigRefusal,
} from './gate.ts'
import { emptySlackSettings } from './types.ts'

const enabled = { enabled: true, allowedUserIds: ['U123ABC'] }

test('an empty allowlist authorises nobody', () => {
  // Default deny is the whole point: a Slack message reaching runTaskNow is
  // remote code execution on the user's machine.
  const refusal = slackAuthRefusal({
    userId: 'U123ABC',
    settings: { enabled: true, allowedUserIds: [] },
  })
  assert.match(refusal ?? '', /No Slack users are allowed/)
})

test('an allowlisted human passes', () => {
  assert.equal(slackAuthRefusal({ userId: 'U123ABC', settings: enabled }), null)
  assert.equal(isSlackUserAllowed({ userId: 'U123ABC', settings: enabled }), true)
})

test('a stranger in the same channel is refused by id', () => {
  const refusal = slackAuthRefusal({ userId: 'U999ZZZ', settings: enabled })
  assert.match(refusal ?? '', /U999ZZZ is not on the Open Run allowlist/)
})

test('messages from apps never steer a run', () => {
  // An echo bot reposting a command must not replay it back at us.
  const refusal = slackAuthRefusal({ userId: 'U123ABC', botId: 'B0001', settings: enabled })
  assert.match(refusal ?? '', /Commands from apps are ignored/)
})

test('the master switch refuses before anything else is considered', () => {
  const refusal = slackAuthRefusal({
    userId: 'U123ABC',
    settings: { enabled: false, allowedUserIds: ['U123ABC'] },
  })
  assert.match(refusal ?? '', /turned off/)
})

test('an unidentifiable sender is refused', () => {
  assert.match(slackAuthRefusal({ userId: '', settings: enabled }) ?? '', /who sent/)
})

test('normalizeUserIds copes with how people actually paste ids', () => {
  assert.deepEqual(normalizeUserIds(['<@U123ABC>']), ['U123ABC'])
  assert.deepEqual(normalizeUserIds(['u123abc']), ['U123ABC'])
  assert.deepEqual(normalizeUserIds(['U123ABC, U456DEF']), ['U123ABC', 'U456DEF'])
  assert.deepEqual(normalizeUserIds(['U123ABC U123ABC']), ['U123ABC'])
  assert.deepEqual(normalizeUserIds(['W123ABC']), ['W123ABC'])
})

test('normalizeUserIds drops things that are not member ids', () => {
  // A channel id, a display name and a too-short id are all not member ids —
  // letting any of them through would widen the allowlist silently.
  assert.deepEqual(normalizeUserIds(['dennis', 'C0123CHAN', '', 'U1']), [])
  assert.deepEqual(normalizeUserIds(undefined), [])
})

test('slackConfigRefusal names the missing piece', () => {
  assert.match(slackConfigRefusal(emptySlackSettings()) ?? '', /bot token/)
  assert.match(
    slackConfigRefusal(emptySlackSettings({ botToken: 'nope' })) ?? '',
    /should start with xoxb-/,
  )
  assert.match(
    slackConfigRefusal(emptySlackSettings({ botToken: 'xoxb-1' })) ?? '',
    /app-level token/,
  )
  assert.match(
    slackConfigRefusal(emptySlackSettings({ botToken: 'xoxb-1', appToken: 'xapp-1' })) ?? '',
    /empty allowlist blocks everyone/,
  )
  assert.equal(
    slackConfigRefusal(
      emptySlackSettings({
        botToken: 'xoxb-1',
        appToken: 'xapp-1',
        allowedUserIds: ['U123ABC'],
      }),
    ),
    null,
  )
})

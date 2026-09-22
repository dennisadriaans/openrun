import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { CliSession } from './session.ts'
import { TerminalSurface } from './terminal.ts'

const [major, minor] = process.versions.node.split('.').map(Number)
const canRender =
  Boolean(process.versions.bun) ||
  ((major! > 26 || (major === 26 && minor! >= 4)) &&
    process.execArgv.includes('--experimental-ffi'))

for (const [width, height] of [
  [40, 18],
  [80, 24],
  [120, 40],
]) {
  test(`chat keeps input, history and overview during saves at ${width}×${height}`, {
    skip: !canRender,
  }, async () => {
    const core = await import('@opentui/core')
    const { createTestRenderer } = await import('@opentui/core/testing')
    const screen = await createTestRenderer({ width, height, exitOnCtrlC: false })
    const session = new CliSession(null)
    const terminal = Reflect.construct(TerminalSurface, [
      screen.renderer,
      core,
      session,
    ]) as TerminalSurface
    try {
      session.updateOverview({
        scheduled: 1,
        runs: 5,
        running: 1,
        integrations: 2,
        tasks: [{ id: 'task', prompt: 'Existing schedule', when: 'Tomorrow' }],
        activeRuns: [{ id: 'run', prompt: 'Existing run', when: 'Running' }],
      })
      const first = terminal.homeRequest([])
      void first.catch(() => {})
      await screen.mockInput.typeText('sch')
      await screen.flush()
      assert.match(screen.captureCharFrame(), /│ schedule/)
      screen.mockInput.pressTab()
      screen.mockInput.pressEnter()
      assert.equal(await first, 'schedule')
      session.begin('schedule')
      terminal.beginAction()
      session.progress('Saving schedule')
      await screen.mockInput.typeText('integrations')
      screen.mockInput.pressEnter()
      assert.equal(session.pending[0]?.text, 'integrations')
      await delay(200)
      await screen.renderOnce()
      const frame = screen.captureCharFrame()
      assert.match(frame, /Saving schedule/)
      assert.match(frame, /Scheduled/)
      assert.match(frame, /Integrations/)
      assert.match(frame, /What should Open Run do/)
      const footer = screen.renderer.root.findDescendantById('keyboard-help')!
      assert.equal(footer.height, 1)
      assert.ok(footer.y + footer.height <= height!, frame)
      session.log('assistant', 'Scheduled testabc.html')
      session.finish()
      terminal.endAction()
      assert.equal(await terminal.homeRequest(['schedule']), 'integrations')
      await screen.renderOnce()
      assert.match(screen.captureCharFrame(), /Scheduled testabc.html/)
      assert.deepEqual(
        session.entries.filter((entry) => entry.role === 'user').map((entry) => entry.text),
        ['schedule', 'integrations'],
      )
    } finally {
      terminal.close(undefined, false)
    }
  })
}

test('Enter accepts a suggestion without dispatching it and editing a busy draft survives the next prompt', {
  skip: !canRender,
}, async () => {
  const core = await import('@opentui/core')
  const { createTestRenderer } = await import('@opentui/core/testing')
  const screen = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false })
  const session = new CliSession(null)
  const terminal = Reflect.construct(TerminalSurface, [
    screen.renderer,
    core,
    session,
  ]) as TerminalSurface
  try {
    let submitted = false
    const first = terminal.homeRequest([]).then((text) => {
      submitted = true
      return text
    })
    await screen.mockInput.typeText('integ')
    screen.mockInput.pressEnter()
    await delay(0)
    assert.equal(submitted, false)
    screen.mockInput.pressEnter()
    assert.equal(await first, 'integrations')
    session.begin('integrations')
    await screen.mockInput.typeText('review my changes')
    session.finish()
    const second = terminal.homeRequest(['integrations'])
    await screen.renderOnce()
    assert.match(screen.captureCharFrame(), /review my changes/)
    screen.mockInput.pressEnter()
    assert.equal(await second, 'review my changes')
    session.begin('review my changes')
    session.finish()
    const third = terminal.homeRequest(['integrations', 'review my changes'])
    screen.mockInput.pressKey('ARROW_UP')
    screen.mockInput.pressKey('ARROW_UP')
    await screen.flush()
    assert.equal(session.draft, 'integrations')
    screen.mockInput.pressKey('ARROW_DOWN')
    await screen.flush()
    assert.equal(session.draft, 'review my changes')
    screen.mockInput.pressEnter()
    assert.equal(await third, 'review my changes')
  } finally {
    terminal.close(undefined, false)
  }
})

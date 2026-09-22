import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  commandCorrection,
  editableCommand,
  readCliArgs,
  readCliLine,
  requestsUnattended,
  splitCommandLine,
} from './args.ts'

test('Home keeps implicit task text verbatim and explicit option values opaque', () => {
  const request = "create new file index-test.html with contents '123' sonnet low"
  assert.deepEqual(readCliLine(request).flags.rest, [request])
  assert.deepEqual(readCliLine(`launch ${request}`).flags.rest, [request])
  assert.deepEqual(readCliLine('launch').flags.rest, [])
  assert.deepEqual(readCliLine('launch --model sonnet --prompt "write sonnet low"').flags.rest, [
    '--model=sonnet',
    '--prompt=write sonnet low',
  ])
  assert.deepEqual(readCliLine('run -- "write sonnet low"').flags.rest, ['--', 'write sonnet low'])
  assert.equal(readCliLine('runs').command, 'runs')
})

test('implicit requests retain all their words and known commands keep their meaning', () => {
  const natural = readCliArgs(['sol', 'medium', '--dry-run'])
  assert.equal(natural.command, 'launch')
  assert.deepEqual(natural.flags.rest, ['sol', 'medium'])
  assert.equal(
    readCliArgs(['schedule', 'in', '10', 'minutes', 'review changes']).command,
    'schedule',
  )
  const explicit = readCliArgs([
    'launch',
    '--runtime',
    'codex',
    '--effort',
    'medium',
    '--',
    'fix the schedule page',
  ])
  assert.deepEqual(explicit.flags.rest, [
    '--runtime=codex',
    '--effort=medium',
    '--',
    'fix the schedule page',
  ])
  assert.throws(() => readCliArgs(['resume']), /run ID/)
  assert.equal(readCliArgs(['resume', 'run_1', '--dry-run', '--json']).flags.dryRun, true)
})

test('help is scoped to a command, including nested automation commands', () => {
  assert.equal(readCliArgs([]).help, true)
  for (const argv of [
    ['help', 'schedule'],
    ['schedule', '--help'],
    ['automations', 'schedule', '-h'],
  ]) {
    const result = readCliArgs(argv)
    assert.equal(result.help, true)
    assert.equal(result.command, 'schedule')
  }
})

test('option values remain opaque to global options and help', () => {
  const result = readCliArgs(['run', '--prompt=--help', '--for=codex', '--json'])
  assert.equal(result.help, false)
  assert.equal(result.flags.json, true)
  assert.deepEqual(result.flags.rest, ['--prompt=--help', '--runtime=codex'])
  const literal = readCliArgs(['run', '--', '--help', '--json', 'now'])
  assert.equal(literal.help, false)
  assert.equal(literal.flags.json, false)
  assert.deepEqual(literal.flags.rest, ['--', '--help', '--json', 'now'])
})

test('missing and unsupported options fail before a command can run', () => {
  for (const argv of [
    ['run', '--runtime', '--model', 'default', 'fix it'],
    ['schedule', '--runtime=', 'fix it'],
    ['integrations', 'configure', '--event', '--prompt', 'work'],
  ])
    assert.throws(() => readCliArgs(argv), /needs a value/)
  assert.throws(() => readCliArgs(['init', '--model', 'default']), /not supported/)
  assert.throws(() => readCliArgs(['runs', '--limit', '1.5']), /positive integer/)
  assert.throws(() => readCliArgs(['runs', '--jsno']), /Unknown option/)
  assert.throws(() => readCliArgs(['runs', '--json=false']), /does not take a value/)
})

test('extra arguments cannot silently mutate a different resource', () => {
  assert.throws(() => readCliArgs(['worker', 'stop', 'extra']), /Unexpected argument/)
  assert.throws(
    () => readCliArgs(['integrations', 'disconnect', 'one', 'two']),
    /Unexpected argument/,
  )
  assert.throws(() => readCliArgs(['cancel']), /run ID/)
  assert.throws(() => readCliArgs(['automations', 'login']), /Unknown automations command/)
  assert.throws(() => readCliArgs(['automations', 'rm', 'nightly', '--dry-run']), /supported by/)
})

test('global options work before the command and aliases use the same validation', () => {
  const result = readCliArgs(['--json', '--url=http://localhost:3000', 'automations', 'list'])
  assert.equal(result.command, 'ls')
  assert.equal(result.flags.url, 'http://localhost:3000')
  assert.deepEqual(result.flags.rest, [])
  assert.equal(
    readCliArgs(['automations', 'schedule', '--dry-run', 'daily', 'fix it']).flags.dryRun,
    true,
  )
  const integration = readCliArgs(['integrations', '--runtime', 'codex', 'configure', '--event=x'])
  assert.deepEqual(integration.flags.rest, ['configure', '--runtime=codex', '--event=x'])
})

test('interactive commands may omit choices while scripts still require them', () => {
  assert.equal(readCliArgs([], true).help, false)
  assert.equal(readCliArgs(['cancel'], true).command, 'cancel')
  assert.equal(readCliArgs(['disable'], true).command, 'disable')
  assert.throws(() => readCliArgs(['cancel', '--yes'], true), /run ID/)
  assert.throws(() => readCliArgs(['disable', '--json'], true), /automation/)
  assert.equal(readCliArgs(['run', '-y', 'explain it']).flags.yes, true)
})

test('noninteractive flags inside prompt values remain literal', () => {
  assert.equal(requestsUnattended(['run', '--prompt', '--yes']), false)
  assert.equal(requestsUnattended(['run', '--', '--json']), false)
  assert.equal(requestsUnattended(['run', '--prompt=--json']), false)
  assert.equal(requestsUnattended(['run', '--typo', '--json']), true)
})

test('command correction retains quoted prompts and remote options without shell expansion', () => {
  const argv = [
    'run',
    '--prompt=review Bob\'s "build" $HOME `code`',
    '--url=https://example.com',
    '--token=a b',
  ]
  assert.deepEqual(splitCommandLine(editableCommand(argv)), argv)
  assert.deepEqual(splitCommandLine('run "$(touch file)"'), ['run', '$(touch file)'])
  assert.throws(() => splitCommandLine('run "unfinished'), /Close the quoted/)
})

test('the correction editor keeps authentication out of visible command text', () => {
  const correction = commandCorrection([
    '--token=fixture-secret',
    '--url=https://example.com',
    'rnu',
    'explain this',
  ])
  assert.ok(!correction.line.includes('fixture-secret'))
  const parsed = readCliArgs(correction.parse(correction.line.replace('rnu', 'run')))
  assert.equal(parsed.flags.token, 'fixture-secret')
  assert.equal(parsed.flags.url, 'https://example.com')
})

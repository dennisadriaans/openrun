import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  prCapabilityWarning,
  resolveRuntime,
  resolveTask,
  resolveWorkspace,
  type RuntimeChoice,
  type TaskChoice,
  type WorkspaceChoice,
  workspaceScheduleWarning,
} from './cliResolve.ts'

const RUNTIMES: RuntimeChoice[] = [
  { id: 'rt_1', label: 'Claude Code', bin: 'claude', enabled: 1, canOpenPrs: 1 },
  { id: 'rt_2', label: 'Codex', bin: 'codex', enabled: 1, canOpenPrs: 0 },
  { id: 'rt_3', label: 'Gemini', bin: 'gemini', enabled: 0, canOpenPrs: 0 },
]

const WORKSPACES: WorkspaceChoice[] = [
  {
    id: 'ws_main',
    name: 'main',
    path: '/home/me/code/openrun',
    branch: 'main',
    projectName: 'openrun',
    kind: 'main',
    status: 'ready',
    activeRunId: null,
  },
  {
    id: 'ws_wt',
    name: 'feat-homepage',
    path: '/home/me/.openrun/worktrees/openrun-homepage',
    branch: 'feat/homepage',
    projectName: 'openrun',
    kind: 'worktree',
    status: 'ready',
    activeRunId: null,
  },
  {
    id: 'ws_other',
    name: 'main',
    path: '/home/me/code/storefront',
    branch: 'main',
    projectName: 'storefront',
    kind: 'worktree',
    status: 'ready',
    activeRunId: null,
  },
]

function resolvedRuntime(hint: string, runtimes = RUNTIMES): RuntimeChoice {
  const result = resolveRuntime(hint, runtimes)
  assert.ok(result.ok, result.ok ? '' : result.error)
  return result.value
}

function runtimeRefusal(hint: string, runtimes = RUNTIMES): string {
  const result = resolveRuntime(hint, runtimes)
  assert.ok(!result.ok, 'expected a refusal')
  return result.error
}

describe('resolveRuntime', () => {
  it('matches a binary, a label and an id', () => {
    assert.equal(resolvedRuntime('claude').id, 'rt_1')
    assert.equal(resolvedRuntime('Claude Code').id, 'rt_1')
    assert.equal(resolvedRuntime('rt_2').id, 'rt_2')
  })

  it('accepts a unique prefix but refuses an ambiguous one', () => {
    assert.equal(resolvedRuntime('cla').id, 'rt_1')
    assert.match(runtimeRefusal('c'), /matches claude and codex/)
  })

  it('takes the only enabled runtime when the line named none', () => {
    assert.equal(resolvedRuntime('', [RUNTIMES[0]!]).id, 'rt_1')
    assert.match(runtimeRefusal(''), /Which runtime\?.*claude, codex/s)
  })

  it('selects the only installed runtime and explains unavailable choices', () => {
    const runtimes = [
      { ...RUNTIMES[0]!, installed: false },
      { ...RUNTIMES[1]!, installed: true },
    ]
    assert.equal(resolvedRuntime('', runtimes).id, 'rt_2')
    assert.match(runtimeRefusal('claude', runtimes), /not installed/)
    assert.match(runtimeRefusal('', [runtimes[0]!]), /No enabled agent CLI is installed/)
  })

  it('says a runtime is disabled rather than missing', () => {
    assert.match(runtimeRefusal('gemini'), /is disabled/)
  })

  it('names what is available when nothing matches', () => {
    assert.match(runtimeRefusal('cursor'), /No runtime called "cursor".*claude, codex/s)
  })

  it('refuses clearly when no runtime is enabled at all', () => {
    assert.match(runtimeRefusal('claude', [RUNTIMES[2]!]), /No runtimes are enabled/)
  })
})

describe('resolveWorkspace', () => {
  it('picks the workspace containing the cwd', () => {
    const result = resolveWorkspace('', '/home/me/code/openrun/src/lib', WORKSPACES)
    assert.ok(result.ok)
    assert.equal(result.value.id, 'ws_main')
  })

  it('prefers the deepest matching path, so a nested worktree wins', () => {
    const nested: WorkspaceChoice[] = [
      { ...WORKSPACES[0]!, path: '/repo' },
      { ...WORKSPACES[1]!, path: '/repo/worktrees/a' },
    ]
    const result = resolveWorkspace('', '/repo/worktrees/a/src', nested)
    assert.ok(result.ok)
    assert.equal(result.value.id, 'ws_wt')
  })

  it('matches a hint by branch, name and project', () => {
    for (const hint of ['feat/homepage', 'feat-homepage']) {
      const result = resolveWorkspace(hint, '/tmp', WORKSPACES)
      assert.ok(result.ok, hint)
      assert.equal(result.value.id, 'ws_wt')
    }
    const project = resolveWorkspace('storefront', '/tmp', WORKSPACES)
    assert.ok(project.ok)
    assert.equal(project.value.id, 'ws_other')
  })

  it('matches a hint given as a path', () => {
    const result = resolveWorkspace('/home/me/code/storefront/', '/tmp', WORKSPACES)
    assert.ok(result.ok)
    assert.equal(result.value.id, 'ws_other')
  })

  it('lists the options rather than guessing between them', () => {
    const outside = resolveWorkspace('', '/tmp', WORKSPACES)
    assert.ok(!outside.ok)
    assert.match(outside.error, /Not inside a known workspace/)
    assert.match(outside.error, /\/home\/me\/code\/storefront/)

    const many = resolveWorkspace('openrun', '/tmp', WORKSPACES)
    assert.ok(!many.ok)
    assert.match(many.error, /matches 2 workspaces/)
  })

  it('does not run in another repository just because it is the only workspace', () => {
    const result = resolveWorkspace('', '/tmp', [WORKSPACES[1]!])
    assert.ok(!result.ok)
    assert.match(result.error, /openrun init/)
  })

  it('resolves relative workspace paths from the current directory', () => {
    const result = resolveWorkspace('../storefront', '/home/me/code/openrun', WORKSPACES)
    assert.ok(result.ok)
    assert.equal(result.value.id, 'ws_other')
    const here = resolveWorkspace('.', '/home/me/code/openrun/src', WORKSPACES)
    assert.ok(here.ok)
    assert.equal(here.value.id, 'ws_main')
    const absolute = resolveWorkspace('/home/me/code/openrun/../storefront', '/tmp', WORKSPACES)
    assert.ok(absolute.ok)
    assert.equal(absolute.value.id, 'ws_other')
  })

  it('ignores archived workspaces', () => {
    const archived = [{ ...WORKSPACES[1]!, status: 'archived' }]
    const result = resolveWorkspace('', '/tmp', archived)
    assert.ok(!result.ok)
    assert.match(result.error, /No workspaces yet/)
  })
})

describe('workspaceScheduleWarning', () => {
  it('accepts the main checkout as the base for a fresh execution worktree', () => {
    assert.equal(workspaceScheduleWarning(WORKSPACES[0]!), null)
  })

  it('passes a ready worktree', () => {
    assert.equal(workspaceScheduleWarning(WORKSPACES[1]!), null)
  })

  it('names a workspace that is not ready, or busy', () => {
    assert.match(workspaceScheduleWarning({ ...WORKSPACES[1]!, status: 'creating' })!, /not ready/)
    assert.match(workspaceScheduleWarning({ ...WORKSPACES[1]!, activeRunId: 'run_1' })!, /queue/)
  })
})

describe('prCapabilityWarning', () => {
  it('warns only when a pull request was asked of a runtime that may not open one', () => {
    assert.equal(prCapabilityWarning(RUNTIMES[0]!, true), null)
    assert.equal(prCapabilityWarning(RUNTIMES[1]!, false), null)
    assert.match(prCapabilityWarning(RUNTIMES[1]!, true)!, /May open pull requests/)
  })

  it('can be suppressed for a one-off run that needs no schedule', () => {
    assert.equal(prCapabilityWarning(RUNTIMES[1]!, true, true), null)
  })
})

const TASKS: TaskChoice[] = [
  { id: 'task_1', name: 'Nightly dependency sweep', enabled: 1 },
  { id: 'task_2', name: 'Weekly changelog draft', enabled: 0 },
  { id: 'task_3', name: 'Nightly flake hunt', enabled: 1 },
]

describe('resolveTask', () => {
  it('matches an id and an exact name', () => {
    const byId = resolveTask('task_2', TASKS)
    assert.ok(byId.ok)
    assert.equal(byId.value.id, 'task_2')

    const byName = resolveTask('weekly changelog draft', TASKS)
    assert.ok(byName.ok)
    assert.equal(byName.value.id, 'task_2')
  })

  it('prefers an exact ID over another automation with that name', () => {
    const result = resolveTask('task_2', [...TASKS, { id: 'task_4', name: 'task_2' }])
    assert.ok(result.ok)
    assert.equal(result.value.id, 'task_2')
  })

  it('matches a unique substring', () => {
    const result = resolveTask('changelog', TASKS)
    assert.ok(result.ok)
    assert.equal(result.value.id, 'task_2')
  })

  it('refuses an ambiguous substring rather than firing the wrong one', () => {
    const result = resolveTask('nightly', TASKS)
    assert.ok(!result.ok)
    assert.match(result.error, /matches 2 automations/)
    assert.match(result.error, /task_3/)
  })

  it('refuses an empty hint and an empty list with different words', () => {
    const empty = resolveTask('', TASKS)
    assert.ok(!empty.ok)
    assert.match(empty.error, /Which automation\?/)

    const none = resolveTask('anything', [])
    assert.ok(!none.ok)
    assert.match(none.error, /No automations yet/)
  })

  it('lists what exists when nothing matches', () => {
    const result = resolveTask('nope', TASKS)
    assert.ok(!result.ok)
    assert.match(result.error, /No automation matches "nope"/)
    assert.match(result.error, /Nightly dependency sweep/)
  })
})

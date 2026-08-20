import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  displayPath,
  editHunksFromInput,
  hasEditHunks,
  toolCallVerb,
  toolCallView,
} from './toolCallView.ts'

describe('displayPath', () => {
  it('keeps the last two directories of an absolute path', () => {
    assert.deepEqual(displayPath('/home/dev/projects/dashboard/app/pages/payments.vue'), {
      path: '/home/dev/projects/dashboard/app/pages/payments.vue',
      dir: 'app/pages',
      name: 'payments.vue',
    })
  })

  it('handles a bare filename and a line number', () => {
    assert.deepEqual(displayPath('README.md', 12), {
      path: 'README.md',
      dir: '',
      name: 'README.md',
      line: 12,
    })
  })
})

describe('toolCallVerb', () => {
  it('uses past tense once the call has settled', () => {
    assert.equal(toolCallVerb('execute', 'Bash', 'completed'), 'Ran')
    assert.equal(toolCallVerb('read', 'Read', 'completed'), 'Read')
    assert.equal(toolCallVerb('edit', 'Edit', 'completed'), 'Edited')
    assert.equal(toolCallVerb('edit', 'Write', 'completed'), 'Wrote')
    assert.equal(toolCallVerb('search', 'Grep', 'completed'), 'Searched')
    assert.equal(toolCallVerb('search', 'Glob', 'completed'), 'Found')
  })

  it('uses progressive tense while the call is in flight', () => {
    assert.equal(toolCallVerb('execute', 'Bash', 'in_progress'), 'Running')
    assert.equal(toolCallVerb('read', 'Read', 'pending'), 'Reading')
    assert.equal(toolCallVerb('edit', 'Write', 'in_progress'), 'Writing')
  })
})

describe('editHunksFromInput', () => {
  it('reads a Claude Edit payload', () => {
    assert.deepEqual(
      editHunksFromInput({
        file_path: 'a.ts',
        old_string: 'foo',
        new_string: 'bar',
      }),
      [{ oldString: 'foo', newString: 'bar' }],
    )
  })

  it('reads a MultiEdit edits array', () => {
    assert.deepEqual(
      editHunksFromInput({
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
      [
        { oldString: 'a', newString: 'b' },
        { oldString: 'c', newString: 'd' },
      ],
    )
  })
})

describe('toolCallView', () => {
  it('models a Bash call as Ran + command', () => {
    const view = toolCallView({
      name: 'Bash',
      title: 'Bash · pnpm lint 2>&1 | tail -40',
      toolKind: 'execute',
      status: 'completed',
      toolInput: {
        command: 'pnpm lint 2>&1 | tail -40',
        description: 'Run linter to see errors',
      },
    })
    assert.equal(view.verb, 'Ran')
    assert.deepEqual(view.target, {
      type: 'command',
      command: 'pnpm lint 2>&1 | tail -40',
      description: 'Run linter to see errors',
    })
  })

  it('models a Read call as a shortened path', () => {
    const view = toolCallView({
      name: 'Read',
      title: 'Read · /repo/app/pages/payments.vue',
      toolKind: 'read',
      status: 'completed',
      toolInput: { file_path: '/repo/app/pages/payments.vue' },
    })
    assert.equal(view.verb, 'Read')
    assert.equal(view.target.type, 'path')
    if (view.target.type !== 'path') return
    assert.equal(view.target.path.dir, 'app/pages')
    assert.equal(view.target.path.name, 'payments.vue')
  })

  it('models an Edit call with hunks', () => {
    const view = toolCallView({
      name: 'Edit',
      toolKind: 'edit',
      status: 'completed',
      toolInput: {
        file_path: 'app/pages/payments.vue',
        old_string: 'const x = 1',
        new_string: 'const x = 2',
      },
    })
    assert.equal(view.verb, 'Edited')
    assert.deepEqual(view.hunks, [{ oldString: 'const x = 1', newString: 'const x = 2' }])
    assert.equal(
      hasEditHunks({
        name: 'Edit',
        toolKind: 'edit',
        toolInput: { old_string: 'const x = 1', new_string: 'const x = 2' },
      }),
      true,
    )
    assert.equal(hasEditHunks({ name: 'Bash', toolKind: 'execute' }), false)
  })

  it('falls back to the title detail when input is missing', () => {
    const view = toolCallView({
      name: 'Bash',
      title: 'Bash · git status',
      toolKind: 'execute',
      status: 'completed',
    })
    assert.deepEqual(view.target, { type: 'command', command: 'git status' })
  })

  it('infers kind from the tool name when ACP kind is absent', () => {
    const view = toolCallView({ name: 'Grep', toolInput: { pattern: 'TODO', path: 'src' } })
    assert.equal(view.kind, 'search')
    assert.equal(view.verb, 'Searched')
    assert.deepEqual(view.target, { type: 'pattern', pattern: 'TODO', scope: 'src' })
  })
})

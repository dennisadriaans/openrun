import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  displayPath,
  editHunksFromInput,
  formatToolResult,
  hasEditHunks,
  humanizeToolName,
  toolCallFields,
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
    assert.equal(toolCallVerb('fetch', 'web_search', 'completed'), 'Searched')
    assert.equal(toolCallVerb('fetch', 'WebFetch', 'completed'), 'Fetched')
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

  it('renders web search as a globe fetch with the query, not the title as a URL', () => {
    const view = toolCallView({
      name: 'Search',
      title: 'Search the web',
      toolKind: 'search',
      status: 'completed',
      toolInput: { query: 'openrun' },
    })
    assert.equal(view.kind, 'fetch')
    assert.equal(view.verb, 'Searched')
    assert.deepEqual(view.target, { type: 'text', text: 'openrun' })
  })
})

describe('humanizeToolName', () => {
  it('reads a snake_case or camelCase tool name as a sentence', () => {
    assert.equal(humanizeToolName('create_issue'), 'Create issue')
    assert.equal(humanizeToolName('get-pull-request'), 'Get pull request')
    assert.equal(humanizeToolName('createIssue'), 'Create Issue')
  })

  it('drops the MCP prefix, since the server is shown separately', () => {
    assert.equal(humanizeToolName('mcp__linear__create_issue'), 'Create issue')
    assert.equal(humanizeToolName('mcp__openrun__run_context'), 'Run context')
  })

  it('leaves a name that is already a word alone, and an empty one empty', () => {
    assert.equal(humanizeToolName('Bash'), 'Bash')
    assert.equal(humanizeToolName(undefined), '')
    assert.equal(humanizeToolName('   '), '')
  })

  it('is what an unknown tool falls back to instead of a raw id', () => {
    assert.equal(toolCallVerb('other', 'mcp__linear__create_issue', 'completed'), 'Create issue')
    assert.equal(toolCallVerb('other', undefined, 'completed'), 'Tool')
  })
})

describe('toolCallFields', () => {
  it('renders an MCP tool\u2019s arguments as labelled rows', () => {
    const fields = toolCallFields({ team_id: 'ENG', issue_title: 'Fix the relay' })
    assert.deepEqual(
      fields.map((f) => [f.label, f.value, f.block]),
      [
        ['Team id', 'ENG', false],
        ['Issue title', 'Fix the relay', false],
      ],
    )
  })

  it('gives a long or multi-line value its own block', () => {
    const [prompt] = toolCallFields({ prompt: 'line one\nline two' })
    assert.equal(prompt?.block, true)
    const [long] = toolCallFields({ body: 'x'.repeat(80) })
    assert.equal(long?.block, true)
  })

  it('skips what the row header already shows, and empty strings', () => {
    const fields = toolCallFields({ command: 'pnpm test', timeout: 5_000, note: '  ' })
    assert.deepEqual(
      fields.map((f) => f.key),
      ['timeout'],
    )
  })

  it('keeps a header key when the header rendered something else', () => {
    const keys = toolCallFields(
      { url: 'https://x.test', query: 'openrun' },
      {
        type: 'text',
        text: 'openrun',
      },
    ).map((f) => f.key)
    assert.deepEqual(keys, ['url', 'query'])
  })

  it('pretty-prints a nested object argument', () => {
    const [field] = toolCallFields({ filter: { state: 'open', labels: ['bug'] } })
    assert.equal(field?.block, true)
    assert.match(String(field?.value), /"state": "open"/)
  })

  it('has nothing to show for a non-object input', () => {
    assert.deepEqual(toolCallFields('just a string'), [])
    assert.deepEqual(toolCallFields(undefined), [])
  })
})

describe('formatToolResult', () => {
  it('pretty-prints a JSON result an MCP server returned on one line', () => {
    assert.equal(
      formatToolResult('{"id":"ENG-42","state":"open"}'),
      '{\n  "id": "ENG-42",\n  "state": "open"\n}',
    )
  })

  it('leaves prose and malformed JSON exactly as they came', () => {
    assert.equal(formatToolResult('Created issue ENG-42.'), 'Created issue ENG-42.')
    assert.equal(formatToolResult('{"id": '), '{"id": ')
  })
})

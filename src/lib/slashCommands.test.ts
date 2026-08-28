import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  APP_SLASH_COMMANDS,
  appCommandFor,
  applySlashCommand,
  commandNameFromPath,
  matchSlashCommands,
  parseCommandMarkdown,
  parseCommandToml,
  parseSlashInput,
  slashMenuQuery,
  type SlashCommand,
} from './slashCommands.ts'

const FILE_COMMANDS: SlashCommand[] = [
  { name: 'review', description: 'Review the diff', source: 'project' },
  { name: 'frontend:component', description: 'Scaffold a component', source: 'user' },
]

describe('parseSlashInput', () => {
  it('splits the command from its arguments', () => {
    assert.deepEqual(parseSlashInput('/review the auth module'), {
      name: 'review',
      args: 'the auth module',
    })
  })

  it('handles a bare command', () => {
    assert.deepEqual(parseSlashInput('/clear'), { name: 'clear', args: '' })
  })

  it('keeps namespaced names intact', () => {
    assert.equal(parseSlashInput('/frontend:component Button')?.name, 'frontend:component')
  })

  it('ignores a slash that is not in the first column', () => {
    assert.equal(parseSlashInput('look in /usr/bin'), null)
  })

  it('ignores a path typed as the whole prompt', () => {
    assert.equal(parseSlashInput('/usr/bin/env'), null)
  })
})

describe('slashMenuQuery', () => {
  it('is the typed name while there is no space', () => {
    assert.equal(slashMenuQuery('/rev'), 'rev')
    assert.equal(slashMenuQuery('/'), '')
  })

  it('closes once arguments start', () => {
    assert.equal(slashMenuQuery('/review '), null)
    assert.equal(slashMenuQuery('/review the diff'), null)
  })

  it('is closed for ordinary prose', () => {
    assert.equal(slashMenuQuery('fix the build'), null)
  })
})

describe('matchSlashCommands', () => {
  const all = [...APP_SLASH_COMMANDS, ...FILE_COMMANDS]

  it('ranks a prefix match above a substring match', () => {
    const names = matchSlashCommands(all, 'c').map((c) => c.name)
    assert.equal(names[0], 'clear')
  })

  it('falls back to the description', () => {
    assert.deepEqual(
      matchSlashCommands(FILE_COMMANDS, 'scaffold').map((c) => c.name),
      ['frontend:component'],
    )
  })

  it('lists app commands first when nothing is typed', () => {
    assert.equal(matchSlashCommands(all, '')[0]?.source, 'app')
  })

  it('returns nothing when there is no match', () => {
    assert.deepEqual(matchSlashCommands(all, 'zzz'), [])
  })
})

describe('appCommandFor', () => {
  const all = [...APP_SLASH_COMMANDS, ...FILE_COMMANDS]

  it('recognises an app command and its argument', () => {
    const found = appCommandFor(all, '/model sonnet-4-5')
    assert.equal(found?.command.action, 'model')
    assert.equal(found?.args, 'sonnet-4-5')
  })

  it('leaves a file command to the agent', () => {
    assert.equal(appCommandFor(all, '/review'), null)
  })

  it('leaves prose alone', () => {
    assert.equal(appCommandFor(all, 'ship it'), null)
  })
})

describe('parseCommandMarkdown', () => {
  it('reads description and argument-hint from frontmatter', () => {
    const meta = parseCommandMarkdown(
      `---\ndescription: Review a pull request\nargument-hint: <pr-number>\n---\n\nDo the thing.\n`,
    )
    assert.deepEqual(meta, { description: 'Review a pull request', argumentHint: '<pr-number>' })
  })

  it('falls back to the first prose line', () => {
    assert.equal(parseCommandMarkdown('# Ship it\n\nDeploy.').description, 'Ship it')
  })

  it('unquotes a quoted description', () => {
    assert.equal(
      parseCommandMarkdown('---\ndescription: "Fix the build"\n---\n').description,
      'Fix the build',
    )
  })
})

describe('parseCommandToml', () => {
  it('reads the description key', () => {
    assert.equal(
      parseCommandToml('description = "Refactor a file"\nprompt = "..."\n').description,
      'Refactor a file',
    )
  })
})

describe('commandNameFromPath', () => {
  it('namespaces sub-directories with a colon', () => {
    assert.equal(
      commandNameFromPath('/home/me/.claude/commands', '/home/me/.claude/commands/git/commit.md'),
      'git:commit',
    )
  })

  it('drops the extension for a top-level command', () => {
    assert.equal(
      commandNameFromPath('/home/me/.codex/prompts', '/home/me/.codex/prompts/ship.md'),
      'ship',
    )
  })

  it('handles a toml command file', () => {
    assert.equal(
      commandNameFromPath('/repo/.gemini/commands', '/repo/.gemini/commands/fix.toml'),
      'fix',
    )
  })
})

describe('applySlashCommand', () => {
  it('leaves a trailing space so arguments can be typed', () => {
    assert.equal(applySlashCommand(FILE_COMMANDS[0]!), '/review ')
  })
})

/**
 * Discovery reads the CLIs' real command directories, so each test points
 * `$HOME` at a throwaway tree and passes a temp workspace as the cwd.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { listSlashCommands } from './slashCommands.ts'

const dirs: string[] = []
const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
let home = ''
let workspace = ''

function write(root: string, relative: string, contents: string): void {
  const file = join(root, relative)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'openrun-cmd-home-'))
  workspace = mkdtempSync(join(tmpdir(), 'openrun-cmd-ws-'))
  dirs.push(home, workspace)
  process.env.HOME = home
  process.env.USERPROFILE = home
})

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  process.env.HOME = savedEnv.HOME
  process.env.USERPROFILE = savedEnv.USERPROFILE
})

describe('listSlashCommands', () => {
  it('finds Claude commands in the workspace and in the home directory', () => {
    write(home, '.claude/commands/standup.md', '---\ndescription: Daily standup\n---\nWrite it.')
    write(workspace, '.claude/commands/review.md', '---\ndescription: Review the diff\n---\nGo.')

    const { commands } = listSlashCommands({ bin: 'claude', cwd: workspace })
    assert.deepEqual(
      commands.map((c) => [c.name, c.description, c.source]),
      [
        ['review', 'Review the diff', 'project'],
        ['standup', 'Daily standup', 'user'],
      ],
    )
  })

  it('lets a workspace command shadow a personal one of the same name', () => {
    write(home, '.claude/commands/review.md', '---\ndescription: Personal\n---\n')
    write(workspace, '.claude/commands/review.md', '---\ndescription: This repo\n---\n')

    const { commands } = listSlashCommands({ bin: 'claude', cwd: workspace })
    assert.equal(commands.length, 1)
    assert.equal(commands[0]?.description, 'This repo')
    assert.equal(commands[0]?.source, 'project')
  })

  it('namespaces a command in a subdirectory the way the CLI does', () => {
    write(workspace, '.claude/commands/git/commit.md', '---\ndescription: Commit\n---\n')

    const { commands } = listSlashCommands({ bin: 'claude', cwd: workspace })
    assert.equal(commands[0]?.name, 'git:commit')
  })

  it('falls back to the first prose line when there is no front matter', () => {
    write(workspace, '.claude/commands/ship.md', '# Ship it\n\nRelease the build.\n')

    const { commands } = listSlashCommands({ bin: 'claude', cwd: workspace })
    assert.equal(commands[0]?.description, 'Ship it')
  })

  it('carries the argument hint the menu shows', () => {
    write(
      workspace,
      '.claude/commands/fix.md',
      '---\ndescription: Fix an issue\nargument-hint: <issue-number>\n---\n',
    )

    assert.equal(
      listSlashCommands({ bin: 'claude', cwd: workspace }).commands[0]?.argumentHint,
      '<issue-number>',
    )
  })

  it('reads Codex prompts from the home directory only', () => {
    write(home, '.codex/prompts/plan.md', '---\ndescription: Plan the work\n---\n')
    write(workspace, '.codex/prompts/local.md', '---\ndescription: Never read\n---\n')

    const { commands, note } = listSlashCommands({ bin: 'codex', cwd: workspace })
    assert.deepEqual(
      commands.map((c) => c.name),
      ['plan'],
    )
    assert.match(String(note), /expands custom commands only if/)
  })

  it('reads Gemini commands from TOML', () => {
    write(workspace, '.gemini/commands/tidy.toml', 'description = "Tidy the tree"\nprompt = "go"\n')

    const { commands } = listSlashCommands({ bin: 'gemini', cwd: workspace })
    assert.deepEqual(
      commands.map((c) => [c.name, c.description]),
      [['tidy', 'Tidy the tree']],
    )
  })

  it('promises nothing for Claude, which really does expand them headlessly', () => {
    write(workspace, '.claude/commands/review.md', '---\ndescription: Review\n---\n')
    assert.equal(listSlashCommands({ bin: 'claude', cwd: workspace }).note, undefined)
  })

  it('ignores files of the wrong format and dot-directories', () => {
    write(workspace, '.claude/commands/notes.txt', 'not a command')
    write(workspace, '.claude/commands/.hidden/secret.md', '---\ndescription: no\n---\n')
    write(workspace, '.claude/commands/real.md', '---\ndescription: yes\n---\n')

    assert.deepEqual(
      listSlashCommands({ bin: 'claude', cwd: workspace }).commands.map((c) => c.name),
      ['real'],
    )
  })

  it('has nothing for a CLI with no command directory, and none for an unknown one', () => {
    assert.deepEqual(listSlashCommands({ bin: 'claude', cwd: workspace }).commands, [])
    assert.deepEqual(listSlashCommands({ bin: 'my-agent', cwd: workspace }).commands, [])
  })

  it('still reads personal commands with no workspace picked', () => {
    write(home, '.claude/commands/standup.md', '---\ndescription: Daily standup\n---\n')
    assert.deepEqual(
      listSlashCommands({ bin: 'claude' }).commands.map((c) => c.name),
      ['standup'],
    )
  })
})

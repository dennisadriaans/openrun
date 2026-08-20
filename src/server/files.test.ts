import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { putWorkspaceFile, writeWorkspaceFile } from './files.ts'

const dirs: string[] = []

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentops-files-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('putWorkspaceFile', () => {
  it('overwrites an existing file and recreates a discarded one', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'kept.ts'), 'old\n')
    putWorkspaceFile(root, 'kept.ts', 'new\n')
    assert.equal(readFileSync(join(root, 'kept.ts'), 'utf8'), 'new\n')

    putWorkspaceFile(root, 'added.ts', 'created\n')
    assert.equal(readFileSync(join(root, 'added.ts'), 'utf8'), 'created\n')
  })

  it('creates missing parent directories inside the workspace', () => {
    const root = makeRoot()
    putWorkspaceFile(root, 'src/lib/new.ts', 'ok\n')
    assert.equal(readFileSync(join(root, 'src/lib/new.ts'), 'utf8'), 'ok\n')
  })

  it('refuses a path that escapes the workspace', () => {
    const root = makeRoot()
    mkdirSync(join(root, 'inside'))
    assert.throws(() => putWorkspaceFile(root, '../outside.ts', 'nope\n'), /escapes/)
  })
})

describe('writeWorkspaceFile', () => {
  it('does not create a missing file', () => {
    const root = makeRoot()
    assert.throws(() => writeWorkspaceFile(root, 'missing.ts', 'x\n'), /not found/)
  })
})

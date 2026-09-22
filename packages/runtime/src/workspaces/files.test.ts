import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  putWorkspaceFile,
  resolveInsideWorkspace,
  workspaceRelPath,
  writeWorkspaceFile,
} from './files.ts'

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

describe('resolveInsideWorkspace', () => {
  it('accepts a nested path inside the workspace', () => {
    const root = makeRoot()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'a.ts'), 'ok\n')
    assert.equal(workspaceRelPath(root, 'src/a.ts'), 'src/a.ts')
    assert.equal(resolveInsideWorkspace(root, 'src/a.ts'), join(realpathSync(root), 'src', 'a.ts'))
  })

  it('refuses ../ traversal', () => {
    const root = makeRoot()
    mkdirSync(join(root, 'inside'))
    assert.throws(() => resolveInsideWorkspace(root, '../outside.ts'), /escapes/)
  })

  it('refuses an absolute path outside the workspace', () => {
    const root = makeRoot()
    assert.throws(() => resolveInsideWorkspace(root, '/etc/passwd'), /escapes/)
  })

  it('refuses a NUL in the path', () => {
    const root = makeRoot()
    assert.throws(() => resolveInsideWorkspace(root, 'foo\0bar.ts'), /Invalid path/)
  })

  it('refuses a symlink that points outside the workspace', () => {
    const root = makeRoot()
    const outside = makeRoot()
    writeFileSync(join(outside, 'secret.txt'), 'nope\n')
    symlinkSync(outside, join(root, 'link'))
    assert.throws(() => resolveInsideWorkspace(root, 'link/secret.txt'), /escapes/)
  })
})

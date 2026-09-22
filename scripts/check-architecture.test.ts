import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boundaryRefusal, sourceImports } from './check-architecture.ts'

const value = (specifier: string) => ({ specifier, typeOnly: false, dynamic: false })

test('recognizes static imports, re-exports, lazy imports and erased types', () => {
  const imports = sourceImports(`
    import { run } from '@openrun/runtime/core'
    import type { TaskRow } from '@openrun/domain/entities'
    import { type RunRow } from '@openrun/domain/entities'
    export { helper } from './helper.ts'
    const load = () => import('@openrun/runtime/core')
    type Runtime = typeof import('@openrun/runtime/core')
  `)
  assert.deepEqual(
    imports.map(({ typeOnly, dynamic }) => [typeOnly, dynamic]),
    [
      [false, false],
      [true, false],
      [true, false],
      [false, false],
      [false, true],
      [true, false],
    ],
  )
})

test('blocks client and platform dependencies in portable packages', () => {
  assert.ok(boundaryRefusal('packages/domain/src/task.ts', value('node:fs')))
  assert.ok(boundaryRefusal('packages/domain/src/task.ts', value('@openrun/runtime/core')))
  assert.ok(
    boundaryRefusal('packages/runtime/src/executor.ts', value('../../../apps/web/src/state.ts')),
  )
  assert.equal(
    boundaryRefusal('packages/runtime/src/executor.ts', value('@openrun/domain/entities')),
    undefined,
  )
})

test('web runtime imports are limited to server boundaries and erased types', () => {
  const runtime = value('@openrun/runtime/core')
  assert.ok(boundaryRefusal('apps/web/src/features/chat/Chat.tsx', runtime))
  assert.ok(boundaryRefusal('apps/web/src/fns/index.ts', runtime))
  assert.equal(
    boundaryRefusal('apps/web/src/fns/index.ts', { ...runtime, dynamic: true }),
    undefined,
  )
  assert.equal(
    boundaryRefusal('apps/web/src/features/chat/Chat.tsx', { ...runtime, typeOnly: true }),
    undefined,
  )
  assert.equal(boundaryRefusal('apps/web/src/routes/api/v1/$.ts', runtime), undefined)
})

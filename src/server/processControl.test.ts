import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { agentSpawnOptions, isPidAlive, isShuttingDown, setShuttingDown } from './processControl.ts'

describe('processControl', () => {
  it('reports the current process as alive and nonsense pids as dead', () => {
    assert.equal(isPidAlive(process.pid), true)
    assert.equal(isPidAlive(null), false)
    assert.equal(isPidAlive(0), false)
    assert.equal(isPidAlive(-1), false)
    // High unused pid — almost certainly gone.
    assert.equal(isPidAlive(2_147_483_647), false)
  })

  it('agent spawn options detach on Unix so cancel can kill the tree', () => {
    const opts = agentSpawnOptions('/tmp')
    assert.equal(opts.cwd, '/tmp')
    assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'pipe'])
    assert.equal(opts.detached, process.platform !== 'win32')
  })

  it('merges extra env onto the process environment', () => {
    const opts = agentSpawnOptions('/tmp', { FX_MODEL: 'zai/glm-5.2-fast' })
    assert.equal(opts.env.FX_MODEL, 'zai/glm-5.2-fast')
    assert.equal(opts.env.PATH, process.env.PATH)
  })

  it('tracks the process-wide shutting-down flag', () => {
    const before = isShuttingDown()
    setShuttingDown(true)
    assert.equal(isShuttingDown(), true)
    setShuttingDown(before)
    assert.equal(isShuttingDown(), before)
  })
})

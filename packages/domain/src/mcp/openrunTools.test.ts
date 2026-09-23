import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  NO_APP_DIR_MESSAGE,
  NO_RUN_MESSAGE,
  OPENRUN_APP_DIR_ENV,
  OPENRUN_MCP_SERVER_NAME,
  OPENRUN_RUN_ID_ENV,
  OPENRUN_TOOLS,
  openrunToolDef,
} from './openrunTools.ts'

describe('OPENRUN_TOOLS', () => {
  it('offers exactly the three read-only tools the MCP page advertises', () => {
    assert.deepEqual(
      OPENRUN_TOOLS.map((t) => t.name),
      ['run_context', 'changed_files', 'recent_runs'],
    )
  })

  it('gives every tool a schema an MCP client can validate against', () => {
    for (const tool of OPENRUN_TOOLS) {
      assert.equal(tool.inputSchema.type, 'object', tool.name)
      assert.equal(typeof tool.inputSchema.properties, 'object', tool.name)
      assert.ok(tool.title.trim(), tool.name)
      assert.ok(tool.description.trim().length > 20, tool.name)
    }
  })

  it('takes no required arguments, so a call with an empty object always works', () => {
    for (const tool of OPENRUN_TOOLS) {
      assert.equal(tool.inputSchema.required, undefined, tool.name)
    }
  })

  it('bounds the recent_runs limit so a call cannot ask for the whole history', () => {
    const limit = openrunToolDef('recent_runs')?.inputSchema.properties.limit as
      | Record<string, unknown>
      | undefined
    assert.equal(limit?.type, 'integer')
    assert.equal(limit?.minimum, 1)
    assert.equal(limit?.maximum, 20)
  })
})

describe('openrunToolDef', () => {
  it('finds a tool by the bare name the agent calls', () => {
    assert.equal(openrunToolDef('run_context')?.title, 'Run context')
  })

  it('does not resolve the prefixed name the agent sees', () => {
    assert.equal(openrunToolDef('mcp__openrun__run_context'), undefined)
    assert.equal(openrunToolDef('delete_run'), undefined)
  })
})

describe('environment contract', () => {
  it('keeps the server name and env var names the spawned process reads', () => {
    assert.equal(OPENRUN_MCP_SERVER_NAME, 'openrun')
    assert.equal(OPENRUN_RUN_ID_ENV, 'OPENRUN_RUN_ID')
    assert.equal(OPENRUN_APP_DIR_ENV, 'OPENRUN_APP_DIR')
  })

  it('explains both ways the server can be started outside a run', () => {
    assert.match(NO_RUN_MESSAGE, /no run id/)
    assert.match(NO_APP_DIR_MESSAGE, new RegExp(OPENRUN_APP_DIR_ENV))
  })
})

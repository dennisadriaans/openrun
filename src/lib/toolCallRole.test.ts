import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyToolCall,
  parseMcpToolName,
  resolveCallRole,
  skillNameFromInput,
  subagentMetaFromInput,
  toolCallRoleFields,
  toolCallRoleTitle,
} from './toolCallRole.ts'

describe('parseMcpToolName', () => {
  it('splits mcp__server__tool', () => {
    assert.deepEqual(parseMcpToolName('mcp__github__create_issue'), {
      server: 'github',
      tool: 'create_issue',
    })
  })

  it('handles the plugin double-namespace form', () => {
    assert.deepEqual(parseMcpToolName('mcp__plugin_asana_asana__create_task'), {
      server: 'plugin_asana_asana',
      tool: 'create_task',
    })
  })

  it('returns null for ordinary tools', () => {
    assert.equal(parseMcpToolName('Bash'), null)
    assert.equal(parseMcpToolName('Skill'), null)
    assert.equal(parseMcpToolName(undefined), null)
  })
})

describe('classifyToolCall', () => {
  it('classifies Claude MCP names', () => {
    assert.equal(classifyToolCall('mcp__cursor-cloud__run-info'), 'mcp')
  })

  it('classifies Codex mcp_tool_call via hint', () => {
    assert.equal(
      classifyToolCall('search_docs', { query: 'x' }, { itemType: 'mcp_tool_call' }),
      'mcp',
    )
  })

  it('classifies Skill and Task / Agent', () => {
    assert.equal(classifyToolCall('Skill', { skill: 'figma-use' }), 'skill')
    assert.equal(
      classifyToolCall('Task', {
        description: 'Explore gates',
        subagent_type: 'explore',
      }),
      'subagent',
    )
    assert.equal(classifyToolCall('Agent', { description: 'Research' }), 'subagent')
  })

  it('defaults ordinary tools to tool', () => {
    assert.equal(classifyToolCall('Bash', { command: 'ls' }), 'tool')
    assert.equal(classifyToolCall('Read', { file_path: 'a.ts' }), 'tool')
    assert.equal(classifyToolCall(undefined), 'tool')
  })

  it('prefers a persisted callRole over name heuristics', () => {
    assert.equal(resolveCallRole({ callRole: 'mcp', name: 'Bash' }), 'mcp')
    assert.equal(resolveCallRole({ name: 'mcp__github__list' }), 'mcp')
  })
})

describe('role titles and input helpers', () => {
  it('reads skill and subagent meta from input', () => {
    assert.equal(skillNameFromInput({ skill: 'figma-use' }), 'figma-use')
    assert.deepEqual(
      subagentMetaFromInput({
        description: 'Find the gate',
        subagent_type: 'explore',
      }),
      { description: 'Find the gate', subagentType: 'explore' },
    )
  })

  it('builds role-aware titles', () => {
    assert.equal(toolCallRoleTitle('mcp', 'mcp__github__list_prs', {}), 'github · list_prs')
    assert.equal(toolCallRoleTitle('skill', 'Skill', { skill: 'figma-use' }), 'figma-use')
    assert.equal(
      toolCallRoleTitle('subagent', 'Task', {
        description: 'Scan adapters',
        subagent_type: 'explore',
      }),
      'explore · Scan adapters',
    )
  })

  it('returns payload fields adapters can spread', () => {
    const fields = toolCallRoleFields('mcp__linear__create_issue', {
      title: 'Ship it',
    })
    assert.equal(fields.callRole, 'mcp')
    assert.equal(fields.mcpServer, 'linear')
    assert.equal(fields.titleDetail, 'create_issue')
  })
})

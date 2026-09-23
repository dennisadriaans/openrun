/** slash operations. Wire identifiers and client scopes are stable. */
import type { Operation } from '../types.ts'

export const slashOperations = [
  {
    id: 'slash.listCommands',
    fn: 'listSlashCommands',
    method: 'GET',
    path: '/api/v1/slash/list-commands',
    core: 'listSlashCommandsFor',
    args: 'payload',
    input: { runtimeId: 'string', workspaceId: 'string?', includeApp: 'boolean?' },
    capability: 'slash.listCommands',
    clients: ['web', 'desktop'],
    inputType: '{ runtimeId: string; workspaceId?: string; includeApp?: boolean }',
  },
] as const satisfies readonly Operation[]

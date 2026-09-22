/** plugins operations. Wire identifiers and client scopes are stable. */
import type { Operation } from '../types.ts'

export const pluginsOperations = [
  {
    id: 'plugins.list',
    fn: 'listPlugins',
    method: 'GET',
    path: '/api/v1/plugins/list',
    core: 'listPluginsFor',
    args: 'payload',
    input: { runtimeId: 'string', workspaceId: 'string?' },
    capability: 'plugins.list',
    clients: ['web', 'desktop'],
    inputType: '{ runtimeId: string; workspaceId?: string }',
  },
  {
    id: 'plugins.listInstalled',
    fn: 'listInstalledPlugins',
    method: 'GET',
    path: '/api/v1/plugins/list-installed',
    core: 'listInstalledPlugins',
    args: 'payload',
    input: { workspaceId: 'string?' },
    inputOptional: true,
    capability: 'plugins.listInstalled',
    clients: ['web', 'desktop'],
    inputType: '{ workspaceId?: string }',
  },
] as const satisfies readonly Operation[]

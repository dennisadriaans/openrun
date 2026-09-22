/** dashboard operations. Wire identifiers and client scopes are stable. */
import type { Operation } from '../types.ts'

export const dashboardOperations = [
  {
    id: 'dashboard.dashboard',
    fn: 'dashboard',
    method: 'GET',
    path: '/api/v1/dashboard/dashboard',
    core: 'getDashboard',
    args: 'none',
    input: null,
    capability: 'dashboard',
    clients: ['web', 'desktop', 'mobile'],
  },
] as const satisfies readonly Operation[]

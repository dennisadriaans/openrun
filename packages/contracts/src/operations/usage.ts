/** usage operations. Wire identifiers and client scopes are stable. */
import type { Operation } from '../types.ts'

export const usageOperations = [
  {
    id: 'usage.report',
    fn: 'usageReport',
    method: 'GET',
    path: '/api/v1/usage/report',
    core: 'getUsageReport',
    args: 'payload',
    input: { range: 'string?' },
    inputOptional: true,
    capability: 'usage.report',
    clients: ['web', 'desktop'],
    inputType: '{ range?: string }',
  },
  {
    id: 'usage.pressure',
    fn: 'usagePressure',
    method: 'GET',
    path: '/api/v1/usage/pressure',
    core: 'getUsagePressure',
    args: 'none',
    input: null,
    capability: 'usage.pressure',
    clients: ['web', 'desktop'],
  },
] as const satisfies readonly Operation[]

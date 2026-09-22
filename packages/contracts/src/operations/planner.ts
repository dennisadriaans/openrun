/** planner operations. Wire identifiers and client scopes are stable. */
import type { Operation } from '../types.ts'

export const plannerOperations = [
  {
    id: 'planner.planObjective',
    fn: 'planObjective',
    method: 'POST',
    path: '/api/v1/planner/plan-objective',
    core: 'planObjective',
    args: 'payload',
    input: { objective: 'string', runtimeId: 'string', workspaceId: 'string' },
    capability: 'planner.planObjective',
    clients: ['web', 'desktop'],
    inputType: '{ objective: string; runtimeId: string; workspaceId: string }',
  },
  {
    id: 'planner.installPlanProposal',
    fn: 'installPlanProposal',
    method: 'POST',
    path: '/api/v1/planner/install-plan-proposal',
    core: 'installPlanProposal',
    args: 'payload',
    input: { runtimeId: 'string', workspaceId: 'string', proposal: 'object', enabled: 'boolean?' },
    capability: 'planner.installPlanProposal',
    clients: ['web', 'desktop'],
    inputType:
      '{ runtimeId: string; workspaceId: string; proposal: PlanProposal; enabled?: boolean }',
  },
] as const satisfies readonly Operation[]

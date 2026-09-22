/** Public operation registry. Add a capability in operations/, then regenerate transports. */
import { cloudOperations } from './operations/cloud.ts'
import { dashboardOperations } from './operations/dashboard.ts'
import { devicesOperations } from './operations/devices.ts'
import { filesOperations } from './operations/files.ts'
import { gitOperations } from './operations/git.ts'
import { integrationsOperations } from './operations/integrations.ts'
import { mcpOperations } from './operations/mcp.ts'
import { notificationsOperations } from './operations/notifications.ts'
import { plannerOperations } from './operations/planner.ts'
import { pluginsOperations } from './operations/plugins.ts'
import { projectsOperations } from './operations/projects.ts'
import { runsOperations } from './operations/runs.ts'
import { runtimesOperations } from './operations/runtimes.ts'
import { slashOperations } from './operations/slash.ts'
import { tasksOperations } from './operations/tasks.ts'
import { usageOperations } from './operations/usage.ts'
import { workspacesOperations } from './operations/workspaces.ts'

export const OPERATIONS = [
  ...cloudOperations,
  ...dashboardOperations,
  ...devicesOperations,
  ...filesOperations,
  ...gitOperations,
  ...integrationsOperations,
  ...mcpOperations,
  ...notificationsOperations,
  ...plannerOperations,
  ...pluginsOperations,
  ...projectsOperations,
  ...runsOperations,
  ...runtimesOperations,
  ...slashOperations,
  ...tasksOperations,
  ...usageOperations,
  ...workspacesOperations,
] as const

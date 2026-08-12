/**
 * First-run project gate shared by Automations list / New automation (browser).
 * Automations require a workspace; without any project there is nowhere to pin
 * one, so Create and Planner fail after the developer has already filled a form.
 */

/** Whether at least one project exists to attach automations to. */
export function hasProjects(projectCount: number): boolean {
  return Number.isFinite(projectCount) && projectCount > 0
}

/** One-line copy when Create is blocked because Projects is empty. */
export function needProjectBeforeAutomationMessage(): string {
  return 'Add a project (repository) before creating an automation.'
}

/** Hover detail for the info icon beside the one-line gate message. */
export function needProjectBeforeAutomationDetail(): string {
  return 'Automations need a workspace to run in — without one, Create / Planner / Run have nowhere safe to spawn the agent.'
}

/** Empty-state choice for the Automations list. */
export type AutomationsEmptyKind = 'need-project' | 'ready-to-create'

export function automationsEmptyKind(projectCount: number): AutomationsEmptyKind {
  return hasProjects(projectCount) ? 'ready-to-create' : 'need-project'
}

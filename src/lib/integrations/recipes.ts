/**
 * Named starting points for an automation.
 *
 * Picking a trigger and writing a prompt from scratch is the last thing
 * standing between a fresh connection and something useful. A recipe fills
 * both, plus the name, so the common cases are one click and the form is still
 * fully editable afterwards — these are templates, not black boxes.
 *
 * The default is deliberately opt-in per ticket ("label it and the agent picks
 * it up") rather than "every new ticket starts an agent". A connection made in
 * thirty seconds should not be able to spawn a run for every issue a busy
 * project files.
 *
 * A recipe is offered only when the provider can actually honour it: the
 * trigger has to exist, and a prompt reading `{{extra.comment}}` needs a
 * provider whose parse fills it. Otherwise the recipe would hand the agent a
 * blank line where the instruction was supposed to be.
 */
import { providerMeta } from './catalog.ts'
import { providerNoun, triggerOption, type IntegrationTrigger } from './triggers.ts'
import type { IntegrationProviderId } from './types.ts'

export type RecipeId = 'implement-flagged' | 'start-in-progress' | 'triage-new' | 'answer-comment'

export type AutomationRecipe = {
  id: RecipeId
  title: string
  /** One line, shown under the title on the picker. */
  summary: string
  trigger: IntegrationTrigger
  prompt: string
  /** Name for the automation row, so several on one connection stay legible. */
  automationName: string
}

/**
 * The label the default recipe watches for. A convention, not configuration:
 * add it to a ticket and the agent picks the ticket up, exactly the way a bot
 * label works everywhere else.
 */
export const AGENT_LABEL = 'agent'

/**
 * Statuses that mean "someone started this". Only the providers whose status
 * vocabulary is genuinely open get this recipe — GitHub, GitLab and Bitbucket
 * only have open/closed, where "started work" is not a state at all.
 *
 * Azure DevOps states depend on the process template (Active / Doing /
 * Committed), so it gets the trigger with no default value and the form's own
 * placeholder asks for the right one.
 */
const IN_PROGRESS_STATUS: Partial<Record<IntegrationProviderId, string>> = {
  jira: 'In Progress',
  linear: 'In Progress',
  'azure-devops': '',
}

function implementFlagged(provider: IntegrationProviderId): AutomationRecipe {
  const noun = providerNoun(provider)
  return {
    id: 'implement-flagged',
    title: `Implement flagged ${noun}s`,
    summary: `Add the “${AGENT_LABEL}” label to a ${noun} and the agent implements it.`,
    trigger: { kind: 'labeled', value: AGENT_LABEL },
    automationName: `Implement flagged ${noun}s`,
    prompt: [
      `This ${noun} has been flagged for you to implement.`,
      '',
      '{{issue.key}}: {{issue.title}}',
      '{{issue.url}}',
      '',
      '{{issue.body}}',
      '',
      `Implement it in this workspace. Keep the change to what the ${noun} actually`,
      'asks for — no drive-by refactors, no unrelated cleanups. Run the project’s',
      'tests before you finish and leave the working tree ready to review.',
      '',
      `If the ${noun} is ambiguous enough that guessing could send you down the`,
      'wrong path, stop and say what you need instead of picking an',
      'interpretation.',
    ].join('\n'),
  }
}

function startInProgress(provider: IntegrationProviderId): AutomationRecipe {
  const noun = providerNoun(provider)
  return {
    id: 'start-in-progress',
    title: 'Start work when it moves to In Progress',
    summary: `Picks the ${noun} up the moment someone moves it into the working column.`,
    trigger: { kind: 'status', value: IN_PROGRESS_STATUS[provider] ?? '' },
    automationName: 'Start work in progress',
    prompt: [
      '{{issue.key}} just moved to {{issue.status}}.',
      '',
      '{{issue.title}}',
      '{{issue.url}}',
      '',
      '{{issue.body}}',
      '',
      'Start the work. Read the surrounding code before changing it, make the',
      `smallest change that satisfies the ${noun}, and run the project’s tests.`,
      '',
      'Leave the tree ready to review. If there is not enough here to start, say',
      'what is missing rather than guessing.',
    ].join('\n'),
  }
}

function triageNew(provider: IntegrationProviderId): AutomationRecipe {
  const noun = providerNoun(provider)
  return {
    id: 'triage-new',
    title: `Triage new ${noun}s`,
    summary: 'Investigates and reports back. Changes code only when the fix is obvious.',
    trigger: { kind: 'created', value: '' },
    automationName: `Triage new ${noun}s`,
    prompt: [
      `A new ${noun} just arrived.`,
      '',
      '{{issue.key}}: {{issue.title}}',
      '{{issue.url}}',
      '',
      '{{issue.body}}',
      '',
      'Work out what it actually is before changing anything:',
      '- If it is a bug, find the code responsible and try to reproduce it.',
      '- If it is a feature request, name the files that would have to change.',
      '- If it is unclear, a duplicate, or not actionable, say so and stop.',
      '',
      'Report what you found. Make a code change only when the fix is small and',
      'obvious; otherwise leave the tree clean.',
    ].join('\n'),
  }
}

function answerComment(provider: IntegrationProviderId): AutomationRecipe {
  const noun = providerNoun(provider)
  return {
    id: 'answer-comment',
    title: 'Do what a comment asks',
    summary: `Runs when someone comments on a ${noun}, and acts on what they wrote.`,
    trigger: { kind: 'commented', value: '' },
    automationName: 'Act on comments',
    prompt: [
      'Someone commented on {{issue.key}}.',
      '',
      '{{issue.title}}',
      '{{issue.url}}',
      '',
      'The comment, from {{actor.name}}:',
      '{{extra.comment}}',
      '',
      `The ${noun} itself, for context:`,
      '{{issue.body}}',
      '',
      'Do what the comment asks, in this workspace. If it is a question rather',
      'than a request, answer it and leave the code alone. If it asks for',
      'something you cannot do from here, say so plainly.',
    ].join('\n'),
  }
}

type RecipeBuilder = {
  build: (provider: IntegrationProviderId) => AutomationRecipe
  /** Why a provider may not be offered this one. */
  supports: (provider: IntegrationProviderId) => boolean
}

const BUILDERS: RecipeBuilder[] = [
  {
    build: implementFlagged,
    // Needs a label trigger. Bitbucket never sends labels, so it has none.
    supports: (provider) => triggerOption(provider, 'labeled') !== null,
  },
  {
    build: startInProgress,
    supports: (provider) => IN_PROGRESS_STATUS[provider] !== undefined,
  },
  {
    build: triageNew,
    supports: (provider) => triggerOption(provider, 'created') !== null,
  },
  {
    build: answerComment,
    // Both halves: a comment event to bind, and comment text to interpolate.
    supports: (provider) =>
      triggerOption(provider, 'commented') !== null &&
      providerMeta(provider)?.emitsCommentText === true,
  },
]

export function availableRecipes(provider: IntegrationProviderId): AutomationRecipe[] {
  return BUILDERS.filter((builder) => builder.supports(provider)).map((builder) =>
    builder.build(provider),
  )
}

export function recipeById(provider: IntegrationProviderId, id: RecipeId): AutomationRecipe | null {
  return availableRecipes(provider).find((recipe) => recipe.id === id) ?? null
}

/**
 * What the form opens on. The flagged-label recipe where it exists, because it
 * is the one that cannot surprise anyone with a wave of runs; otherwise the
 * first thing this provider can do.
 */
export function defaultRecipe(provider: IntegrationProviderId): AutomationRecipe | null {
  const recipes = availableRecipes(provider)
  return recipes.find((recipe) => recipe.id === 'implement-flagged') ?? recipes[0] ?? null
}

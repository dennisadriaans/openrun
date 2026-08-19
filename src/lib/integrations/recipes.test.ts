import assert from 'node:assert/strict'
import { describe, it, test } from 'node:test'
import { INTEGRATION_PROVIDER_IDS, providerMeta } from './catalog.ts'
import { promptHasPlaceholders, renderWebhookPrompt } from './prompt.ts'
import { availableRecipes, defaultRecipe, recipeById, AGENT_LABEL } from './recipes.ts'
import { compileTrigger } from './triggers.ts'
import { emptyActor, emptyIssue, type CanonicalWebhookEvent } from './types.ts'

/**
 * A recipe is a promise about what will happen. These check the two ways it can
 * be a lie: a trigger that compiles to a binding nothing matches, and a prompt
 * that interpolates a field the provider never fills.
 */

describe('availableRecipes', () => {
  it('only offers recipes whose trigger actually compiles', () => {
    for (const provider of INTEGRATION_PROVIDER_IDS) {
      for (const recipe of availableRecipes(provider)) {
        const { events } = compileTrigger(provider, recipe.trigger)
        assert.ok(events.length > 0, `${provider}/${recipe.id} compiles to no events`)
      }
    }
  })

  it('binds only ids the provider catalog lists', () => {
    for (const provider of INTEGRATION_PROVIDER_IDS) {
      const bindable = new Set(providerMeta(provider)!.events.map((event) => event.id))
      for (const recipe of availableRecipes(provider)) {
        for (const id of compileTrigger(provider, recipe.trigger).events) {
          assert.ok(bindable.has(id), `${provider}/${recipe.id} binds unbindable ${id}`)
        }
      }
    }
  })

  it('gives every provider something to start from', () => {
    for (const provider of INTEGRATION_PROVIDER_IDS) {
      assert.ok(availableRecipes(provider).length > 0, `${provider} has no recipes`)
      assert.ok(defaultRecipe(provider), `${provider} has no default recipe`)
    }
  })

  it('never offers a comment recipe where comment text is not sent', () => {
    for (const provider of INTEGRATION_PROVIDER_IDS) {
      const hasCommentRecipe = availableRecipes(provider).some((r) => r.id === 'answer-comment')
      if (!hasCommentRecipe) continue
      assert.equal(
        providerMeta(provider)!.emitsCommentText,
        true,
        `${provider} offers a comment recipe but never fills extra.comment`,
      )
    }
    // Linear parses a Comment delivery as an issue and fills neither the issue
    // fields nor extra.comment, so the recipe must stay off it.
    assert.equal(
      availableRecipes('linear').some((r) => r.id === 'answer-comment'),
      false,
    )
    assert.equal(
      availableRecipes('azure-devops').some((r) => r.id === 'answer-comment'),
      false,
    )
  })

  it('skips the label recipe where the provider sends no labels', () => {
    assert.equal(
      availableRecipes('bitbucket').some((r) => r.id === 'implement-flagged'),
      false,
    )
  })

  it('offers "start work" only where a working status exists', () => {
    for (const provider of ['jira', 'linear', 'azure-devops'] as const) {
      assert.ok(recipeById(provider, 'start-in-progress'), `${provider} should offer it`)
    }
    // open/closed is not a workflow — there is no "started" state to move to.
    for (const provider of ['github', 'gitlab', 'bitbucket'] as const) {
      assert.equal(recipeById(provider, 'start-in-progress'), null, `${provider} should not`)
    }
  })
})

describe('defaultRecipe', () => {
  it('opts in per ticket rather than firing on everything new', () => {
    for (const provider of ['github', 'gitlab', 'jira', 'linear', 'azure-devops'] as const) {
      const recipe = defaultRecipe(provider)!
      assert.equal(recipe.id, 'implement-flagged', `${provider} defaults to ${recipe.id}`)
      assert.equal(recipe.trigger.value, AGENT_LABEL)
    }
  })

  it('falls back to something real where the label recipe cannot exist', () => {
    const recipe = defaultRecipe('bitbucket')!
    assert.notEqual(recipe.id, 'implement-flagged')
    assert.ok(compileTrigger('bitbucket', recipe.trigger).events.length > 0)
  })
})

describe('recipe prompts', () => {
  it('use placeholders, so the raw context block is not appended on top', () => {
    for (const provider of INTEGRATION_PROVIDER_IDS) {
      for (const recipe of availableRecipes(provider)) {
        assert.equal(
          promptHasPlaceholders(recipe.prompt),
          true,
          `${provider}/${recipe.id} has no placeholders`,
        )
      }
    }
  })

  it('render with no placeholder left behind', () => {
    const event: CanonicalWebhookEvent = {
      provider: 'jira',
      eventType: 'jira:issue_updated',
      deliveryId: 'd1',
      occurredAt: 1,
      issue: emptyIssue({
        key: 'OR-1',
        title: 'Login times out',
        body: 'Steps to reproduce…',
        url: 'https://acme.atlassian.net/browse/OR-1',
        status: 'In Progress',
      }),
      actor: emptyActor({ name: 'Ada' }),
      extra: { comment: 'please add a regression test' },
    }

    for (const recipe of availableRecipes('jira')) {
      const rendered = renderWebhookPrompt(recipe.prompt, event)
      assert.equal(/\{\{/.test(rendered), false, `${recipe.id} left a placeholder unrendered`)
      assert.ok(rendered.includes('OR-1'), `${recipe.id} dropped the issue key`)
    }
  })

  it('puts the comment in the prompt that is about the comment', () => {
    const event: CanonicalWebhookEvent = {
      provider: 'jira',
      eventType: 'comment_created',
      deliveryId: 'd2',
      occurredAt: 1,
      issue: emptyIssue({ key: 'OR-2', title: 'Slow query' }),
      actor: emptyActor({ name: 'Grace' }),
      extra: { comment: 'add an index on user_id' },
    }
    const rendered = renderWebhookPrompt(recipeById('jira', 'answer-comment')!.prompt, event)
    assert.ok(rendered.includes('add an index on user_id'))
    assert.ok(rendered.includes('Grace'))
  })
})

test('recipe copy names the thing the provider calls it', () => {
  assert.match(recipeById('azure-devops', 'triage-new')!.title, /work item/)
  assert.match(recipeById('jira', 'triage-new')!.title, /issue/)
})

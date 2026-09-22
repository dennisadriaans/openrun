import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { githubPullRequestUrl, githubRepositoryUrl } from './githubPrLink.ts'

describe('GitHub pull request links', () => {
  it('normalizes HTTPS and SSH GitHub remotes', () => {
    assert.equal(
      githubRepositoryUrl('git@github.com:openai/codex.git'),
      'https://github.com/openai/codex',
    )
    assert.equal(
      githubRepositoryUrl('https://github.com/openai/codex.git'),
      'https://github.com/openai/codex',
    )
  })

  it('builds repository-scoped PR links and rejects unsupported remotes', () => {
    assert.equal(
      githubPullRequestUrl('https://github.com/openai/codex', 41),
      'https://github.com/openai/codex/pull/41',
    )
    assert.equal(githubPullRequestUrl('https://gitlab.com/openai/codex', 41), null)
  })
})

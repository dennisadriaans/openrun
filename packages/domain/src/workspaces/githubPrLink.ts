/** Turn a GitHub remote into the canonical web repository URL. */
export function githubRepositoryUrl(remote: string | undefined): string | null {
  const value = remote?.trim() ?? ''
  if (!value) return null
  const ssh = value.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i)
  const https = value.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i)
  const match = ssh ?? https
  if (!match?.[1] || !match[2]) return null
  return `https://github.com/${match[1]}/${match[2]}`
}

export function githubPullRequestUrl(remote: string | undefined, number: number): string | null {
  const repository = githubRepositoryUrl(remote)
  return repository && Number.isSafeInteger(number) && number > 0
    ? `${repository}/pull/${number}`
    : null
}

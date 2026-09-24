# Releasing

Two tracks, each with its own version and tag. They release the same way.

| | App | CLI (npm `@dennisadriaans/openrun`) |
| --- | --- | --- |
| Version | `package.json` | `apps/cli/package.json` |
| Tag | `vX.Y.Z` | `cli-vX.Y.Z` |
| Scripts | `pnpm release:plan\|prepare\|publish` | `pnpm release:cli:plan\|prepare\|publish` |
| Tag push runs | `Release · publish` → GitHub Release | `Release · CLI` → npm + GitHub Release |

Nothing releases on a schedule. A release happens when a maintainer pushes a tag.

## Release

Maintainers run `pnpm release` from the private root. It asks which track and
walks every step below.

By hand (`release:cli:*` for the CLI):

```bash
git switch main && git pull
pnpm release:plan                          # "No release"? stop. Note the tag.
git switch -c release/vX.Y.Z
pnpm release:prepare                       # --version=X.Y.Z to override
git commit -am "chore(release): vX.Y.Z"
gh pr create --fill --title "chore(release): vX.Y.Z"
gh pr merge --squash --auto
# once merged:
git switch main && git pull
git tag -a vX.Y.Z <merged sha> -m "Open Run vX.Y.Z" && git push origin vX.Y.Z
```

## Rules

- Tag the squashed `chore(release): …` commit. Publish refuses any other commit.
- Keep that exact PR title. `plan` uses it to spot a release that merged but
  was never tagged.
- `X.Y.Z-beta.N` is a prerelease: GitHub marks it so, npm publishes it under `next`.
- Never move or delete a pushed tag. A bad release gets a `fix` and a new patch.

## When it fails

- **Publish failed:** re-run it — **Actions → Release · publish / Release · CLI
  → Run workflow**, with the tag. It skips whatever already exists.
- **CI can't reach npm:** `npm login`, check out the tag, `pnpm release:cli:publish`.
- **`plan` says "Pending: … not tagged":** the release PR merged without a tag.
  Tag that commit and push the tag.

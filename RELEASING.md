# Releasing Open Run

Releases are cadence-driven and automatic. Nobody types a version number, and no
model chooses one: given a commit range and a base version, the next version is a
pure function.

The pipeline has two halves, and keeping them apart is the whole design.

```
  Feature work                          Release                       Publish
  ────────────                          ───────                       ───────
  issue / request                       schedule fires                release PR merged
    → branch                              → is the window open?         → verify the squashed SHA
    → conventional PR title               → anything releasable?        → tag it
    → CI + changelog gate                 → compute the version         → GitHub Release
    → squash merge to main                → open release/vX.Y.Z PR      → attach artifacts
                                          → CI, auto-merge              → verify it published
```

**Preparing a release and publishing one are separate operations.** Preparing
opens a pull request whose parent SHA freezes the release contents, so a merge
landing at 09:00:02 belongs to the *next* release rather than silently joining
this one. Publishing then runs in CI against that exact tested commit. A laptop
is never the release authority: a sleeping machine, a dirty worktree or an
expired `gh` login cannot leave you with a version bumped locally and a tag that
never got pushed.

## The commands

| Command | What it does |
| --- | --- |
| `pnpm ship "feat(scope): summary"` | Branch off `main`, commit, push, open the PR |
| `pnpm release:plan` | Read-only. What would the next release be? |
| `pnpm release:prepare --dry-run` | Rehearse. Prints the notes, writes nothing |
| `pnpm release:prepare` | Write the version, changelog and `release/vX.Y.Z` branch |
| `pnpm release:publish` | Tag `HEAD` and create the GitHub Release |

`release:plan` is the one to reach for:

```
Current:  v0.8.1
Range:    v0.8.1..HEAD
Commits:  17 — feat 3 · fix 4 · perf 1 · docs 2 · chore 7
Fragments: 8 in changelog.d/

Next:     v0.9.0  (minor release: v0.8.1 → v0.9.0.)
```

## How the version is decided

The PR title is the input. `main` takes squashed PRs only and the squash uses
the title verbatim, so one commit on `main` is one shippable idea — which is why
`.github/workflows/pr-title.yml` is a required check rather than a convention.

| Type | Bump |
| --- | --- |
| `feat` | minor |
| `fix`, `perf`, `revert` | patch |
| `refactor`, `docs`, `test`, `build`, `ci`, `chore` | none |
| any type with `!`, or a `BREAKING CHANGE:` footer | breaking |

The highest bump in the range wins. **A range with no releasable commit produces
no release** — a Monday whose merges were all docs and chores reports "nothing to
release" rather than inventing a `v0.8.2`.

Two rules hold a major back:

- **Below 1.0**, a breaking change is a minor bump. That is what the leading zero
  means in SemVer; reaching 1.0 is a product decision, not a side effect of a
  `feat!` merging.
- **At or past 1.0**, an automatic major still needs `--allow-major`. The release
  PR says the breaking changes are there and a human cuts the major.

The rules live in `scripts/release/` with colocated tests, so local commands and
CI always compute the same answer.

## Where the words come from

Conventional subjects decide the **version**. They are useless as user-facing
copy — `feat(tasks): select and bulk delete automations` is not "You no longer
delete automations one row at a time" — so they do not decide the **prose**.

- `changelog.d/*.md` fragments are the prose, in the negative-relief voice.
  CI requires one on any PR that moves the version; the **changelog-entry** skill
  drafts it from the diff.
- The generated commit index sits underneath, grouped by type and linked to PRs.

At release time the fragments are folded into `CHANGELOG.md`, the files are
deleted, and `## Unreleased` is emptied — its bullets are carried into the
release being cut rather than stranded above it.

## Cadence

```json
"release": {
  "cadence": "weekly",
  "day": "monday",
  "time": "09:00",
  "timezone": "Europe/Amsterdam"
}
```

The schedule decides **when to ask** whether a release exists, never which
version gets created. `cadence` is `weekly`, `daily` or `manual`.

The workflow retries hourly on Monday. The window opens at 09:00 Amsterdam time,
and the newest tag records whether that Monday's release already happened. A
delayed or dropped 09:00 run can therefore recover later that day, while later
runs cannot prepare a second release in the same window.

Changing the cadence is a one-line edit to `package.json`. Daylight saving is
handled by the timezone, not by hand-converting the hour to UTC twice a year.

## Cutting a release by hand

Any time, without waiting for Monday:

**Actions → Release · prepare → Run workflow.** Leave *ignore cadence* on. It
opens the same release PR the schedule would have; merging it publishes.

## Idempotency and recovery

Every step is safe to re-run.

- `prepare` resumes an existing release branch and pull request after a partial
  failure instead of treating their existence as completion.
- `publish` reconciles the tag and GitHub Release independently. It repairs a
  missing Release after a tag push, verifies the tag target, and can recover a
  missed publish after later commits have landed.
  It never ships a second, different artifact under a version that already went out.
- A failed publish is fixed by re-running the workflow, not by tagging by hand.

If a release lands broken, ship a `fix` and let the next release cut a patch.
Never move a published tag.

## Releasing the CLI

The `openrun` command ships to npm as `@dennisadriaans/openrun` on its **own**
track. It does not wait for an app release, and an app release does not publish
it.

| | App | CLI |
| --- | --- | --- |
| Version | root `package.json` | `apps/cli/package.json` |
| Tag | `vX.Y.Z` | `cli-vX.Y.Z` |
| Notes | `CHANGELOG.md` (from `changelog.d/`) | `apps/cli/CHANGELOG.md` |
| Release PR | `chore(release): vX.Y.Z` | `chore(release): cli-vX.Y.Z` |
| Published by | `Release · publish` | `Release · CLI` (on the tag) |

`apps/cli/package.json` holds a `release` field — the npm name, the tag prefix,
and the paths the package is built from. It is the one definition:
`pnpm cli:package` bundles those workspaces, and the planner counts only commits
that touch those paths, so a web-only `feat` never bumps the CLI. A test fails
if the CLI starts bundling a workspace the list does not name.

The version rules are the app's rules, applied to that filtered range: `feat`
is minor, `fix`/`perf`/`revert` are patch, below 1.0 a breaking change is a
minor, and a range with nothing releasable is no release. App and CLI release
commits never count. Until the first `cli-v*` tag exists, the range starts at
the app tag the last CLI was published from (`v0.3.0`).

| Command | What it does |
| --- | --- |
| `pnpm release:cli:plan` | Read-only. The CLI range, its commits and the next version (`--json` for tools) |
| `pnpm release:cli:prepare` | Write the version and a `apps/cli/CHANGELOG.md` section. No git; `--version=`, `--notes-file=`, `--dry-run` |
| `pnpm release:cli:publish` | On the tagged commit only: package, smoke-test, `npm publish`, then the GitHub Release |

The guided path is the private release tool (`pnpm release`, target *CLI*). By
hand, it is the same four steps:

1. `pnpm release:cli:prepare` on a `release/cli-vX.Y.Z` branch; commit as
   `chore(release): cli-vX.Y.Z` and open the PR.
2. Squash-merge it once CI is green.
3. Tag the merged commit on `main`: `git tag -a cli-vX.Y.Z <sha> -m "Open Run CLI cli-vX.Y.Z"`
   and push the tag.
4. The tag starts **Release · CLI**, which verifies the commit, publishes to npm
   with provenance, and creates a GitHub Release with the tarball attached. That
   release is never marked *latest*, so the app's release stays the headline.

Prereleases (`0.5.0-beta.1`) publish under the `next` dist-tag, so
`npm install -g @dennisadriaans/openrun` keeps getting the stable version.

`publish` refuses to run anywhere except on the commit its tag names, and it
skips npm or the GitHub Release when either already exists. A failed publish is
fixed by re-running the workflow (**Actions → Release · CLI → Run workflow**,
with the tag). The same command works from a laptop logged in to npm, as a last
resort: check out the tag, then `pnpm release:cli:publish`.

### One-time npm setup

Prefer npm trusted publishing, which needs no stored token: on npmjs.com, add a
trusted publisher for `@dennisadriaans/openrun` with repository
`dennisadriaans/openrun`, workflow `release-cli.yml`, and environment `npm`.
Until that exists, an `NPM_TOKEN` repository secret (an automation token) works
too. The `npm` environment is created on the first run; add required reviewers
there to put a human in front of every publish.

The root package stays `private: true`; only the generated `dist/npm` is
published. `pnpm cli:package` then `pnpm cli:smoke` builds and verifies it
locally without publishing anything.

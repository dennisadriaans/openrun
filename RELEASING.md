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

The workflow's own cron is deliberately wider than the window, and the window
stays open for the rest of the release day — a cron delayed by twenty minutes
must not skip a week. Running twice in one day is harmless: the second run sees
the open `release/vX.Y.Z` branch and stops.

Changing the cadence is a one-line edit to `package.json`. Daylight saving is
handled by the timezone, not by hand-converting the hour to UTC twice a year.

## Cutting a release by hand

Any time, without waiting for Monday:

**Actions → Release · prepare → Run workflow.** Leave *ignore cadence* on. It
opens the same release PR the schedule would have; merging it publishes.

## Idempotency and recovery

Every step is safe to re-run.

- `prepare` refuses if the tag already exists, and stops if the release branch is
  already open.
- `publish` exits early if the tag exists, or if `HEAD` is not a release commit.
  It never ships a second, different artifact under a version that already went out.
- A failed publish is fixed by re-running the workflow, not by tagging by hand.

If a release lands broken, ship a `fix` and let the next release cut a patch.
Never move a published tag.

## What a release does not do yet

`Release · publish` creates a tag and GitHub Release, but attaches no build
artifact. There is no npm publish and no binary — the app is `private: true`
and is installed by cloning. Future distribution targets should be added after
the tag exists and must use that same SHA.

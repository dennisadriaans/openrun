---
name: changelog-entry
description: Write a changelog.d/ fragment for a change, in Open Run's negative-relief voice. Use when finishing a feat/fix/perf change, when CI fails the "changelog entry" check, or when asked to write or fix a changelog entry.
---

# Writing a changelog entry

Open Run's changelog is the one part of the release that is *not* generated.
Conventional commit subjects give the release its version and its index; this
fragment gives it its meaning. Write for somebody deciding whether to upgrade,
not for somebody reviewing the diff.

## The file

One markdown file per shipped change, in `changelog.d/`, named for the change
and not for the branch or the issue:

```
changelog.d/bulk-automation-delete.md
changelog.d/live-stream-watchdog.md
changelog.d/dns-rebinding-guard.md
```

No heading, no bullet marker, no front matter — just prose. The release step
turns each file into one bullet, so a second paragraph becomes an indented
continuation rather than a separate entry.

## The voice

Every entry opens with what the reader **no longer** has to do. State the old
pain first, then the relief after an em dash. This is the house style and it is
load-bearing: it forces the entry to be about the user's experience rather than
about the implementation.

> You no longer delete automations one row at a time: the Automations list has
> selection checkboxes and a **Delete selected** button, the same as Runs.
> Removing a batch stops their schedules and cancels any run already in flight.

> You no longer get an orphan failed run with `spawn ENOENT` when a runtime CLI
> is missing — **Run now**, follow-ups, and scheduled starts refuse immediately
> with a clear "not found on PATH" error.

> You no longer pay a 10s HTTP poll on a healthy run SSE stream — active-run and
> conversation queries stay quiet while the EventSource is up and only resume the
> old cadence if it drops.

A change with no "before" — a genuinely new surface — may open with what you can
now do instead. Use that sparingly; most changes have a pain to name.

## Rules

- **Name the surface.** Say which page, button or command: "the Automations
  list", "**Run now**", "`pnpm token:print`". Bold UI labels, backtick commands,
  paths and identifiers.
- **Say what happens now**, including the edge case the change fixed. "Removing
  a batch stops their schedules and cancels any run already in flight" is the
  half a reader actually needs.
- **No file names, module names or function names.** `lib/runPrereqGate.ts`
  means nothing to a user. Describe the behaviour it produces.
- **No issue or PR numbers.** The generated index already links those.
- **Never credit an agent.** No Claude, Codex, Cursor, Copilot, or any assistant
  — not in the entry, not in a footer. This is a hard rule from `AGENTS.md`.
- **One file per shippable idea.** A PR doing two unrelated things wants two
  files, or more likely wants to be two PRs.
- Two to four sentences. Longer than that and it is release notes prose, not an
  entry.

## How to write one

1. Read the actual diff — `git diff main...HEAD` — not just the PR title.
2. Ask what a user could not do before, or what went wrong for them.
3. Write the "You no longer …" clause, then the relief, then the edge case.
4. Save it as `changelog.d/<slug>.md` and check it reads on its own, with no
   knowledge of the branch.

## When you do not need one

`docs`, `chore`, `test`, `ci`, `build` and `refactor` changes do not move the
version and need no entry — CI only requires one for `feat`, `fix`, `perf`,
`revert` and anything marked breaking. If a change carries one of those types
but genuinely has no user-facing effect, add the `no changelog` label or put
`[skip changelog]` in the PR body rather than writing a hollow entry.

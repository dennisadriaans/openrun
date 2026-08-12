---
title: Verified runs — checks, verdicts, auto-repair and notifications
status: done
area: feature
---

You no longer have to read a transcript to find out whether an unattended run
actually worked. A project defines **checks** (`pnpm typecheck`, `pnpm test`, …)
that run in the worktree after every agent turn, and each run gets a **verdict**
— Verified, Checks failed, No changes, Unverified, Timed out or Crashed —
instead of only "the CLI exited 0", which it does just as happily after writing
code that does not compile or after doing nothing at all.

- Checks are auto-suggested from `package.json` scripts when a repo is added.
- A `failed-checks` run hands the failing output back to the same agent session
  as a repair turn, bounded per automation (hard cap 3).
- Every run has a wall-clock budget; a wedged CLI used to hold the workspace
  lock until the app restarted.
- **Notifications** (Slack / Discord / generic webhook / desktop) fire when a
  run settles — by default only when it needs attention.
- Unattended fires (cron, webhook) that land on a busy workspace are **queued**
  instead of being dropped into a console log with no run row.

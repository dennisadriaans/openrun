An unattended automation no longer runs in a workspace that cannot support it.
A workspace whose directory has been removed no longer reports `ready` and
crashes the run with `spawn <cli> ENOENT` — it is inspected before the fire,
marked broken, and the automation says so. Scheduled and webhook runs no longer
share the project's main checkout by default, so one automation's branch switch
and leftover edits can no longer become the next automation's starting point;
"Give it its own worktree" moves an automation onto a worktree and branch of its
own in one click. A worktree that has drifted onto another branch, still holds
an earlier run's changes, or was quarantined by a crashed run is refused instead
of inherited, and "Restore workspace" puts it back. An automation that reaches
for GitHub is now checked against `gh auth status` before it is armed and again
before it fires, rather than discovering a logged-out CLI four minutes into a
run. The automation page shows the configured branch and the branch actually
checked out side by side, so a workspace that moved is visible before you enable
anything. Overlapping scheduled and webhook fires now wait their turn and
re-check the destination workspace before starting, rather than colliding with
one another. If a run is cancelled or the app restarts, its workspace stays
reserved and, when needed, quarantined until the run and its checks have truly
stopped. Scheduled and webhook automations must have verification enabled and
at least one check configured before they can run unattended. Each managed
worktree can belong to only one enabled unattended automation, so two schedules
cannot quietly contend for the same workspace.

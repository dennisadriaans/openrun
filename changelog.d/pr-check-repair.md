- A pull request whose CI has gone red is no longer a dead end. The run that
  opened it now offers "Fix failing checks", which hands the failing check names
  back to the agent as a repair turn — the same loop the local checks panel
  already had, sourced from the pull request instead of the worktree.

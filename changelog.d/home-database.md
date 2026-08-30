- Switching git worktree or clone no longer starts you from an empty app.
  Runs, automations, and projects live in `~/.openrun` with the rest of Open
  Run's machine state, so every checkout on the same account sees the same
  local data. A leftover `data/openrun.db` in a repo is moved there on first
  boot.

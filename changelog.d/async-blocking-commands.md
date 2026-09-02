- Adding a project, preparing a worktree, pushing a branch and opening a pull
  request no longer freeze the whole app while they run. They used to block the
  server outright — a `pnpm install` in a fresh worktree stalled every other
  page and dropped every live stream — and a command that hung waited forever.
  Each now runs in the background with a time limit, and says so if it runs out.

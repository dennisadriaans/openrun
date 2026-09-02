- A recurring automation no longer runs once and then refuses every later fire
  with "the workspace has uncommitted changes". A scheduled or webhook run now
  commits what it left in its own worktree, so the next fire starts from a clean
  tree. Undo still reverses it from the run, and your primary checkout is never
  committed to.

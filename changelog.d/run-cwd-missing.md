A run whose working directory no longer exists now fails with what actually
happened. Node reports a missing `cwd` from `spawn` as an ENOENT on the binary,
so a deleted worktree used to surface as `spawn claude ENOENT` — reading as a
missing CLI. Starting or resuming a run into a directory that is gone is
refused up front, naming the path.

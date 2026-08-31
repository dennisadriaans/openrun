- Diffs for a run file no longer follow a path out of the workspace. An
  untracked-file compare that used `git diff --no-index` could previously be
  pointed at any file the OS user can read.

- A run whose work landed inside a git submodule no longer shows nothing to
  review. The changed-files strip, the right panel and the diff viewer used to
  report the submodule as a single entry with no line counts and no diff, so
  the chat showed edits you could not open. They now list the files that
  actually changed inside it. Undoing a submodule file is refused with a reason
  rather than silently doing nothing.

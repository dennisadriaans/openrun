- A scheduled automation that is refused before it starts — a dirty worktree, a
  logged-out `gh`, a runtime that left your PATH — no longer fails in silence.
  Your notifiers hear about it the first time it happens and again when the
  reason changes, instead of only ever hearing about runs that got as far as
  starting.

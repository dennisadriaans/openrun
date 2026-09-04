- You no longer have to read a change through a three-line keyhole. The diff
  viewer used to show only the hunks git emits, so a one-line edit arrived with
  no sense of the function it sits in. Each file card now has a toggle that
  expands the diff to the whole file with the changes marked in place, and the
  toolbar toggles every file at once. Per-hunk Undo steps aside while a file is
  expanded, since there is only one hunk to undo there — Undo file still works.

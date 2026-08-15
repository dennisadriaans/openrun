---
title: Finished turns fold their tool calls behind "Worked for 15s"
status: done
area: ui
---

You no longer have to scroll past forty tool rows to read what the agent
actually said. A finished turn collapses its tool calls, thoughts and interim
commentary behind a single **Worked for 15s** row — expand it to replay the
whole turn.

- While a turn is still running, long stretches of tool calls keep only the
  recent five, with a **+N previous tool calls** toggle for the rest.
- Shell tool calls carry a terminal icon rather than a file glyph, and an
  expanded row's output hangs off a guide line instead of floating in the
  transcript.

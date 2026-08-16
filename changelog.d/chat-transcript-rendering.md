---
title: Agent replies render as real markdown, edits as real diffs
status: done
area: ui
---

An agent's reply no longer loses half its formatting on the way to the screen.
The transcript renders GitHub-flavoured markdown — tables, ordered and nested
lists, task lists, links, footnotes — instead of the handful of shapes the old
in-house parser recognised, and a reply that arrived only as the turn's final
result is no longer swallowed when the turn also made tool calls.

- **Fenced code is highlighted** by the same highlighter the Files changed panel
  uses, with the language or filename in the header, plus copy and wrap.
- **Edits show a diff**, not two stacked blobs: `Edit` and `Write` calls render
  `+`/`−` rows with line numbers, syntax colors and elided unchanged runs — the
  same rows the git panel draws.
- **A file path in a reply is clickable.** Inline code like
  `src/lib/diff.ts:42` opens that file in the right panel.
- **Sub-agents get their own card** — the agent's name, what it was asked to
  do, a live status dot, and its report expanded as prose rather than as a wall
  of tool output.
- **The waiting state says what it is waiting for**: "Working for 1m 05s ·
  Running pnpm test" instead of three dots and nothing else.

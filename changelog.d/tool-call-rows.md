---
title: Tool calls as compact transcript rows
status: done
area: ui
---

Tool calls in a run no longer read as a stack of `Bash · command` titles that
expand into JSON. Each call is a compact row — **Ran**, **Read**, **Edited** —
with the file's type icon or the command in mono, a quiet spinner while it
runs, and an expand that shows the command output or the edit hunk instead of
the raw payload.

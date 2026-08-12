- Chat no longer paints every tool call the same gray wrench. MCP calls,
  skill invocations, and sub-agent spawns each get their own transcript
  chrome (eyebrow, icon, accent) so you can tell a `mcp__…` call or a Task
  spawn from a Bash at a glance — including on older turns that never stored
  a role (the UI classifies from the tool name on read).
- Fine-tuning chat event styling no longer means hunting through a 1 300-line
  Chat.tsx. Each event type lives under `components/chat/` and is driven by
  `--chat-event-*` CSS variables / `.chat-event--mcp|skill|subagent|…` rules
  in `styles.css`, so accents, gaps, and radii can be tuned without touching
  the React.

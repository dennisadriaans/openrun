- Typing `/` in a composer no longer produces a prompt that starts with a
  stray slash. The commands your CLI already has on disk —
  `.claude/commands/`, `~/.codex/prompts/`, `.gemini/commands/` — are offered
  in a menu with their descriptions, in run chat, in the new-run composer, and
  in an automation's prompt. Open Run sends the command as typed; the agent
  expands it.
- Chat also answers a few commands itself, which used to have no equivalent
  outside an interactive CLI: `/clear` starts a fresh chat, `/model`,
  `/effort` and `/mode` change the next turn's pickers, `/mcp` opens the MCP
  servers page, and `/help` lists what is available. They
  never reach the agent, and an automation's prompt does not offer them — an
  unattended run has nobody to answer them.

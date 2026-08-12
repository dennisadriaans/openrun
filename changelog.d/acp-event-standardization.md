- Chat no longer describes every tool call the same way. Tool calls carry the
  Agent Client Protocol's own fields — a title, a kind (read / edit / execute /
  search / think / fetch), a live status, and the files they touched — so the
  transcript shows a spinner while a call runs, marks a failed one in red, gives
  each kind its own icon, and links the files it changed straight into the
  workspace browser instead of a row of identical wrenches.
- Reasoning and plans no longer vanish. An agent's thinking arrives as a
  collapsed "Thinking" block rather than being dropped on the floor, and its
  todo list renders as a plan with each item's state instead of being invisible.
- Parsing a new CLI is no longer a guessing game across one 400-line file. Each
  agent has its own adapter in `lib/agentEvents/`, all of them mapping onto one
  published vocabulary (`lib/acp.ts`) rather than a shape we invented — and
  `pnpm typecheck` fails if that copy drifts from the protocol.
- Supervised approvals are no longer Claude-only, and no longer a hardcoded
  Allow / Deny. A prompt renders the buttons the agent actually offered, and any
  runtime on the ACP transport can be supervised. Runtimes that cannot pause and
  ask (`codex exec`, headless Grok) no longer offer Supervised in the picker and
  are refused by the server if asked anyway, instead of silently ignoring it.
- Runtimes are no longer limited to whatever their CLI prints. A runtime can now
  run on the **Agent Client Protocol** transport, where Open Run drives the agent
  over JSON-RPC — no output parsing, follow-up turns via `session/load`, and
  approvals over `session/request_permission`. Gemini ships as a preset
  (`gemini --experimental-acp`), and the editor suggests the adapter command for
  Claude and Codex.
- Gemini is no longer a nameless generic runtime: it has a model catalog, and
  over ACP it can hold a conversation. On the plain CLI transport it stays
  single-shot, and its prose output is no longer chopped into one raw pill per
  line.
- A run's transcript is no longer readable only by this app. `GET
  /api/runs/:id/ui-stream` replays it in the AI SDK UI Message Stream format, so
  anything that already speaks that protocol can read an Open Run run.

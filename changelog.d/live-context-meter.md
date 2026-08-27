- You no longer have to guess how full the agent's context is. The run view now
  shows a live gauge in its top bar — context size, the share served from cache,
  and how close the window is to full — fed by whatever the CLI streams about
  itself (Claude's per-message `usage`, Codex's `token_count`, Grok's `usage`
  envelope, and `usage_update` from any ACP agent). A runtime that reports no
  counts shows nothing rather than a zero pretending to be a measurement.

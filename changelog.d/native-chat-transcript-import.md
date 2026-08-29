- A chat you started in Claude Code itself is no longer a one-line "Resumed
  Claude chat" note. Picking it from the composer opens the whole conversation
  in Open Run — prompts, reasoning, tool calls and their results, token counts —
  rendered the same way a run Open Run executed itself is.
- Opening one costs nothing. Adopting a chat imports its transcript and stops
  there, instead of firing a `continue` prompt at the model just to have
  something to show; the first turn Open Run runs is the message you type next.
- Whether the history loads no longer depends on where the conversation goes
  next. Reading a saved chat is separate from resuming one, so the transcript is
  there whether you continue on the same CLI or hand the work to another runtime.
  Runtimes without a transcript reader (Codex, Grok, Antigravity) resume exactly
  as before.

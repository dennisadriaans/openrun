- A chat is no longer stuck on the runtime it started with. The composer has a
  runtime picker: pick Codex halfway through a Claude chat and the next turn runs
  there, in the same workspace, on the same branch, with the same diffs — the new
  agent gets a summary of the conversation so far and carries on. A one-time note
  spells out what a handoff does and does not keep, with a "Don't show this
  again" for after the first time.
- A runtime that cannot resume its own sessions no longer ends the conversation.
  A run on such a runtime can still be continued by handing it to one that can.

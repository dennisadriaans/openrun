Automations now target a project and optional base revision instead of a persistent
workspace. Every invocation gets a separate execution directory pinned to its resolved
base commit; results remain reviewable after safe cleanup and are restored for follow-ups.

You can now start an interactive chat on the primary checkout when you want Open
Run to work alongside your editor, including its current branch and uncommitted changes.

You can now open a saved Codex chat with its existing conversation already
visible instead of waiting for the next message to populate the run.

You can now open saved Grok and Antigravity chats with their existing history,
and plain pull-request mentions such as `PR #41` link to that project's GitHub
pull request.

Saved CLI chats now import every available turn without a history cap, keep all
assistant commentary visible, and preserve text-based tool output from each CLI.

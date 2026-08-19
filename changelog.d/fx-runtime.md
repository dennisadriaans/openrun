You no longer have to add fx by hand. It ships as a builtin runtime over the
Agent Client Protocol (`fx acp`), so follow-up turns, tool statuses, and
Supervised approvals work the same way they do for other ACP agents. The model
picker reads `fx models --json` from your installed binary, and a selected
model is passed as `fx acp --model` so it applies even when a session is
resumed.

- You can stop guessing whether Supervised mode can pause a headless run — Claude needs a live stdin control channel (`--permission-prompt-tool stdio`), and Codex `exec` cannot round-trip approvals the way Open Run spawns it today.


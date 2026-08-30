You no longer lose MCP OAuth tokens, notification webhook URLs, or APNs
tokens if someone copies `openrun.db`. Those values are sealed with a
key that lives in `~/.openrun/data-key`, not in the database.

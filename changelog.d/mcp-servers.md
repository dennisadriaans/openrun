- Giving an agent an MCP server no longer means leaving Open Run for a text
  editor. A new **MCP servers** page reads and writes the CLI's *own* config —
  `~/.claude.json`, a workspace `.mcp.json`, `~/.codex/config.toml`,
  `~/.gemini/settings.json` — so a server you add here is the same one your
  hand-run `claude` session sees, and one you already had shows up already
  filled in. A `.mcp.json` server is marked approved for that workspace too,
  so an unattended run can actually use it instead of silently skipping it.
- ACP runtimes no longer start every session with an empty server list. Open
  Run passes its own list in `session/new` / `session/load`, which is how an
  agent with no config file of its own (fx) can be given MCP servers at all.
- Grok is no longer missing from the page. `~/.grok/config.toml` and a
  workspace `.grok/config.toml` are read and written like the rest, with the
  `enabled` key Grok expects, and saving a workspace server records the folder
  in `~/.grok/trusted_folders.toml` — without that Grok silently declines to
  start a repo-local server.
- An MCP server no longer has to be added once per CLI. **Shared servers** are
  defined once in Open Run and written into every CLI's machine-wide config —
  `~/.claude.json`, `~/.codex/config.toml`, `~/.grok/config.toml`,
  `~/.gemini/settings.json` — so a run picks the server up whichever runtime it
  uses, and an ACP agent is handed the same list over the protocol. Open Run
  records the copies it made: removing a shared server takes back only those,
  and a name a CLI already had from somewhere else is reported as a conflict
  rather than silently overwritten.
- Servers you already had are no longer stranded in whichever CLI you added
  them to. Open Run reads every CLI config it knows and offers what it finds
  for import; taking one copies it into the shared list and out to the other
  CLIs, leaving the config it came from untouched. Where two CLIs hold the same
  name with different settings you pick which copy is right instead of Open Run
  guessing, and a server carrying a token says so before it is copied anywhere.
- Fanning a server out no longer writes it somewhere it cannot work. Each host
  declares the transports it can dial — Codex has no SSE, Gemini reads
  `httpUrl` for streamable HTTP and a bare `url` as SSE — so an entry is either
  written in that host's own dialect or skipped with the reason. Gemini's
  streamable-HTTP servers were previously unreadable and are now imported
  correctly.
- A CLI you have not installed is left alone rather than having a config
  invented for it, and the first time Open Run changes one of your config files
  it keeps a `.openrun-backup` copy beside it.

# Open Run

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

**Schedule Claude Code, Codex, Grok and Gemini like cron jobs — on your machine, with no API keys.**

Open Run drives the coding-agent CLIs you are already logged into. A run is a conversation you can follow up on. Each turn snapshots git so you can review a diff and open a PR.

```bash
git clone https://github.com/dennisadriaans/openrun.git
cd openrun && pnpm install && pnpm dev
```

Open <http://localhost:3000>. Requires Node 22+, pnpm, and at least one of `claude`, `codex`, `grok`, or `gemini` logged in. Use WSL2 on Windows.

1. **Add a project** — a local git repo — from Automations.
2. **New automation** — pick the project, write a prompt under Agent Instructions, Create.
3. **Run now** and open the run to watch it stream.

> [!WARNING]
> **Open Run runs agent CLIs with your credentials in directories you choose.** Anyone who can reach its HTTP server can run commands as you. It binds `127.0.0.1` only. Start with read-only prompts. See [SECURITY.md](./SECURITY.md).

Docs: [openrun.sh](https://openrun.sh) · Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

## Open source

[GNU AGPLv3](./LICENSE). Everything that runs on your machine is open source and stays that way. Commercial terms: [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md).

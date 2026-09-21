<div align="center">

# Open Run

**Schedule coding agents on your machine.**

Run Claude Code, Codex, Grok, Antigravity and fx like cron jobs — no API keys,
no hosted runner, no account. Your repositories never leave your disk.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![CI](https://github.com/dennisadriaans/openrun/actions/workflows/ci.yml/badge.svg)](https://github.com/dennisadriaans/openrun/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22.12-informational)](https://nodejs.org)

<img src="./public/screenshots/setup-automation.png" alt="Open Run automation setup: project, agent instructions, runtime and triggers." width="900">

</div>

## Table of contents

- [What it is](#what-it-is)
- [Quick start](#quick-start)
- [Command line](#command-line)
- [Features](#features)
- [Runtimes](#runtimes)
- [Security](#security)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## What it is

Open Run drives the coding-agent CLIs you are already logged into. Point it at a local
git repository, write a prompt, and give it a trigger — a cron schedule, a webhook, or
one shot. A run is a conversation you can follow up on, and every turn snapshots git so
you can read the diff, undo it, or open a pull request.

It bills through the CLI subscription you already pay for. It holds no model API keys
and sends no prompt or file to a model provider itself.

## Quick start

```bash
git clone https://github.com/dennisadriaans/openrun.git
cd openrun
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

1. **Add a project** — a local git repository — from Automations.
2. **New automation** — pick the project, write the prompt under Agent Instructions, Create.
3. **Run now**, and open the run to watch it stream.

### Requirements

- Node 22.12+ and pnpm 10+
- git
- At least one agent CLI logged in: `claude`, `codex`, `grok`, `agy` or `fx`
- macOS and Linux natively; Windows through WSL2
- `gh` only if you want pull requests

## Command line

The CLI runs the application locally, without `pnpm dev`, `pnpm start`, a web
build, or an Open Run account. After installing dependencies, link it once:

```bash
pnpm link --global
cd /path/to/your/repository
openrun init --check "pnpm test"
openrun runtimes
openrun schedule every weekday at 8:30 "sweep dependency updates" for claude
openrun run "why is the checkout test flaky?" for codex
openrun automations list
openrun runs --limit 20
openrun show <run-id>
openrun cancel <run-id>
openrun now <automation-id-or-name>
openrun disable <automation-id-or-name>
```

`pnpm cli …` works too. `init` registers an existing Git repository; it detects
project checks and accepts repeatable `--check` options to replace them. Running
`init` again reuses the project. Unattended runs keep the application's existing
verification and Git preflight requirements. Each scheduled invocation gets a
fresh execution directory; you do not need to create worktrees yourself.

The first command starts a small background worker automatically. It owns the
same scheduler, executor, integration relay and SQLite database as the web app.
Closing the terminal leaves it running. Runs, transcripts, automations and
connections stay in `~/.openrun/openrun.db`; `OPENRUN_HOME` selects another home.
No HTTP application server starts. CLI requests use an authenticated loopback
IPC connection whose credential is kept in an owner-only directory.

```bash
openrun worker status       # no startup side effect
openrun worker start
openrun worker logs
openrun worker stop         # waits for shutdown; cancels active runs
```

Keep the machine awake and the worker running for schedules to fire. This does
not install a login/startup service: after reboot, run `openrun worker start`
(or any local application command). The shared scheduler records missed fires
and applies its existing catch-up rules. Only one process may own a data home:
if the web app already owns it, the CLI connects to that process automatically.
To switch from a headless worker to the web app, stop the worker first. Neither
process can reap the other's runs or arm duplicate schedules.

The workspace defaults to your current checkout; `in <project>` or `in <path>`
overrides it. A bare time (`at 16:40`, `in 20 minutes`, `tomorrow at 9`) fires
once and then pauses. `every day at 9`, `every 15 minutes` and
`cron "0 9 * * 1-5"` recur in the worker machine's timezone. Add `--dry-run` to
`schedule` or `run` to preview without creating an automation or run. Local
previews can initialize the worker and database. `--json` emits structured
results, with diagnostics and prompts on stderr.

### Integrations from the terminal

```bash
openrun integrations providers
openrun integrations connect             # choose a provider interactively
openrun integrations connect github      # explicit provider
openrun integrations list
openrun integrations configure          # choose connection, runtime, workspace, event
openrun integrations disable <connection-id>
openrun integrations enable <connection-id>
openrun integrations disconnect <connection-id>
```

Connect prints the authorization URL and waits for a temporary loopback browser
callback. It signs in first if necessary; the web application is not needed.
Configure binds that connection to a working automation. For scripts, supply all
choices explicitly (missing choices fail rather than hanging on a prompt):

```bash
openrun integrations configure <connection-id> \
  --runtime claude --in /path/to/repo \
  --event issues.opened --prompt "Implement {{issue.title}}" --name issue-worker
```

Provider authorization and webhook delivery still use Open Run Cloud's existing
relay. Local scheduling, execution and history work without it, including with
`OPENRUN_CLOUD_URL=off`. This CLI does not introduce a second token store or
pretend external provider events are available offline.

### Advanced and remote use

`openrun api` lists the complete application contract and required fields.
`openrun api <operation> '<JSON>'` exposes operations such as runtime editing,
MCP configuration, follow-up messages, approvals and trigger filters using the
same validation and business rules as the UI. `--dry-run` previews an API call.

Use `--url http://host:3000` (or `OPENRUN_URL`) only to target a server explicitly;
`--token` / `OPENRUN_ACCESS_TOKEN` authenticate that HTTP connection. A remote
failure never silently switches to local storage. `openrun --help` lists the
commands.

## Features

- **Triggers** — hourly, daily, weekly, a custom cron expression, a one-off at a set
  time, or a webhook from GitHub, GitLab, Bitbucket, Jira, Linear or Azure DevOps.
- **Per-run runtime** — Claude this run, Codex the next. The workspace is never locked
  to one agent.
- **Diff review** — every run ends in a file-by-file diff, not a wall of agent chatter.
- **Git actions** — commit, cut a branch, push, or open the pull request in one click;
  Undo All restores the snapshot taken when the run started.
- **Project-first execution** — interactive chats use the checkout and uncommitted work
  already open in your editor. Each automation invocation gets a clean execution directory
  under `~/.openrun/executions`, pinned to its recorded base commit and isolated from every
  other run.
- **Supervised runs** — surface each tool call as Allow/Deny before it happens.
- **Local by default** — runs, prompts, transcripts and diffs live in a local SQLite
  file. Webhooks reach localhost over an outbound WebSocket to openrun.sh, so there is
  no ngrok, port forwarding or signing secret; that part is optional and everything else
  works signed out.

## Runtimes

| Runtime | Binary | Transport |
| --- | --- | --- |
| Claude Code | `claude` | CLI (stream-json) |
| Codex CLI | `codex` | CLI (`codex exec`) |
| Grok CLI | `grok` | CLI (streaming-json) |
| Antigravity CLI | `agy` | CLI (stream-json) |
| fx | `fx` | ACP |

Adding your own is a preset, not a fork — see
[adding a runtime](https://openrun.sh/docs/adding-a-runtime).

## Security

> [!WARNING]
> **Open Run runs agent CLIs with your credentials in directories you choose.** Anyone
> who can reach its HTTP server can run commands as you. It binds `127.0.0.1` and
> refuses to start on a public interface without an access token. Start with read-only
> prompts.

Full model and vulnerability reporting: [SECURITY.md](./SECURITY.md).

## Development

```bash
pnpm dev            # app on :3000
pnpm dev -- --demo  # sample Runs + Automations, no DB writes
pnpm test
pnpm typecheck
pnpm build
```

Architecture and module boundaries: [AGENTS.md](./AGENTS.md) and
[openrun.sh/docs/architecture](https://openrun.sh/docs/architecture).

### Keeping it running

Cron only fires while Open Run is running, so a terminal tab is not where a
scheduler should live. Build it and run it as a background service:

```bash
pnpm build
pnpm start          # serves the build; refuses an unsafe bind
```

Templates for launchd (macOS) and systemd (Linux) are in
[`contrib/service/`](./contrib/service/) — they start Open Run with your user
session and restart the app if it dies. On Linux, lingering can keep the user
service running after logout.

> Open Run is experimental and in active development.

## Contributing

Issues and pull requests are welcome — start with [CONTRIBUTING.md](./CONTRIBUTING.md).
Contributors sign the [CLA](./CLA.md). Please also read the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[GNU AGPLv3](./LICENSE). Everything that runs on your machine is open source and stays
that way. Teams that cannot ship AGPL: [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md).

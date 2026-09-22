# Open Run

Run and schedule coding agents from any Git repository. Open Run uses the agent
CLIs you already have installed and logged in, and keeps your runs and history
on your machine.

## Install

Use Node.js 22.12 or newer on macOS, Linux, or Windows through WSL2. You also
need Git and an installed, signed-in coding agent such as Claude Code or Codex.

```bash
npm install -g NPM_PACKAGE_NAME
```

This installs the `openrun` command for use from any directory. No repository
clone, pnpm, web build, or Open Run account is required.

The interactive OpenTUI interface also needs [Bun 1.3+](https://bun.sh), or
Node.js 26.4+. Open Run selects the renderer runtime automatically. The worker
and commands with `--yes` or `--json` continue to use Node.js 22.12+.

## Open your agent with the right settings

```bash
openrun sol medium
openrun claude opus high
openrun "review my changes using Sol with medium reasoning"
```

Open Run opens the native Codex or Claude Code interface in your current
directory. A task is optional. Your existing agent login is used; no project
registration, Open Run account or inference API key is needed.

Natural-language interpretation sends the request you type and available model
choices to Open Run and TypeSafe. It does not read or send repository files.
When interpretation is unavailable, choose the agent and settings locally.
To skip hosted interpretation, pass explicit options:

```bash
openrun launch --runtime codex --model gpt-5.6-sol --effort medium
openrun launch --runtime claude --prompt "fix the schedule page"
```

Use `--dry-run --json` to inspect a launch without starting an agent.
`OPENRUN_CLOUD_URL=off` disables hosted interpretation. Explicit options still
work. The prompt passed through `--prompt` or after `--` stays literal.

## Start a managed run

Open the repository you want the agent to work on:

```bash
cd /path/to/your/repository
openrun init
openrun run "summarise the recent changes in this repository"
```

`init` registers your repository and detects its verification commands. You can
also start with `openrun run`: an unregistered checkout leads into setup.

Press **Enter** to confirm the preselected agent, then **Enter** again to run.
Your last agent is remembered. Use the arrow keys to change agents, choose
**Schedule for later**, or edit the project, model and prompt under **Change
settings**. A compact summary shows what is about to run.

Run `openrun` on its own for the live Home overview: upcoming schedules,
automations, integrations and recent runs. Run activity updates in place,
including work started from another terminal. Press **Tab** to scroll the
overview, **Esc** to go back, and **Ctrl+C twice** to quit. Missing names and IDs lead to
selectors; invalid command options can be corrected in place. Use `--yes` to
skip prompts, with `--runtime` when more than one agent is available. `--json`
also skips prompts and returns structured results. Set `NO_COLOR=1` to turn
off colors.

The command prints `openrun show` followed by the run ID. Run it to read the
status and saved conversation, or use `openrun runs` to list recent work.

## Schedule work

```bash
openrun schedule every weekday at 9 "sweep dependency updates"
openrun schedule in 10 minutes "review my changes" using sol medium
openrun automations list
```

Run `openrun schedule` to choose a task, agent and timing step by step, or pass
the schedule directly as above. Scheduled work requires project verification
checks; if none were detected, setup asks for an appropriate command. You can
also set one with `openrun init --check "your test command"`. Use `--dry-run` to
preview before saving.

The background worker starts automatically and keeps running when you close the
terminal. Keep the machine awake for schedules to fire. After reboot, start it
again with `openrun worker start`.

```bash
openrun worker status
openrun worker logs
openrun worker stop
```

Stopping the worker cancels active runs. History remains in
`~/.openrun/openrun.db`; set `OPENRUN_HOME` to use another data directory.

## Install in one project

For a project-local installation, use `npx` to invoke the command:

```bash
npm install --save-dev NPM_PACKAGE_NAME
npx openrun init
npx openrun run "review the checkout flow"
```

## Next steps

- [Command line guide](https://openrun.sh/docs/cli): schedules, runs, worker
  management, scripting, and remote access.
- [Integrations](https://openrun.sh/docs/integrations): connect an issue tracker
  from the terminal with `openrun integrations connect`.
- [Security](https://openrun.sh/docs/security): how local access and agent
  execution work.

Use `openrun --help` or `openrun <command> --help` for command options.

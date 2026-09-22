const GLOBAL_OPTIONS = `
  --json               structured output for scripts
  -y, --yes            skip prompts; supply ambiguous choices explicitly
  --url URL            target a remote server (or OPENRUN_URL)
  --token TOKEN        authenticate remotely (or OPENRUN_ACCESS_TOKEN)
  -h, --help           show help for this command`

const RUN_OPTIONS = `
  --runtime NAME       preselect an agent (default: last used, then installed)
  --in PATH|NAME       workspace (default: current checkout)
  --model NAME         override the runtime's default model
  --prompt TEXT        pass the prompt literally, including schedule words
  --dry-run            preview without creating a run or automation`

const HELP: Record<string, string> = {
  init: `openrun init [path] [--check COMMAND]…

Register a Git repository and detect its verification commands.
Repeat --check to replace detected checks. Running init again reuses the project.

  openrun init
  openrun init --check "pnpm typecheck" --check "pnpm test"`,
  schedule: `openrun schedule [<when>] ["prompt"] [for <runtime>]

Omit the time or prompt for guided setup with editable timing presets.

  openrun schedule every weekday at 8:30 "sweep dependency updates"
  openrun schedule in 20 minutes "check the build" for claude
  openrun schedule cron "0 9 * * 1-5" --prompt "review new issues" --dry-run

Once: at 16:40 · in 20 minutes · tomorrow at 9
Recurring: every day at 9 · every monday · every 15 minutes · hourly
Times use the local timezone. Keep the machine awake for schedules to fire.

Options${RUN_OPTIONS}
  --name NAME          automation name (default: derived from prompt)
  --cron EXPRESSION    raw cron schedule`,
  run: `openrun run ["prompt"] [for <runtime>]

Start a conversation in the current checkout. The worker continues after exit.
Confirm the preselected agent, then press Enter to run. Choose Schedule for later
or Change settings to edit the project, model or prompt. Omit the prompt to enter it.

  openrun run "fix the flaky checkout test"
  openrun run --runtime codex --prompt "review the CLI"
  openrun run --runtime claude -- explain what runs every day at 9

Options${RUN_OPTIONS}

Use -- before literal prompt text. Inspect the returned ID with openrun show.`,
  ls: `openrun automations [list|schedule|now|enable|disable|rm]

  openrun automations list
  openrun now "Nightly sweep"
  openrun disable "Nightly sweep"

Names and IDs are accepted. Omit them to choose interactively.
Aliases: openrun ls, openrun list.`,
  runs: `openrun runs [--limit N]

List recent runs (default: 15).

  openrun runs --limit 30
  openrun show <run-id>`,
  show: `openrun show [run-id]

Read a run's status, prompt and conversation. Add --json for the full record.
Omit the ID to choose from recent runs.`,
  cancel: `openrun cancel [run-id]

Stop an active run. Omit the ID to choose a run, then confirm.`,
  now: `openrun now [automation-name-or-id]

Start an existing automation immediately. Prints the run ID and next command.`,
  enable: `openrun enable [automation-name-or-id]

Resume an automation's schedule. Find it with openrun automations list.`,
  disable: `openrun disable [automation-name-or-id]

Pause an automation's schedule. Find it with openrun automations list.`,
  rm: `openrun rm [automation-name-or-id]

Delete an automation. To pause it instead, use openrun disable.`,
  runtimes: `openrun runtimes

Choose a default agent, enable or disable agents, and add a built-in preset.
Use --yes for a plain list. Only installed, enabled agents are offered for runs.`,
  projects: `openrun projects

Choose a repository to run or schedule work, or register another checkout.
Use --yes for a plain list.`,
  where: `openrun where

Show the current workspace, available runtimes and local or remote connection.`,
  worker: `openrun worker [status|start|stop|logs]

  status   show whether a local worker or web app is running; never starts one
  start    start the background worker, or reuse the existing runtime
  stop     stop the worker and cancel its active runs
  logs     print the worker log

Application commands start the worker automatically. It survives terminal exit.
After reboot, start it again. Stop it before switching to the web app.`,
  integrations: `openrun integrations [list|providers|connect|configure|enable|disable|disconnect]

  openrun integrations connect github
  openrun integrations configure <connection-id> --event issues.opened
  openrun integrations disable <connection-id>

Connect prints a browser authorization URL. Configure uses the current checkout
and a preselected available agent. Enter confirms; arrow keys change choices.

Configure options
  --runtime NAME       agent CLI
  --in PATH|NAME       workspace
  --event NAME         provider event (list with integrations providers)
  --prompt TEXT        override the provider's default prompt
  --name NAME          automation name

Scripts must supply ambiguous choices. Authorization needs Open Run Cloud.`,
  login: `openrun login

Print a browser URL to sign in for hosted integrations.
Local runs and schedules work without signing in.`,
  api: `openrun api [operation] [JSON]

Browse application operations and their inputs, or call one with a JSON object.
Use --yes for a plain list without prompts.
Help and the operation list work without starting a worker.

  openrun api
  openrun api runs.get '{"id":"run_123"}'
  openrun api tasks.toggle '{"id":"task_123","enabled":false}' --dry-run

  --dry-run            print the operation and input without sending it`,
}

export function cliHelp(command = ''): string {
  if (command) return `${HELP[command]}\n\nGlobal options${GLOBAL_OPTIONS}`
  return `openrun — run and schedule local coding agents

Get started in your repository
  openrun              open the guided menu
  openrun init
  openrun run "fix the flaky checkout test"
  openrun schedule every weekday at 9 "sweep dependency updates"

Commands
  init                 register a repository and detect checks
  run                  start a conversation now
  schedule             schedule an automation
  automations          list and manage automations (alias: ls)
  runs                 list recent runs
  show / cancel        inspect or cancel a run
  now / enable / disable / rm   manage an automation by name or ID
  runtimes / projects  see available CLIs and repositories
  integrations         connect providers and configure event triggers

Advanced
  worker               status, start, stop and logs
  where                current workspace and connection
  login                sign in for hosted integrations
  api                  access every application operation

The worker starts automatically. Enter confirms sensible defaults; ↑↓ changes
choices. Run now or choose a schedule, with a summary before starting work.
Use --yes to skip prompts, --json for scripts, NO_COLOR=1 to disable colors.
Use openrun <command> --help for examples.

Global options${GLOBAL_OPTIONS}`
}

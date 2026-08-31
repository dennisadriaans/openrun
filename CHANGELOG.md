# Changelog

All notable changes to Open Run are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

## v0.1.1 — 2026-08-31

- You no longer need to publish a prepared release manually after its automated pull request merges, or find a green publish job that skipped a squash commit carrying its pull request number.
- You no longer get a failed release because GitHub Actions lacked the identity required to create its annotated tag.

### 🩹 Fixes

- **release:** configure tag author ([#65](https://github.com/dennisadriaans/openrun/pull/65))
- **release:** publish bot-merged releases ([#64](https://github.com/dennisadriaans/openrun/pull/64))

**Full changelog**: [`v0.1.0...v0.1.1`](https://github.com/dennisadriaans/openrun/compare/v0.1.0...v0.1.1)

## v0.1.0 — 2026-08-31

> **2 breaking changes.** Read the entries below before upgrading.

- You no longer miss Claude Code / Codex when Open Run is started from Cursor or another GUI — common user install dirs (`~/.local/bin`, Homebrew, npm/pnpm, Windows `%USERPROFILE%\.local\bin`) are added to PATH automatically, and older databases that only had a partial builtin list get the full Claude / Codex / Grok / Gemini set back (Aider and the shell-echo demo are retired).
- You no longer hit Enable/Run now/form/queue/Next-run with four slightly different copies of the same refuse logic — workspace / PATH / prompt share `lib/runPrereqGate.ts`, the queue skips empty-prompt entries the scheduler would refuse, and Next run names a missing or not-ready workspace instead of a blank dash.
- You no longer watch a Supervised Claude run stall until the five-minute auto-deny — Allow / Deny on each pending approval request answers the live session from chat.
- You no longer pay a 10s HTTP poll on a healthy run SSE stream — active-run and conversation queries stay quiet while the EventSource is up and only resume the old cadence if it drops.
- You no longer land on Planner with no projects and a form that cannot save — Planner uses the same empty-projects gate as Automations.
- You no longer click Run now or Enable on a legacy blank-prompt automation only to spawn a silent no-op — both stay disabled with the refuse reason on hover, lists flag “no prompt”, Next run says it won’t fire, and the scheduler skips arming until Agent Instructions has text.
- You no longer have to read a transcript to know whether an unattended run worked — projects define **checks** that run in the worktree after every turn, and each run gets a **verdict** (Verified / Checks failed / No changes / Unverified / Timed out / Crashed) instead of just an exit code.
- You no longer babysit a red run — a failed-checks run hands the failing output back to the same agent session as a bounded repair turn.
- You no longer lose a workspace to a wedged CLI — every run has a wall-clock budget and is stopped when it elapses.
- You no longer find out about a broken 6am run by opening the app — Discord / webhook / desktop notifiers fire when a run settles, by default only when it needs attention.
- You no longer silently lose a cron tick that lands while the previous run is still working — unattended fires queue for the workspace instead of throwing into a console log with no run row.
- You no longer get a fresh install with no demo runtime — the Aider/Gemini rows were being inserted before `seedRuntimes`, whose empty-table guard then skipped Claude, Codex, Grok and Demo entirely.
- You no longer create an automation with a blank prompt — Create / Save stay disabled until Agent Instructions has text (hover shows why), and the server refuses empty or whitespace-only prompts the same way.
- You no longer have to start a run to find out what a runtime actually spawns — the Runtimes editor shows a live **Command preview** of the resolved argv (with the flags Open Run injects highlighted, and any template flag it took over called out), say how the prompt reaches the CLI, and let you copy the exact command. A template that would leave the agent with no prompt at all is now flagged before you save it instead of producing a silent no-op run.
- You no longer see a Command preview block on Create / Edit automation or on the run follow-up composer — those surfaces stay lean; argv inspection lives on Runtimes.
- You no longer open Create pull request (or wonder why Push is greyed out) when the workspace has no `origin` or `gh` is missing / not logged in — both controls stay disabled with the refuse reason on hover (sidebar and git menu), and the server refuses missing `origin` before calling `gh`.
- You no longer need a second dropdown click after picking a project on the Planner — Open Run auto-selects a ready workspace (main checkout preferred), including when a worktree finishes setup and flips from creating to ready.
- You no longer click Enable on a broken automation only to get an alert — Automations list and detail disable Enable (Pause still works) when the schedule, workspace, or runtime CLI would be refused, with the reason on hover.
- You no longer click **Run now** only to get an alert when the workspace or CLI would refuse — the button stays disabled on the Automations list and detail page, and hover shows the same refuse reason the server would return.
- You no longer arm a schedule against a missing agent CLI — Enable / save-as-Active refuse with the same “not found on PATH” error as Run now, lists flag “CLI not on PATH”, and Next run says it won’t fire until the binary is installed.
- You no longer save, enable, or run an automation against a worktree that is still creating or failed setup — Open Run refuses until the workspace is ready (same gate chat already used), and lists flag non-ready workspaces.
- You no longer land on Automations → New (or an empty Automations list) with no next step when Projects is empty — Open Run asks you to add a repository first so Create / Planner are not a dead end.
- You no longer stare at a blank “Next run” dash on a broken automation — open the detail page and an invalid schedule is called out with a **Fix schedule** link that opens the editor on the bad expression.
- You no longer land on Claude by default when creating an automation or plan without a last-used runtime — Open Run picks an installed CLI (often Demo) so the first try works without installing an agent.
- You no longer get an orphan failed run with `spawn ENOENT` when a runtime CLI is missing — **Run now**, follow-ups, and scheduled starts refuse immediately with a clear “not found on PATH” error (and the automation form warns when the selected runtime isn’t installed).
- Supervised mode now actually pauses and asks (Claude): a run started in Supervised opens Claude's stdio approval channel, surfaces each tool request as an `approval_request` event in chat, answers it over the live process (server fn `answerApproval`), and auto-denies anything left unanswered after 5 minutes with the reason in the log. Supervised runs are refused on a schedule, since no one is watching to approve. (Core of `03`; Allow/Deny buttons ship in Unreleased cleanup.)
- You can stop guessing whether Supervised mode can pause a headless run — Claude needs a live stdin control channel (`--permission-prompt-tool stdio`), and Codex `exec` cannot round-trip approvals the way Open Run spawns it today.
- A runtime can now be marked "May open pull requests" on the Runtimes page — eligible runs get a prompt telling the agent it may branch, commit, push and `gh pr create`, so an unattended automation can finish as a PR instead of a dirty tree. And a run that exits 0 while its `gh`/`git` output shows a real failure (unauthenticated, no remote, missing binary) is now flagged as an error instead of looking green. (Core of `05`; live end-to-end soak on a real remote still to come.)
- You can stop guessing whether a spawned agent can reach your `gh` login — executor children inherit working `gh` auth via `process.env`, and unauthenticated / no-remote failures already surface clearly in the log.
- You no longer get locked out of your own app by setting an access token. A configured token used to be unusable from a browser: the SPA's fetches and its `EventSource` connections had no way to carry one, so every request after the first came back `401`. Load the app once at `/?agentops_token=<token>` — the token is exchanged for an `HttpOnly` cookie, stripped back out of the address bar, and every later request carries it on its own. The `401` now says how.

  You also no longer have to work out why `pnpm token` printed an npm registry error instead of your token: pnpm claims that command name for itself, so the script is `pnpm token:print`. It prints the sign-in URL along with the token.
- Chat no longer describes every tool call the same way. Tool calls carry the Agent Client Protocol's own fields — a title, a kind (read / edit / execute / search / think / fetch), a live status, and the files they touched — so the transcript shows a spinner while a call runs, marks a failed one in red, gives each kind its own icon, and links the files it changed straight into the workspace browser instead of a row of identical wrenches. - Reasoning and plans no longer vanish. An agent's thinking arrives as a collapsed "Thinking" block rather than being dropped on the floor, and its todo list renders as a plan with each item's state instead of being invisible. - Parsing a new CLI is no longer a guessing game across one 400-line file. Each agent has its own adapter in `lib/agentEvents/`, all of them mapping onto one published vocabulary (`lib/acp.ts`) rather than a shape we invented — and `pnpm typecheck` fails if that copy drifts from the protocol. - Supervised approvals are no longer Claude-only, and no longer a hardcoded Allow / Deny. A prompt renders the buttons the agent actually offered, and any runtime on the ACP transport can be supervised. Runtimes that cannot pause and ask (`codex exec`, headless Grok) no longer offer Supervised in the picker and are refused by the server if asked anyway, instead of silently ignoring it. - Runtimes are no longer limited to whatever their CLI prints. A runtime can now run on the **Agent Client Protocol** transport, where Open Run drives the agent over JSON-RPC — no output parsing, follow-up turns via `session/load`, and approvals over `session/request_permission`. Gemini ships as a preset (`gemini --experimental-acp`), and the editor suggests the adapter command for Claude and Codex. - Gemini is no longer a nameless generic runtime: it has a model catalog, and over ACP it can hold a conversation. On the plain CLI transport it stays single-shot, and its prose output is no longer chopped into one raw pill per line. - A run's transcript is no longer readable only by this app. `GET /api/runs/:id/ui-stream` replays it in the AI SDK UI Message Stream format, so anything that already speaks that protocol can read an Open Run run.
- "Add project" no longer drops you into the Projects list you just came from. From the project picker on a new run — and from the "Add a project first" empty state — it opens the folder browser straight away, so adding a repo is one step instead of two.
- Adding a project no longer requires a repo that already exists on disk. The folder picker has a "new folder" button that creates an empty folder where you are browsing and `git init`s it, so a greenfield project starts from Open Run instead of from a terminal.
- An unattended automation no longer runs in a workspace that cannot support it. A workspace whose directory has been removed no longer reports `ready` and crashes the run with `spawn <cli> ENOENT` — it is inspected before the fire, marked broken, and the automation says so. Scheduled and webhook runs no longer share the project's main checkout by default, so one automation's branch switch and leftover edits can no longer become the next automation's starting point; "Give it its own worktree" moves an automation onto a worktree and branch of its own in one click. A worktree that has drifted onto another branch, still holds an earlier run's changes, or was quarantined by a crashed run is refused instead of inherited, and "Restore workspace" puts it back. An automation that reaches for GitHub is now checked against `gh auth status` before it is armed and again before it fires, rather than discovering a logged-out CLI four minutes into a run. The automation page shows the configured branch and the branch actually checked out side by side, so a workspace that moved is visible before you enable anything. Overlapping scheduled and webhook fires now wait their turn and re-check the destination workspace before starting, rather than colliding with one another. If a run is cancelled or the app restarts, its workspace stays reserved and, when needed, quarantined until the run and its checks have truly stopped. Scheduled and webhook automations must have verification enabled and at least one check configured before they can run unattended. Each managed worktree can belong to only one enabled unattended automation, so two schedules cannot quietly contend for the same workspace.
- You no longer decide when Open Run releases, or what the next version is. Merged pull request titles are the release metadata: `feat` makes a minor, `fix` and `perf` make a patch, and a week of only docs and chores makes no release at all rather than a meaningless patch. On the configured cadence — weekly on Monday by default, set in `release` in `package.json` — a release pull request opens by itself with the version bumped, `changelog.d/` folded into `CHANGELOG.md`, and the notes written; merging it tags the commit and publishes the GitHub Release.

  You also no longer find out at review time that a pull request title was not a conventional commit, or that a user-facing change shipped with no changelog entry. Both are checks now, and both run the same rules `pnpm ship` runs before it pushes. `pnpm release:plan` prints what the next release would be without writing anything.
- A new automation no longer defaults to the checkout your editor has open. The project picker now reaches for a ready worktree under `~/.openrun` first and only falls back to the main checkout when the project has no worktree yet — and says so on the form when it does, so an unattended run never lands in your open files without warning you.
- You no longer start from a blank prompt. Finishing a connection now offers named starting points — implement flagged tickets, start work when something moves to In Progress, triage new tickets, do what a comment asks — and each one fills the trigger, the prompt, and the name. They are templates, not black boxes: everything stays editable, and the form says so once you change it. - The default is opt-in per ticket. Add the `agent` label to a ticket and the agent picks it up; nothing else fires. A connection made in thirty seconds can no longer start a run for every issue a busy project files. - A ticket that arrives already labelled is no longer ignored. Labelling as you file is the ordinary way to use a label, and it produces a create rather than an update — so the label trigger now covers both, on every provider. - Recipes a provider cannot honour are not offered. Bitbucket sends no labels, so it has no label recipe; Linear and Azure DevOps do not send comment text, so they have no comment recipe instead of one that would hand the agent a blank instruction.
- You no longer pause or arm an automation from the list. Status stays in the first column; Active / Inactive lives on the automation detail page.
- You no longer get a failed or still-creating workspace in the branch picker when another usable workspace already tracks the same branch.
- You no longer delete automations one row at a time: the Automations list has selection checkboxes and a **Delete selected** button, the same as Runs. Removing a batch stops their schedules and cancels any run already in flight.

  The checkboxes on both lists are smaller, so they sit inside the row instead of crowding the status column.
- You no longer hunt a per-file row in the run transcript to inspect what the agent changed. Each edit lands in the response as a Cursor-style change card (icon, filename, +/−, hunk) with **Undo** to restore that file. After Undo the card fades and **Redo** puts the change back. The composer files card stays collapsed until you open it and sits on the input like a tab. **Review** — or the filename on a change block — opens a fullscreen diff, where **Undo** on a hunk reverses just that patch the way `git apply -R` does.
- You no longer read backtick spans in a chat reply as the same colour as the prose around them — inline `<code>` is a muted docs tint, not a mini fenced block.
- Chat no longer paints every tool call the same gray wrench. MCP calls, skill invocations, and sub-agent spawns each get their own transcript chrome (eyebrow, icon, accent) so you can tell a `mcp__…` call or a Task spawn from a Bash at a glance — including on older turns that never stored a role (the UI classifies from the tool name on read). - Fine-tuning chat event styling no longer means hunting through a 1 300-line Chat.tsx. Each event type lives under `components/chat/` and is driven by `--chat-event-*` CSS variables / `.chat-event--mcp|skill|subagent|…` rules in `styles.css`, so accents, gaps, and radii can be tuned without touching the React.
- The Runs list no longer reports a Duration for chat runs. A conversation stays open between turns, so that number counted the time you spent reading and typing as if it were runtime; chat rows now show a dash, and Duration means what it says for scheduled, manual and webhook runs.
- The run transcript no longer has to look like a chat app. A theme picker in the run top bar switches it between **Open Run** (bubbles, icons, folded work) and **Terminal** — monospace throughout, the user's prompt as a full-width `>` line instead of a bubble, `●` and `⎿` markers in place of icons and cards, shell output printed inline the way `claude` and `codex exec` print it, and a finished turn replayed in full rather than hidden behind "Worked for 15s". The choice is remembered per browser and applied before first paint. - Command output in the Terminal theme is no longer flat grey. Colors a tool printed itself are honoured instead of being swallowed (or leaking escape codes into the transcript), and output captured without a TTY — the usual case — is painted anyway: failures red, warnings yellow, passes green, diff sides green and red, and file paths and URLs picked out of ordinary lines. The Open Run theme prints output unpainted as before. - The transcript switcher is a Debug button in the run top bar rather than a theme menu: on for the terminal transcript, off for the ordinary chat UI. - Terminal output is painted from a purpose-built 16-slot ANSI palette instead of borrowed accent colors. Every regular slot sits at one perceptual lightness so no hue shouts over its neighbours, each clears 7:1 against the transcript background, and the bright slots are the same hue lifted — so a program that colors its own output looks the way it does in your terminal. - Output in the debug view is no longer one flat grey when a tool prints no colors of its own — which is most of the time, since a CLI captured without a terminal attached drops them. Strings, numbers, keys, flags, paths, URLs, booleans and JSON keys are picked out of plain text, on top of the existing error / warning / pass / diff line colors. - The debug view carries a palette picker: Open Run's own AAA-contrast scheme plus Nord, Dracula, Catppuccin Mocha, Gruvbox Dark, One Dark, Tokyo Night and Solarized Dark, each painted on the background its author drew it against.
- --- title: Agent replies render as real markdown, edits as real diffs status: done area: ui ---

  An agent's reply no longer loses half its formatting on the way to the screen. The transcript renders GitHub-flavoured markdown — tables, ordered and nested lists, task lists, links, footnotes — instead of the handful of shapes the old in-house parser recognised, and a reply that arrived only as the turn's final result is no longer swallowed when the turn also made tool calls.

  - **Fenced code is highlighted** by the same highlighter the Files changed panel uses, with the language or filename in the header, plus copy and wrap. - **Edits show a diff**, not two stacked blobs: `Edit` and `Write` calls render `+`/`−` rows with line numbers, syntax colors and elided unchanged runs — the same rows the git panel draws. - **A file path in a reply is clickable.** Inline code like `src/lib/diff.ts:42` opens that file in the right panel. - **Sub-agents get their own card** — the agent's name, what it was asked to do, a live status dot, and its report expanded as prose rather than as a wall of tool output. - **The waiting state says what it is waiting for**: "Working for 1m 05s · Running pnpm test" instead of three dots and nothing else.
- Verification checks no longer hijack a conversation. Sending a message on a run detail page used to kick off the project's full check pass — `pnpm typecheck`, `pnpm test`, the lot — with the run held `running` and the workspace locked until it finished, before you could type again. Checks now run on unattended turns only: the automation's own turn and its repair turns. Chat, Planner and any follow-up you type finish the moment the agent does. - Checks themselves are leaner. The per-check **Blocking** toggle is gone — every check gates, and an advisory check that changed nothing was never worth configuring — as is the per-check **Timeout** field, replaced by one 10-minute budget. `build` is no longer suggested from `package.json`; it is slow and typecheck already covers what it would catch.
- You no longer have to scan healthy per-CLI status badges or redundant plugin metadata to manage MCP servers.
- fatal: path 'changelog.d/cleanup-duplication-and-drift.md' exists on disk, but not in 'stash@{0}'
- You can sign in from the local GUI and connect Jira in the browser. Jira webhooks hit the control plane and are pushed to this machine over an outbound socket — no tunnel, no API token paste. Local install (email + token, or `gh`) still works without an account.
- Signing out no longer leaves this installation permanently claimed by the previous Open Run account. The device is revoked remotely when possible and gets a fresh local identity, so you can immediately sign in with another account even if the control plane was temporarily unreachable.
- The Codex model picker no longer lags behind your account. Open Run reads the model list Codex itself caches, so GPT-5.6 Sol, Terra and Luna — and their Max and Ultra reasoning levels — show up without waiting for a release here.
- Codex full-access runs no longer die on `error: unexpected argument '--full-auto' found`. Recent `codex exec` dropped that flag, so Open Run passes `--yolo` instead — and clears a stale `--full-auto` out of saved runtime args.
- You no longer have to save a screenshot somewhere the agent can reach and type the path yourself: drag an image onto the composer, paste it from the clipboard, or pick it with the new attach button. Images are written into the workspace under `.openrun/attachments/` (added to `.git/info/exclude`, so they never show up as changed files) and the prompt the agent receives references them by path, which every runtime can read. Thumbnails stay in the composer until you send, and in the transcript afterwards.
- Connecting an integration no longer asks you for anything. Jira, GitHub, GitLab, Bitbucket, Linear and Azure DevOps all connect the same way: click Connect, approve at the vendor, come back. No API token, no site URL, no signing secret, no public base URL, and no tunnel — the control plane owns the webhook and this machine receives events over the outbound connection it already holds. Hosting the webhook yourself is still there, folded behind "Set up a webhook yourself instead" on the providers that support it. - Clicking Connect for a provider your control plane has no OAuth app for no longer dumps you on a raw JSON error page with no way back. The app asks the control plane which providers it can actually connect and says so in place; anything that goes wrong on the way out now returns you to the app with the reason. - Connecting while signed out no longer means reading a paragraph about the sidebar. "Sign in and connect" does both, and lands you back on the same provider with the connect already running. - A finished connection no longer sits there doing nothing. Connecting drops you straight into Finish setup — workspace, runtime, events and prompt, all pre-filled — so the last click leaves you with an automation that runs the next time someone touches an issue, instead of a row you have to go wire up yourself.
- A tool Open Run has never heard of no longer renders as a raw JSON dump. Custom and MCP tool calls get a readable name (`create_issue` reads as "Create issue"), their arguments as labelled rows instead of a blob, and a JSON result pretty-printed rather than run together on one line.
- You no longer need a real history to screenshot the product — `pnpm dev -- --demo` overlays sample lists and a Vue waitlist run (MCP, web fetch, three `.vue` edits) without writing the database.
- You no longer have to trust that "loopback only" is enough — a web page you merely visit can point its own domain at `127.0.0.1` and then talk to Open Run as if it were same-origin, so Open Run now refuses any request that addresses it by a name which is not a loopback name. Signed webhook endpoints are exempt, and a tunnel or reverse-proxy hostname goes in `AGENTOPS_ALLOWED_HOSTS`.
- Windows is no longer a required CI target. Ubuntu and macOS still run typecheck, tests, and the production build; Node 24 remains a Linux canary.
- You no longer have to open the browser after restarting Open Run before automations wake up. The scheduler starts with the server, validates expressions against the cron engine before saving, and records scheduled fires that start, queue, fail, or are missed.

  One-off schedules no longer roll forward to tomorrow when the machine misses their time. They keep an absolute timestamp, catch up within 15 minutes, then pause with a visible missed-fire reason. Editing an automation also preserves its one-off and native-session settings.
- You no longer wait for an unrelated run status change to see “N runs queued” on the Dashboard (or the Automations queue badge) — activity SSE invalidates those lists on `queue_changed` while the stream is healthy.
- You no longer have to start a run to find out what a runtime actually spawns — the Runtimes editor shows a live **Command preview** of the resolved argv (with the flags Open Run injects highlighted, and any template flag it took over called out), say how the prompt reaches the CLI, and let you copy the exact command. A template that would leave the agent with no prompt at all is now flagged before you save it instead of producing a silent no-op run.
- You no longer stare at a blank “Next run” dash on a broken automation — open the detail page and an invalid schedule is called out with a **Fix schedule** link that opens the editor on the bad expression.
- You no longer land on Claude by default when creating an automation or plan without a last-used runtime — Open Run picks an installed CLI so the first try works without hunting for a binary that isn't on PATH.
- You no longer need a second dropdown click after picking a project on the Planner — Open Run auto-selects a ready workspace (main checkout preferred), including when a worktree finishes setup and flips from creating to ready.
- You no longer click Enable on a broken automation only to get an alert — Automations list and detail disable Enable (Pause still works) when the schedule, workspace, or runtime CLI would be refused, with the reason on hover.
- You no longer click **Run now** only to get an alert when the workspace or CLI would refuse — the button stays disabled on the Automations list and detail page, and hover shows the same refuse reason the server would return.
- You no longer miss Claude Code / Codex when Open Run is started from Cursor or another GUI — common user install dirs (`~/.local/bin`, Homebrew, npm/pnpm, Windows `%USERPROFILE%\.local\bin`) are added to PATH automatically, and older databases that only had a partial builtin list get the full Claude / Codex / Grok / Gemini set back (Aider and the shell-echo demo are retired).
- You no longer land on Automations → New (or an empty Automations list) with no next step when Projects is empty — Open Run asks you to add a repository first so Create / Planner are not a dead end.
- You no longer arm a schedule against a missing agent CLI — Enable / save-as-Active refuse with the same “not found on PATH” error as Run now, lists flag “CLI not on PATH”, and Next run says it won’t fire until the binary is installed.
- You no longer wonder why Commit or Discard is greyed out on a clean working tree — both controls show the refuse reason on hover (sidebar and git menu), matching Push / Create pull request.
- You no longer open Create pull request (or wonder why Push is greyed out) when the workspace has no `origin` or `gh` is missing / not logged in — both controls stay disabled with the refuse reason on hover (sidebar and git menu), and the server refuses missing `origin` before calling `gh`.
- You no longer watch a Grok run dump every `streaming-json` line into chat as raw JSON — `text` deltas coalesce into assistant prose, `tool_call` / `tool_call_update` become paired tool rows, and thought / usage / available commands stay in the process log only.
- You no longer click Run now or Enable on a legacy blank-prompt automation only to spawn a silent no-op — both stay disabled with the refuse reason on hover, lists flag “no prompt”, Next run says it won’t fire, and the scheduler skips arming until Agent Instructions has text.
- You no longer lose spaces (or see the row flicker) while typing the first message in New chat — the modal is no longer nested inside the workspace row’s keyboard handler, which was swallowing Space/Enter.
- You no longer stare at a bare run id on Notifications → Deliveries — each row links into Run History, names the notifier that fired, and the section stays visible with an empty state when nothing has been delivered yet.
- You no longer see Planner (or other `--output-format plain`) Grok answers shattered into one grey chat pill per JSON line — plain stdout stays one assistant answer, and existing raw-only dumps fall back to the stored content.
- You no longer dump planner JSON as a dead wall of text — each proposed automation can be saved & activated (or ignored) from the Planner page and from the planner run’s chat, using the project/workspace you already picked when generating the plan.
- You no longer get sent to a **Projects page** that isn’t there. Workspace not-ready refuse copy (Enable / Run now hover, picker warnings, server errors) points at **Projects** — the modal on the project picker — and the quick start matches Automations-as-home instead of a removed Dashboard.
- You no longer promote a finished race attempt while its siblings are still running — **Keep this one** stays disabled with the settle reason on hover, and the server refuses the same way, so losing worktrees are not left orphaned.
- You no longer see a Command preview block on Create / Edit automation or on the run follow-up composer — those surfaces stay lean; argv inspection lives on Runtimes.
- You no longer create an automation with a blank prompt — Create / Save stay disabled until Agent Instructions has text (hover shows why), and the server refuses empty or whitespace-only prompts the same way.
- You can no longer save, enable, or run an automation without a workspace — Create requires a repository, and legacy empty-workspace rows are flagged on the Automations list instead of silently spawning inside the Open Run app tree.
- You no longer see retired runtime presets in the picker — the builtin list is Claude, Codex, Grok, and Gemini only, and automations that still pointed at a retired id move to Claude Code.
- You no longer decode opaque runtime ids on Dashboard Recent or Run History — both lists show the same display label Upcoming and Automations already use.
- You no longer leave agent CLIs (claude / codex / grok / gemini) burning tokens after a server restart, Vite HMR reload, or Ctrl+C — Cancel always kills by process id when the in-memory handle is gone, boot reaps orphan `running` rows, Disable stops in-flight agents for that automation, and shutdown hooks tear down every live CLI before the process exits.
- You no longer discover a bad runtime args template at spawn time — non-array / non-string JSON is rejected when you save on Runtimes, and existing bad rows are flagged on the list instead of crashing the preview.
- You no longer get an orphan failed run with `spawn ENOENT` when a runtime CLI is missing — **Run now**, follow-ups, and scheduled starts refuse immediately with a clear “not found on PATH” error (and the automation form warns when the selected runtime isn’t installed).
- You no longer mistake a verified webhook that matched zero automations for a successful fire — Integrations → Recent deliveries shows **matched nothing** (and links into Run History when runs did start) instead of a bare `ok`.
- You no longer save, enable, or run an automation against a worktree that is still creating or failed setup — Open Run refuses until the workspace is ready (same gate chat already used), and lists flag non-ready workspaces.
- --- title: Brand icons for changed files status: done area: ui ---

  Changed files no longer wear a two-letter monospace badge that read `VUE`, `TS` or `···` and told you less than the extension already did. Every file row — "Files changed", the workspace file tree, the diff card header — now shows the real logo for its type via [Simple Icons](https://simpleicons.org): Vue, React, Angular, TypeScript, JavaScript, PHP, Python, Go, Rust, Ruby, Java, Kotlin, Swift, Svelte, Astro, Next, Nuxt, Tailwind, Docker, Terraform, Prisma, GraphQL and the rest of the common set, with Lucide glyphs for the formats that have no logo (JSON, YAML, SQL, shell, text, images, lockfiles).

  - Deleted files are struck through instead of only being tinted red, so the status is still legible now that the icon carries the brand's own colour. - Near-black logos (Next.js, Prisma) fall back to the foreground colour rather than disappearing into the dark chrome.
- --- title: Finished turns fold their tool calls behind "Worked for 15s" status: done area: ui ---

  You no longer have to scroll past forty tool rows to read what the agent actually said. A finished turn collapses its tool calls, thoughts and interim commentary behind a single **Worked for 15s** row — expand it to replay the whole turn.

  - While a turn is still running, long stretches of tool calls keep only the recent five, with a **+N previous tool calls** toggle for the rest. - Shell tool calls carry a terminal icon rather than a file glyph, and an expanded row's output hangs off a guide line instead of floating in the transcript.
- A brand-new install no longer dies on first boot. The migration that adds the webhook-source columns ran before the queue table it adds them to existed, so a machine with no `data/openrun.db` yet failed with `no such table: run_queue`.
- You no longer have to add fx by hand. It ships as a builtin runtime over the Agent Client Protocol (`fx acp`), so follow-up turns, tool statuses, and Supervised approvals work the same way they do for other ACP agents. The model picker reads `fx models --json` from your installed binary, and a selected model is passed as `fx acp --model` so it applies even when a session is resumed.
- Signing in no longer forces you to invent another password: "Continue with GitHub" sits above the email form on both the sign-in and the sign-up screen, and it carries the device-approval flow through to the end, so linking a machine is one GitHub click. Email and password still work exactly as before, and the GitHub button only appears when the control plane is configured for it. - Open Run no longer points at the old `getopenrun.dev` host. The control plane lives at `https://openrun.sh`, which is the baked-in default — nothing to configure, and `AGENTOPS_CLOUD_URL` still overrides it for a local or self-hosted plane.
- Grok no longer ignores an OAuth token Open Run just wrote. HTTP headers fan out as Grok's `headers` key rather than Codex's `http_headers`, which Grok treats as unknown and then fails the handshake with "authentication is required".
- You can hide runtimes from the picker the same way you already hide models — hover a row and click the eye. Hidden runtimes stay off New run, new automations, and the other composer pickers until you unhide them. A run or automation already using a hidden runtime still shows it.
- Switching git worktree or clone no longer starts you from an empty app. Runs, automations, and projects live in `~/.openrun` with the rest of Open Run's machine state, so every checkout on the same account sees the same local data. A leftover `data/openrun.db` in a repo is moved there on first boot.
- Connecting an integration no longer means finding an API token first. Sign in, click Connect, approve in the browser — GitHub, GitLab, Bitbucket, Jira, Linear, and Azure DevOps all install this way, with the vendor tokens staying on the control plane and events arriving over the machine's own outbound connection. No tunnel, no signing secret to copy, no public URL. - GitLab, Bitbucket, and Azure DevOps are no longer missing entirely: they have catalog entries, so their issue and work-item events can be bound to an automation like any other provider. - You no longer have to leave a hosted webhook behind. Deleting a hosted connection removes it at the provider first, and a connection whose webhook failed to register or renew now says so on the provider page instead of going quiet. - Returning from a hosted connect no longer lands on "Nothing to complete." The callback carries the provider it finished, checks it against the connect this machine actually started, and files the connection under that provider.
- You no longer scan a wall of install tiles and connection dumps to find GitHub, Jira, or Linear — Integrations is a card grid with a brand mark, a category pill, an on/off switch, and Configure / Learn more, using the same surface and text tokens as the rest of the shell so it stays readable in dark and light.
- You no longer install GitHub, Jira, or Linear in a panel under the Integrations card grid — each provider has its own page with the same setup layout (install form, connection details, and recent deliveries).
- You no longer have to run a tunnel, paste an API token, or copy a signing secret to connect an integration: every provider now connects through openrun.sh in the browser, and events arrive over the machine's outbound relay. The self-managed webhook path — the local endpoint, the "register the hook for me" credentials, and the rotate-secret button — is gone, along with the inbound `/api/webhooks/:id` route it needed.
- You no longer have to get Disconnect exactly right before connecting Jira again. Reconnect retires the old site-wide hook (including connections made before the project picker existed), and Disconnect still drops the local row even when Atlassian refuses to delete the leftover webhook — it tells you so you can tidy that by hand.
- Jira Connect now asks which project (or whole site) to watch, the same way GitLab and Azure DevOps do. Creating a ticket against that project starts a run when the automation is bound to that event — including "all events". The default recipe still only fires on tickets labelled `agent`.
- You no longer need a project, an automation, or a filled-in event list to connect GitHub, Jira, or Linear — Install on each provider page creates an endpoint immediately (and registers the remote webhook when you have a public URL and credentials).
- An empty database can no longer hide your real one. The move from `agentops.db` to `openrun.db` shipped a read-only fallback — use the old file if the new one is absent — which turned out to be a one-way trap: anything that created an empty `openrun.db`, such as a boot killed partway through setup, permanently shadowed a database full of projects and runs and the app came up looking factory-reset. Open Run now *moves* the old file into place on first boot instead of reading past it, parks an abandoned stub as `openrun.db.abandoned-<timestamp>` rather than trusting it, and gives `~/.agentops` → `~/.openrun` the same treatment so your sign-in survives the rename too.
- You no longer wade through page blurbs, pill badges, and duplicate breadcrumbs — the shell is denser Linear-style chrome: Geist type, rich black surfaces, quiet dot status labels, and headers that stay out of the way.
- You no longer have to guess this project's house style before opening a pull request — `pnpm lint` (Biome) checks formatting and lint in one pass, `pnpm lint:fix` applies it, and CI runs the same command. Buttons that sat inside the automation form without an explicit `type` no longer submit that form when you click them.
- You can tick a run or automation again without the page crashing: selection reads the checkbox before React clears the click event.
- You no longer have to guess how full the agent's context is. The run view now shows a live gauge in its top bar — context size, the share served from cache, and how close the window is to full — fed by whatever the CLI streams about itself (Claude's per-message `usage`, Codex's `token_count`, Grok's `usage` envelope, and `usage_update` from any ACP agent). A runtime that reports no counts shows nothing rather than a zero pretending to be a measurement.
- The model picker no longer lags behind your CLI. Open Run reads the models your *installed* `claude`, `grok` and `agy` actually offer and caches them, so a CLI update puts the new model in the composer on the next page load — no waiting for an Open Run release, and nothing to configure. The list you get is the CLI's own: its display names, its default model preselected, and only the effort levels each model really accepts. - Choosing a model no longer costs you a spinner. Discovery runs in the background against a fingerprint of the binary, so the composer reads a cached row and renders immediately; a fresh clone shows a built-in list at once and the real one moments later. - Effort levels are no longer offered where the CLI would reject them. Haiku, which takes no `--effort`, stops pretending to. - Antigravity (`agy`) is no longer invisible. It ships as a runtime preset with its own models, tool calls, access modes and follow-up turns, alongside Claude Code, Codex, Grok and Gemini. - The model dropdown is no longer a list you have to re-skim past models you stopped using. Hover any model and hide it; the picker keeps a "N hidden" footer to bring them back. Hiding is display-only and never traps you — the model a run is already on stays visible, and hiding everything falls back to the full list.
- You no longer have to infer a running turn's history from its latest step. A scrollable live activity box keeps completed thoughts and tool calls visible while the current action continues.
- Leaving the app idle no longer leaves it stuck. A live stream that dies quietly — laptop asleep, Wi-Fi switched, dev server restarted — used to stay `OPEN` as far as the browser was concerned, so no error ever fired, polling stayed switched off, and pages you moved to showed stale data forever. The browser now judges liveness by the server's heartbeat rather than by the socket: a stream that goes quiet is torn down and redialled, reconnects immediately when the tab becomes visible or the network returns, and refetches what it missed while it was down. - The cloud relay no longer wedges after a sleep. A dial that neither connected nor failed used to leave it "connecting" forever, and nothing retried; every attempt now has a deadline. - Dev builds carry a live-connection indicator in the bottom-left corner. Toggle it to see every open stream, how long since its last frame, how many times it has reconnected, and the cloud relay's state — plus a button to redial the lot. It is compiled out of production builds.
- You no longer get the files panel shoved open when you start a run yourself. It still opens on first view when the run came in from an integration.
- You no longer have to leave Open Run to finish an MCP install, and you no longer sign in once per CLI. Registry entries whose endpoint is OAuth-gated (Linear, Notion, Sentry, Stripe) are marked "Signs in on first use" and, once added, send you to the vendor's authorize page. Open Run registers itself as a client, keeps the token, writes it into every CLI config as an Authorization header, and refreshes it so scheduled runs and your own `claude` sessions stay live. A handwritten Authorization header is left alone. Connect is a full-page redirect — nothing to paste, no popup. - Adding a server now tells you to restart any CLI session already open, since each CLI reads its own config at startup.
- Giving an agent an MCP server no longer means leaving Open Run for a text editor. A new **MCP servers** page reads and writes the CLI's *own* config — `~/.claude.json`, a workspace `.mcp.json`, `~/.codex/config.toml`, `~/.gemini/settings.json` — so a server you add here is the same one your hand-run `claude` session sees, and one you already had shows up already filled in. A `.mcp.json` server is marked approved for that workspace too, so an unattended run can actually use it instead of silently skipping it. - ACP runtimes no longer start every session with an empty server list. Open Run passes its own list in `session/new` / `session/load`, which is how an agent with no config file of its own (fx) can be given MCP servers at all. - Grok is no longer missing from the page. `~/.grok/config.toml` and a workspace `.grok/config.toml` are read and written like the rest, with the `enabled` key Grok expects, and saving a workspace server records the folder in `~/.grok/trusted_folders.toml` — without that Grok silently declines to start a repo-local server. - An MCP server no longer has to be added once per CLI. **Shared servers** are defined once in Open Run and written into every CLI's machine-wide config — `~/.claude.json`, `~/.codex/config.toml`, `~/.grok/config.toml`, `~/.gemini/settings.json` — so a run picks the server up whichever runtime it uses, and an ACP agent is handed the same list over the protocol. Open Run records the copies it made: removing a shared server takes back only those, and a name a CLI already had from somewhere else is reported as a conflict rather than silently overwritten. - Servers you already had are no longer stranded in whichever CLI you added them to. Open Run reads every CLI config it knows and offers what it finds for import; taking one copies it into the shared list and out to the other CLIs, leaving the config it came from untouched. Where two CLIs hold the same name with different settings you pick which copy is right instead of Open Run guessing, and a server carrying a token says so before it is copied anywhere. - Fanning a server out no longer writes it somewhere it cannot work. Each host declares the transports it can dial — Codex has no SSE, Gemini reads `httpUrl` for streamable HTTP and a bare `url` as SSE — so an entry is either written in that host's own dialect or skipped with the reason. Gemini's streamable-HTTP servers were previously unreadable and are now imported correctly. - A CLI you have not installed is left alone rather than having a config invented for it, and the first time Open Run changes one of your config files it keeps a `.openrun-backup` copy beside it.
- You no longer risk a mobile API URL that merely *starts with* `/api/mobile/` walking onto desktop routes — `../` and `%2e%2e` are now resolved and refused.

  When mobile is on, Open Run accepts this machine’s LAN IPs as Host names, so pairing no longer needs `OPENRUN_ALLOWED_HOSTS` set to your phone’s view of your Mac.
- You no longer have to be sitting at your Mac to find out a supervised run is stuck on an approval prompt. Open Run now pairs with an iPhone app: scan a code from the new Devices page and the phone can watch runs live, answer allow/deny before the five-minute auto-deny fires, send a chat follow-up, cancel a run, and switch an automation on or off.

  Phone access is off until you start the server with `AGENTOPS_MOBILE=1`, and turning it on no longer means exposing the whole app — only the token-checked `/api/mobile/…` surface answers other devices, and a paired phone can never edit runtimes or settings, touch workspace files, or commit, push, or open a pull request.
- A chat you started in Claude Code itself is no longer a one-line "Resumed Claude chat" note. Picking it from the composer opens the whole conversation in Open Run — prompts, reasoning, tool calls and their results, token counts — rendered the same way a run Open Run executed itself is. - Opening one costs nothing. Adopting a chat imports its transcript and stops there, instead of firing a `continue` prompt at the model just to have something to show; the first turn Open Run runs is the message you type next. - Whether the history loads no longer depends on where the conversation goes next. Reading a saved chat is separate from resuming one, so the transcript is there whether you continue on the same CLI or hand the work to another runtime. Runtimes without a transcript reader (Codex, Grok, Antigravity) resume exactly as before.
- You no longer have to start a fresh conversation when the work already lives in a local Claude, Codex, Grok, or Antigravity chat. The new-automation form lists the recent native sessions for each installed CLI next to the project picker — five per binary, with load more for older ones — and the first turn resumes that chat instead of minting a new one. Native chats stay out of Runs until Open Run actually drives a turn. The workspace folder must be the same cwd the CLI used.
- You no longer have to sit up at 03:00 to type "continue" into a rate-limited Claude Code chat. An automation can resume a native Claude session from this workspace folder (not an Open Run run) and fire once at a wall-clock time, then pause. Native chats stay out of Runs until Open Run actually drives a turn. The workspace folder must be the same cwd Claude used.
- You no longer risk a saved Claude chat reading a transcript outside the selected project. Adoption rejects unsafe or redirected session files, bounds imported history, and orders imported messages deterministically even when the CLI history has missing, duplicate, or future timestamps. Codex discovery no longer follows symlinked folders, and capped imports keep complete turns while reporting omitted events.
- You no longer need to leave run detail to start again. **New chat** opens an empty composer with the same project, branch, runtime, model, effort, and access mode, while **Repeat run** immediately sends the first prompt again.

  The project picker's path display is now editable. Type or paste a folder path and press Enter to jump straight to it instead of expanding the tree one level at a time.
- You no longer paste webhook URLs and secrets into GitHub, Jira, or Linear by hand to get an automation running. **Install** on Integrations registers the provider webhook for you (GitHub via your local `gh` login; Jira/Linear with a one-shot API token that is never stored), creates a connection, and wires a ready automation with event filters and an `{{issue.*}}` prompt — no Open Run env vars to manage. Localhost still needs a tunnel URL once; we remember it.
- --- title: Open sourced under AGPLv3, with a hardened bind address status: done area: project ---

  You no longer have to guess whether you are allowed to use, modify or run Open Run in your company. It is licensed under **AGPLv3** — running it on your own machines, on private repositories, modified however you like, carries no obligation to publish anything. The copyleft attaches only if you distribute it or offer a modified version to others as a network service. `COMMERCIAL-LICENSE.md` covers the cases where AGPLv3 does not fit, and the README states the standing boundary: **everything that runs on your machine is open source and stays that way**, and a test fails the build if a local feature ever starts checking which edition is running.

  You no longer risk publishing arbitrary command execution by accident. Open Run runs agent CLIs with your credentials, so anyone who can reach its HTTP server can run commands as you — it now binds `127.0.0.1` only, and **refuses to start** on a public interface unless you set an access token (`pnpm token:print`) or explicitly override it. When a token is configured it is required on every server function and API route through one global middleware, so no endpoint can be forgotten; signed webhook endpoints stay reachable because they authenticate by HMAC instead. Webhook secrets in the local database, and the token file itself, are now written `0600` rather than inheriting your umask.

  You no longer get a silent no-op from `pnpm start`. It pointed at a build output this project never produces, so it exited without ever listening; it now serves the real build — streaming SSE responses rather than buffering them — after checking the bind address.

  Docs: [openrun.sh](https://openrun.sh) covers install, architecture, the security model, and how to add another agent CLI.
- The agent can now ask Open Run what it is doing. A built-in MCP server — one click to install from the MCP page — offers `run_context` (which automation started this run, which workspace and branch, which verification checks will judge it), `changed_files` (against the commit the run started from, not the last commit) and `recent_runs`. Read-only, and scoped to the run that spawned it.
- You no longer get stuck on the new-run page when another session is using the selected branch. You can now open an existing branch in its own worktree or create and select a new isolated workspace without leaving the page.
- The composer no longer locks you out while the agent works. Keep typing: each message joins the run's queue and becomes its own turn, in order, the moment the current one ends — the same way the CLIs Open Run drives have always let you type ahead. The queue stacks on top of the composer, so you can see what is waiting, drop one message, or clear the lot. - Waiting is no longer the only option. **Send now** interrupts the agent and hands it the queue immediately, and ⌘↵ does the same for the message you are typing. An interrupt taken for a queued message is not a Stop: no "run finished" notification, and the workspace stays reserved for the conversation instead of being handed to a scheduled run. - Stopping a turn no longer throws away what you queued behind it. The queue survives, paused, with its own Send and Clear — a stop stops the agent, not your typing.
- You no longer configure **Attempts** on an automation — racing a prompt across several agents, the compare screen and patch promotion are gone. Every trigger starts one run on the automation's own runtime, as it did before.
- The Checks panel no longer counts one failure twice. A verification pass is now identified by the turn it verified as well as the repair attempt, so two ordinary turns of the same run stop folding into a single pass and reporting the same red check once per turn.

  A stale pass no longer looks like the truth. When the newest results verified an earlier turn, the panel says so and offers **Re-run checks**, which runs the project's checks against the workspace as it stands now instead of leaving yesterday's verdict on screen.

  You no longer have to describe a failing check to the agent and hope it guesses the right command. **Fix checks** sends the recorded failure — command, exit code and captured output — as the next message, so the agent works from what actually failed rather than from a build it chose to run itself.
- You no longer have to create an automation to resume an existing CLI chat: the new-run composer can pick history from any runtime.
- Verification checks no longer sit on top of the changed-files list on a run. They have their own **Checks** tab next to Changed and Browse, badged with the number of failing checks, so the Changed tab shows only what the agent actually touched.
- A run whose working directory no longer exists now fails with what actually happened. Node reports a missing `cwd` from `spawn` as an ENOENT on the binary, so a deleted worktree used to surface as `spawn claude ENOENT` — reading as a missing CLI. Starting or resuming a run into a directory that is gone is refused up front, naming the path.
- The Runs list no longer shows only the automation name or a generic "Chat · branch" label. Each row uses the first prompt as the chat name, with a one-line summary underneath — the in-flight tool while it is running, or the files the agent edited once it is done.
- You no longer wait on a blank chat while git inspects the worktree, or for the server to echo a follow-up before your message appears. Hovering a run preloads the transcript so opening it paints immediately.
- The run page no longer leaves you guessing whether a run's work actually shipped: a pull request on the run's branch now shows above the composer with its state and check status, whether you opened it from the workspace panel or the agent opened it itself with `gh pr create`. An automation run no longer echoes back the settings you saved instead of the ones the CLI actually received — the transcript opens with a stub read off the argv, so a model or effort that silently failed to reach the binary is visible rather than assumed. A one-shot automation scheduled for 03:01 is no longer labelled "Daily at 03:01"; it says when it fires, once.
- You no longer see a pull request from whichever branch happens to be checked out after a run finishes: the run keeps its exact head branch, finds merged and closed pull requests, and tells you when GitHub could not answer instead of quietly claiming there was no pull request.
- You no longer see Success and Failed styled as different kinds of badge: status colour lives on the dot, and every label uses the same muted type.
- The run top bar no longer stacks token counts, a split New chat control, Cancel, Debug, and the panel toggle as competing chrome. Context is a quiet gauge (a percentage only when the window is filling up), New chat and Cancel are icon actions, and Debug, Repeat, and the terminal palette live in a ⋯ menu.
- You no longer have to delete runs one at a time: select finished runs from the history page and remove them together. Running runs stay protected until you cancel them first, and deletion permanently removes their conversation.
- You no longer find Claude Code missing from the model picker on an automation just because your database predates the other builtin runtimes. Runtimes had been listed by `createdAt`, so a database that seeded Gemini first and only backfilled Claude, Codex and Grok on a later boot floated Gemini to the top — and the default runtime, along with the model list in step 1, followed it. A fresh install ordered them correctly, which is why this only showed up on long-lived machines. Runtimes now sort by their preset order, so every install opens on the same first runtime and user-added runtimes still sort after the builtins.
- A chat is no longer stuck on the runtime it started with. The composer has a runtime picker: pick Codex halfway through a Claude chat and the next turn runs there, in the same workspace, on the same branch, with the same diffs — the new agent gets a summary of the conversation so far and carries on. A one-time note spells out what a handoff does and does not keep, with a "Don't show this again" for after the first time. - A runtime that cannot resume its own sessions no longer ends the conversation. A run on such a runtime can still be continued by handing it to one that can.
- You no longer lose MCP OAuth tokens, notification webhook URLs, or APNs tokens if someone copies `openrun.db`. Those values are sealed with a key that lives in `~/.openrun/data-key`, not in the database.
- You no longer have to scroll through every branch whenever you open a branch picker. The first five branches appear immediately, with more available in batches from a Load more button.
- You no longer land on a dashboard that only restates what the two lists already say. The app opens on Automations, and Runs sits next to it in the sidebar — those are the only two destinations. `/` redirects to `/tasks`.

  You no longer hunt for a Projects page to add a repository. Projects and worktrees are setup, not a daily screen, so they moved into a modal you open from the one place they matter: the project picker on an automation.

  You no longer read eight red chips to learn why an automation will not run. A blocked automation states the single blocking reason; a healthy one says when it runs next.

  You no longer have to hover a row to discover Run, Pause and Delete — the actions are always visible.

  You no longer scroll past Triggers, Tools and Verification to reach the Create button. The automation form puts Cancel/Create top right, asks what the agent should do before when it should run, and folds verification behind Settings. The dead "Run History" tab and the placeholder Memories / MCP rows are gone.
- The local app no longer uses a different mark than openrun.sh — the tab icon, sidebar, and welcome screen share the same Open Run favicon.
- Typing `/` in a composer no longer produces a prompt that starts with a stray slash. The commands your CLI already has on disk — `.claude/commands/`, `~/.codex/prompts/`, `.gemini/commands/` — are offered in a menu with their descriptions, in run chat, in the new-run composer, and in an automation's prompt. Open Run sends the command as typed; the agent expands it. - Chat also answers a few commands itself, which used to have no equivalent outside an interactive CLI: `/clear` starts a fresh chat, `/model`, `/effort` and `/mode` change the next turn's pickers, `/mcp` opens the MCP servers page, and `/help` lists what is available. They never reach the agent, and an automation's prompt does not offer them — an unattended run has nobody to answer them.
- A finished turn no longer shows a red error log for something that never failed. Recoverable CLI chatter — an MCP server you have not signed into, a websocket the CLI redials — is filtered out of the chat, and only real stderr still opens the process log. The raw run log keeps everything.
- Stopping a run from the composer no longer leaves the agent CLI running. Cancel used to drop the process handle before SIGKILL, so a CLI that ignored SIGTERM kept working and the transcript kept updating.
- You no longer have outline-only ticks on Runs and Automations lists; unchecked boxes stay empty, and a selected box fills with the modified color so the check reads as the surface behind it.
- You no longer see shared main checkouts or worktrees removed with Git in run and automation pickers. Git's worktree inventory now stays in sync with the UI, and branch actions explain when they create an isolated workspace.
- You no longer have to reconstruct why an automation will not fire from a pile of separate gates: the automation page lists every blocker in repair order, including a runtime that never delivers the prompt, a webhook connection that is gone, and a workspace that is still running or queued.
- You no longer see the same pulsing dots for every in-flight agent state. Chat maps the live turn onto thinking-orbs — searching, solving, composing, waiting, connecting, weaving, shaping — so a Claude thinking delta, a Codex reasoning item that has only started, a Grok thought chunk, and an ACP thought ping each render as thinking rather than generic busy. Empty and redacted thought chunks are kept instead of dropped.
- --- title: Tool calls as compact transcript rows status: done area: ui ---

  Tool calls in a run no longer read as a stack of `Bash · command` titles that expand into JSON. Each call is a compact row — **Ran**, **Read**, **Edited** — with the file's type icon or the command in mono, a quiet spinner while it runs, and an expand that shows the command output or the edit hunk instead of the raw payload.
- You no longer have to accept "fires on every transition" when what you meant was "when it moves to In Progress". Finish setup now asks when the automation should run in plain words — a new ticket, a status, a label, an assignee, a comment — and compiles that to the event *and* the filter behind it. Status, label and assignee filters existed in the matcher all along but were unreachable from the setup flow, so a status trigger could only ever be bound wide open. - The trigger no longer hides what it will actually match. The sentence it reads as is always shown, and one click expands it to the exact event ids and filters that get stored — so "why didn't my automation fire" is answerable before you create it rather than after a delivery quietly matches nothing. - Triggers a provider cannot honour are no longer offered. Bitbucket never sends labels, so it has no label trigger instead of one that silently never matches; where a provider has no dedicated label event, the trigger says out loud that it fires on any update while the label is present. - Connecting Jira now asks for write access up front. Nothing uses it yet — it is there so that when Open Run can comment on a ticket or move it to In Review, you are not sent back through the Atlassian consent screen to allow it.
- The answer no longer sits under a spinner for a few seconds after the agent has finished. A turn now announces itself as settled over the live stream the moment its message is final, so the transcript stops waiting on the run's own terminal status — which is still busy taking a diff, running verification checks, or queueing a repair turn.
- Undo All no longer leaves the agent's commits behind. When a run committed, the dialog now lists those commits and offers to move the branch back to where the run found it, so the files and `git log` stop disagreeing. It refuses once a commit has reached a remote — that would be rewriting published history — and the reset keeps changes you had in flight before the run, which a `git reset --hard` would have taken with it. Dropped commits stay in your reflog, and the dialog tells you which commit the branch went back to.
- You no longer have to open each CLI to find out what it has spent. A Usage page totals Claude, Codex, Grok, Gemini and Antigravity from their own on-disk history — tokens, cost where the model has a published price, the folders the tokens went to, and the limit windows a CLI reports about itself. Claude's real plan limits come from the account, so the 5-hour and weekly bars are the ones `/usage` shows rather than a guess from message timestamps.
- --- title: Verified runs — checks, verdicts, auto-repair and notifications status: done area: feature ---

  You no longer have to read a transcript to find out whether an unattended run actually worked. A project defines **checks** (`pnpm typecheck`, `pnpm test`, …) that run in the worktree after every agent turn, and each run gets a **verdict** — Verified, Checks failed, No changes, Unverified, Timed out or Crashed — instead of only "the CLI exited 0", which it does just as happily after writing code that does not compile or after doing nothing at all.

  - Checks are auto-suggested from `package.json` scripts when a repo is added. - A `failed-checks` run hands the failing output back to the same agent session as a repair turn, bounded per automation (hard cap 3). - Every run has a wall-clock budget; a wedged CLI used to hold the workspace lock until the app restarted. - **Notifications** (Discord / generic webhook / desktop) fire when a run settles — by default only when it needs attention. - Unattended fires (cron, webhook) that land on a busy workspace are **queued** instead of being dropped into a console log with no run row.
- You no longer land in a blank app with no idea that hosted integrations exist: the first run opens a welcome screen that offers to link this machine to an Open Run account, with "Continue without an account" underneath for anyone who would rather stay local. The choice is remembered, so it asks once. Skipping costs you nothing — every local feature keeps working, and the sidebar still offers Sign in later. - Signing in no longer sends your credentials anywhere they can be logged: the browser approves the device on an explicit screen that names it, the machine token is exchanged over a one-time PKCE code, and the relay WebSocket carries a 60-second single-use ticket instead of your access token. Tokens now expire and refresh on their own rather than living for a month. - A webhook that arrives while your machine is asleep is no longer silently dropped. The relay notices a dead connection instead of writing into it, queues the event for up to 24 hours, and delivers it the moment you come back.
- You no longer need a C++ toolchain to install on Windows. `pnpm install` uses the prebuilt better-sqlite3 binary that already ships in the package, so it no longer dies when node-gyp cannot detect Visual Studio 2026. `pnpm test` no longer shells out to `find`, so it runs on Windows cmd as well. A verification check that times out on Windows now kills the whole process tree, and spawning an agent with extra env (for example fx's `FX_MODEL`) no longer drops `PATH`.

### 🚀 Features

- **release:** automate the release pipeline ([#61](https://github.com/dennisadriaans/openrun/pull/61))
- keep app state in ~/.openrun ([#59](https://github.com/dennisadriaans/openrun/pull/59))
- **tasks:** select and bulk delete automations ([#42](https://github.com/dennisadriaans/openrun/pull/42))
- **runs:** add bulk deletion ([#34](https://github.com/dennisadriaans/openrun/pull/34))
- **chat:** open a native CLI chat with its transcript ([#28](https://github.com/dennisadriaans/openrun/pull/28))
- **tasks:** refuse unattended runs a workspace cannot support ([#29](https://github.com/dennisadriaans/openrun/pull/29))
- **tasks:** make scheduled fires durable
- **chat:** attach images to the composer
- **chat:** queue follow-ups typed while the agent works
- **runs:** mark runs unread until you open them
- **projects:** browse folders with places, hidden files, and history
- **workspace:** support isolated parallel runs
- **workspace:** paginate branch pickers
- **chat:** add terminal debug view and live activity
- **runs:** stream live context usage
- **runs:** start a new chat or repeat a run from run detail
- **runtimes:** discover codex models from its cache file
- **agents:** offer installed plugins from a $ mention menu
- **runtimes:** hand a chat to another runtime mid-conversation
- **git:** let Undo All drop the commits a run made
- **workspace:** default automations to a worktree
- **dev:** overlay demo data with pnpm dev -- --demo
- **runs:** open a run instantly with an optimistic send
- **runs:** show first prompt as chat title in Runs list
- **runs:** show the first turn while starting
- **chat:** fold in-flight tool work
- **mcp:** sign in once for oauth-gated servers
- **security:** seal sqlite secrets under data-key
- **runtimes:** keep a deleted builtin runtime deleted
- **runs:** paginate the runs list
- **tasks:** move active/inactive off the automations list
- **runs:** settle a turn on the live stream
- **app:** expose MCP, usage and slash commands through core
- **mcp:** manage every CLI's MCP servers from one page
- **usage:** total up what each CLI has spent
- **chat:** render custom and MCP tool calls readably
- **chat:** offer the CLI's slash commands in every composer
- **chat:** map the live turn onto thinking orbs
- **mcp:** let the agent ask Open Run about its own run
- **chat:** review edits inline with undo
- **runtimes:** hide runtimes from the pickers
- **ui:** add a shared hover tooltip
- **integrations:** drop the local webhook install path
- **tasks:** save a webhook trigger without saving the task
- **integrations:** jira connect stops at a project picker
- **integrations:** let an automation bind to every event
- **integrations:** badge the ticket a webhook run came from
- **live:** judge stream liveness by heartbeat, not the socket
- **integrations:** start an automation from a recipe
- **integrations:** trigger on a status, not every transition
- **runtimes:** add fx as an ACP builtin ([#12](https://github.com/dennisadriaans/openrun/pull/12))
- **integrations:** connect any provider without tokens
- **cloud:** connect any integration without pasting tokens
- **cloud:** onboard on first run and move to openrun.sh
- **chat:** render replies as markdown and fold finished turn work
- **tasks:** resume a native CLI chat and fire once
- **tasks:** pick a git branch in the automation form
- **runtimes:** drive the Antigravity CLI (agy)
- **models:** offer the models the installed CLI actually knows
- **security:** sign a browser in with the access token
- remove the Slack control surface
- **security:** refuse non-loopback Host headers

### 🩹 Fixes

- **security:** confine the mobile api path prefix
- **ui:** fill list checks and mute status labels ([#47](https://github.com/dennisadriaans/openrun/pull/47))
- **workspace:** derive branch choices from git ([#43](https://github.com/dennisadriaans/openrun/pull/43))
- **cloud:** release device on sign-out ([#46](https://github.com/dennisadriaans/openrun/pull/46))
- **tasks:** list unattended readiness blockers in repair order ([#36](https://github.com/dennisadriaans/openrun/pull/36))
- **runs:** probe pull requests by persisted head branch ([#35](https://github.com/dennisadriaans/openrun/pull/35))
- **security:** harden native transcript import ([#33](https://github.com/dennisadriaans/openrun/pull/33))
- **tasks:** close remaining unattended isolation races ([#32](https://github.com/dennisadriaans/openrun/pull/32))
- remove useless info line ([#21](https://github.com/dennisadriaans/openrun/pull/21))
- make windows CI tests pass ([#20](https://github.com/dennisadriaans/openrun/pull/20))
- report the branch a workspace HEAD points at ([#19](https://github.com/dennisadriaans/openrun/pull/19))
- keep client aborts out of the dev server log ([#18](https://github.com/dennisadriaans/openrun/pull/18))
- **ui:** render a not-found page for unknown routes ([#17](https://github.com/dennisadriaans/openrun/pull/17))
- restore typecheck and format on main ([#15](https://github.com/dennisadriaans/openrun/pull/15))
- **tasks:** arm schedules on server startup
- **tasks:** preserve automation edit settings
- **db:** unbreak schema template literal in migrations
- **ui:** suppress hydration warning on theme-stamped html
- **server:** answer client aborts with 499 instead of 500
- **workspace:** format picker changes
- **chat:** satisfy transcript lint
- **runs:** align telemetry types and formatting
- **cloud:** stop bouncing a freshly linked machine to /welcome
- **runtimes:** pass --yolo to codex exec instead of --full-auto
- only show installed runtimes
- **chrome:** match local app favicon to openrun.sh
- markdown color
- **runs:** kill the agent CLI when a run is stopped
- **db:** add run_queue columns after the table exists
- **ui:** keep github marks visible on dark chrome
- **runtimes:** never default into a prompt-injected effort
- **cloud:** disconnect drops the local row when the vendor refuses
- **db:** adopt the legacy database instead of reading past it
- **ci:** store CLA signatures in this repository
- **integrations:** drop stale three-provider copy
- **workspace:** keep the file tree expanded after closing a file
- **ui:** give every button an explicit type
- **build:** load core through a dynamic import in mobile handlers

### 💅 Refactors

- **chat:** quiet the run top bar behind a ⋯ menu
- **chat:** vendor thinking orb renderer
- **ui:** lay the automations list out as a table
- **tasks:** make the automation detail page always editable

### 📖 Documentation

- add concise pull request review skill ([#62](https://github.com/dennisadriaans/openrun/pull/62))
- keep agent rules in AGENTS.md only ([#40](https://github.com/dennisadriaans/openrun/pull/40))
- ship the readme screenshot with the repo
- update agent project map
- **chat:** note the inline code tint
- **agents:** require conventional commit messages

### 📦 Build

- **deps-dev:** Bump @types/better-sqlite3 from 7.6.13 to 9.6.0 ([#9](https://github.com/dennisadriaans/openrun/pull/9))
- **deps:** move pnpm overrides to the workspace root ([#16](https://github.com/dennisadriaans/openrun/pull/16))
- **lint:** cap comment blocks at three lines
- **deps:** Bump node-cron from 3.0.3 to 4.6.0
- **deps:** Bump the minor-and-patch group across 1 directory with 13 updates
- **deps:** Bump better-sqlite3 from 11.10.0 to 13.0.3
- **deps-dev:** Bump typescript from 6.0.3 to 7.0.2
- **deps-dev:** Bump @types/node from 22.20.1 to 26.2.0
- **deps:** Bump lucide-react from 0.469.0 to 1.31.0
- **deps:** Bump pnpm/action-setup from 4 to 6
- **deps:** Bump actions/checkout from 4 to 7
- **deps:** Bump actions/setup-node from 4 to 7
- pin the toolchain and widen CI coverage

### 🤖 CI

- override js-yaml and nanoid so prod audit is clean
- pin pnpm so GitHub Actions can install

### 🏡 Chore

- manage agent rules ([#39](https://github.com/dennisadriaans/openrun/pull/39))
- optimize readme
- **build:** use explicit .ts extensions in vite config
- normalize repository formatting
- **ui:** add favicon and apple touch icons
- **lint:** adopt Biome for lint and format

### Uncategorised

- Initial commit

## [Release 2026-07-23]

Live agent runs and safer scheduling. This release ships the structured-turn-events
foundation (`01`), the full live-update stack over SSE (`02`), and cron-schedule
validation for automations.

### Live runs & structured events (tickets `01`, `02`)

- You no longer need to dig through raw stdout to see what a Claude/Codex turn did — chat renders structured assistant, tool, and error events while the activity log still keeps the unmodified stream. (Remaining for `01`: end-to-end verification against live `claude`/`codex` CLIs on a developer machine.)
- You no longer wait on a 1s poll tick to see an active run move — open `/runs/$runId` and chat/log updates arrive over SSE, with the old poll kept as a fallback if the stream drops. (Slice of `02`.)
- You no longer wait on a 3–4s poll tick to see Dashboard / Run History flip when a run starts or finishes — an app-wide activity SSE drives those lists, and the old timers only resume if the stream drops. (Slice of `02`.)
- You no longer pay a full conversation refetch on every SSE log/tool frame — open `/runs/$runId` and stdout plus structured turn events patch the React Query cache in place; only turn boundaries and final status still invalidate. (Slice of `02`.)
- Remaining for `02`: none — the active-run 10s safety-net poll is retired while
  the SSE stream is healthy (unhealthy-stream fallback poll remains).

### Automations DX

- You no longer need to discover a typo’d cron the hard way — invalid schedules are rejected when you add a trigger or save/enable an automation, instead of saving as enabled and never firing. Existing invalid expressions are flagged on the Automations list.

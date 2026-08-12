# Changelog

All notable changes to Open Run are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

- You no longer miss Claude Code / Codex when Open Run is started from Cursor or
  another GUI — common user install dirs (`~/.local/bin`, Homebrew, npm/pnpm,
  Windows `%USERPROFILE%\.local\bin`) are added to PATH automatically, and older
  databases that only had a partial builtin list get the full Claude / Codex /
  Grok / Gemini set back (Aider and the shell-echo demo are retired).
- You no longer hit Enable/Run now/form/queue/Next-run with four slightly different
  copies of the same refuse logic — workspace / PATH / prompt share
  `lib/runPrereqGate.ts`, the queue skips empty-prompt entries the scheduler would
  refuse, and Next run names a missing or not-ready workspace instead of a blank
  dash.
- You no longer watch a Supervised Claude run stall until the five-minute
  auto-deny — Allow / Deny on each pending approval request answers the live
  session from chat.
- You no longer pay a 10s HTTP poll on a healthy run SSE stream — active-run and
  conversation queries stay quiet while the EventSource is up and only resume the
  old cadence if it drops.
- You no longer land on Planner with no projects and a form that cannot save —
  Planner uses the same empty-projects gate as Automations.
- You no longer click Run now or Enable on a legacy blank-prompt automation only
  to spawn a silent no-op — both stay disabled with the refuse reason on hover,
  lists flag “no prompt”, Next run says it won’t fire, and the scheduler skips
  arming until Agent Instructions has text.
- You no longer have to read a transcript to know whether an unattended run
  worked — projects define **checks** that run in the worktree after every turn,
  and each run gets a **verdict** (Verified / Checks failed / No changes /
  Unverified / Timed out / Crashed) instead of just an exit code.
- You no longer babysit a red run — a failed-checks run hands the failing output
  back to the same agent session as a bounded repair turn.
- You no longer lose a workspace to a wedged CLI — every run has a wall-clock
  budget and is stopped when it elapses.
- You no longer find out about a broken 6am run by opening the app — Slack /
  Discord / webhook / desktop notifiers fire when a run settles, by default only
  when it needs attention.
- You no longer silently lose a cron tick that lands while the previous run is
  still working — unattended fires queue for the workspace instead of throwing
  into a console log with no run row.
- You no longer get a fresh install with no demo runtime — the Aider/Gemini rows
  were being inserted before `seedRuntimes`, whose empty-table guard then skipped
  Claude, Codex, Grok and Demo entirely.
- You no longer create an automation with a blank prompt — Create / Save stay
  disabled until Agent Instructions has text (hover shows why), and the server
  refuses empty or whitespace-only prompts the same way.
- You no longer have to start a run to find out what a runtime actually spawns —
  the Runtimes editor shows a live **Command preview** of the resolved argv
  (with the flags Open Run injects highlighted, and any template flag it took
  over called out), say how the prompt reaches the CLI, and let you copy the
  exact command. A template that would leave the agent with no prompt at all is
  now flagged before you save it instead of producing a silent no-op run.
- You no longer see a Command preview block on Create / Edit automation or on
  the run follow-up composer — those surfaces stay lean; argv inspection lives
  on Runtimes.
- You no longer open Create pull request (or wonder why Push is greyed out)
  when the workspace has no `origin` or `gh` is missing / not logged in — both
  controls stay disabled with the refuse reason on hover (sidebar and git menu),
  and the server refuses missing `origin` before calling `gh`.
- You no longer need a second dropdown click after picking a project on the
  Planner — Open Run auto-selects a ready workspace (main checkout preferred),
  including when a worktree finishes setup and flips from creating to ready.
- You no longer click Enable on a broken automation only to get an alert —
  Automations list and detail disable Enable (Pause still works) when the
  schedule, workspace, or runtime CLI would be refused, with the reason on hover.
- You no longer click **Run now** only to get an alert when the workspace or CLI
  would refuse — the button stays disabled on the Automations list and detail
  page, and hover shows the same refuse reason the server would return.
- You no longer arm a schedule against a missing agent CLI — Enable / save-as-Active
  refuse with the same “not found on PATH” error as Run now, lists flag
  “CLI not on PATH”, and Next run says it won’t fire until the binary is installed.
- You no longer save, enable, or run an automation against a worktree that is
  still creating or failed setup — Open Run refuses until the workspace is
  ready (same gate chat already used), and lists flag non-ready workspaces.
- You no longer land on Automations → New (or an empty Automations list) with no
  next step when Projects is empty — Open Run asks you to add a repository first
  so Create / Planner are not a dead end.
- You no longer stare at a blank “Next run” dash on a broken automation — open the detail page and an invalid schedule is called out with a **Fix schedule** link that opens the editor on the bad expression.
- You no longer land on Claude by default when creating an automation or plan without a last-used runtime — Open Run picks an installed CLI (often Demo) so the first try works without installing an agent.
- You no longer get an orphan failed run with `spawn ENOENT` when a runtime CLI is missing — **Run now**, follow-ups, and scheduled starts refuse immediately with a clear “not found on PATH” error (and the automation form warns when the selected runtime isn’t installed).

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

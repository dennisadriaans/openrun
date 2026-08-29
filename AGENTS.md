# Open Run — project map for coding agents

Read this first. It exists so you can skip a whole-codebase sweep and open only the two or
three files your prompt actually needs.

## What this is

A **TanStack Start** proof-of-concept that plans and schedules **local coding-agent CLIs**
(`claude`, `codex`, `grok`, `gemini`, `agy`, `fx`) as child
processes. No model APIs, no cloud, no keys — it drives the CLIs the user is already logged into.

Each runtime has a **transport**: `cli` parses the binary's own JSON output, `acp` drives it
over the [Agent Client Protocol](https://agentclientprotocol.com). Either way what lands in
the DB is the same ACP-shaped event vocabulary (`lib/acp.ts`) — tool calls with a title, kind,
status and file locations; approvals as an options list with an outcome.

A **run is a conversation, not a one-shot log**: the first turn is the automation's prompt,
follow-up turns resume the same agent session (`claude --resume`, `codex exec resume`). Each
turn snapshots git state so the UI can show diffs and open a PR.

## Commands

```bash
pnpm dev             # dev server on :3000 (loopback)
pnpm dev -- --demo   # same, overlay sample Runs + Automations (no DB writes)
pnpm lint            # biome check (lint + format); pnpm lint:fix writes
pnpm build           # production build into dist/
pnpm start           # serve the build via scripts/start.ts (refuses an unsafe bind)
pnpm token:print     # print / create the access token (`pnpm token` is pnpm's own npm command)
pnpm preview         # vite preview
pnpm typecheck       # tsc --noEmit
pnpm test            # unit tests
pnpm generate-routes # tsr generate  (see the routeTree gotcha — prefer `pnpm build`)
```

`pnpm test` is `node --experimental-strip-types --test "src/**/*.test.ts"` —
**node's built-in runner, no Vitest/Jest.** Count `*.test.ts` under `src/` rather than
trusting a hard-coded number here.

## Architecture

```
routes/*.tsx  →  lib/queries.ts (React Query)  →  fns/index.ts (createServerFn RPC)
                                                        ↓ lazy import()
                                              server/core.ts (facade, boots scheduler)
                                                ↓            ↓                ↓
                                          server/db.ts  server/executor.ts  server/scheduler.ts
                                          (better-sqlite3)  (spawn CLI)      (node-cron)
```

The **live path** is separate and easy to miss:

```
executor → server/runLive.ts + server/activityLive.ts   (in-process pub/sub)
         → routes/api/runs/$runId/stream.ts             (SSE, one run)
           routes/api/activity/stream.ts                (SSE, run started/finished)
         → lib/useRunLive.ts + lib/useActivityLive.tsx  (hooks)
         → lib/liveStream.ts                            (EventSource, watchdog, reconnect)
         → lib/applyRunLiveEvent.ts                     (patches the React Query cache)
```

HTTP polling is only the **fallback** when a stream is unhealthy. That is why hooks in
`lib/queries.ts` read `useActivityStreamHealthy()` and set
`refetchInterval: streamHealthy ? false : 3000`. Don't "fix" a hook by hardcoding an interval.

**`EventSource` is not the judge of liveness — the heartbeat is.** A socket that dies while
the machine sleeps stays `readyState === OPEN` and never fires `error`, which would pin
`streamHealthy` to `true` and switch every fallback poll off for good. `lib/liveStream.ts`
owns that: both SSE routes ping on `DEFAULT_PING_MS`, and a stream silent past
`STALE_AFTER_MS` is closed and redialled. Change one of those constants and change the other.
Neither hook may open an `EventSource` of its own.

## Hard rules

- **`src/server/**` is server-only.** UI route components never import it — they reach it
  exclusively through `src/fns/index.ts`, where every handler does
  `await import('../server/core')` **lazily**. That laziness is what keeps `better-sqlite3`,
  `node-cron` and `child_process` out of the client bundle; a top-level static import of
  `server/*` in `fns/index.ts` or a route component breaks the client build.
  - Two legitimate exceptions: `src/routes/api/**` handlers are server-side and import
    `#/server/*` directly; several UI components import **types only** from `server/*`
    (erased at compile time) — `routes/planner.tsx`, `components/Chat.tsx`,
    `GitActions.tsx`, `DiffPanel.tsx`, `FileTree.tsx`. Value imports of `server/*` from
    the client are still forbidden.
- **`src/lib/**` is browser-safe and dependency-free.** No `node:` imports, no SQLite, no
  worktree resolution. This is deliberate: the *same* rule module runs in the browser form
  and on the server write path, so the UI can disable a control with the exact message the
  server would have thrown. See the header comments in `lib/workspaceReady.ts`,
  `lib/workspaceRef.ts`, `lib/runtimeBinary.ts`, `lib/cron.ts`.
- **Gate modules answer "why is this button disabled".** `lib/runPrereqGate.ts` holds the
  shared workspace/PATH/prompt checks; `lib/enableGate.ts` (cron + prereq),
  `lib/runNowGate.ts`, `lib/projectGate.ts`, and `lib/gitActionGate.ts` mirror the
  server's refuse conditions so the UI disables and explains on hover instead of
  `alert()`-ing after the click. A new refuse condition goes in the server path **and**
  the matching gate / shared prereq module, or the two drift.
- **Access control is one decision, not seventy-one.** `src/start.ts` registers a global
  request middleware in front of *every* server function and API route; `scripts/start.ts`
  settles the bind address before the socket opens. Both apply the same tested rules from
  `lib/serverAccess.ts`. **Never add a per-route auth check** — a new server function is
  covered the moment it is written, and a second mechanism is how one endpoint gets
  forgotten. There are no exemptions: every provider webhook lands on the control
  plane and arrives over the outbound relay, so nothing inbound is unauthenticated.
  The same middleware runs `hostHeaderRefusal()` **before** the token check: on a
  loopback bind, a request that addresses us by a non-loopback name is a rebound
  DNS answer, and it is refused whether or not a token is configured.
- **Hard rules for secrets.** Anything that can be presented to a vendor or
  used as a login lives hashed or AES-GCM sealed, never as a SQLite column in
  the clear. The wrapping key is `~/.openrun/data-key`, not a row. Unwrap at
  the call site that talks to the vendor. List RPCs strip APNs tokens. MCP
  OAuth tokens are sealed in `mcp_oauth` and copied into CLI config files
  (those files stay plaintext because the CLI reads them). Do not log
  unwrapped secrets. Do not add `process.env` reads in client-bundled `lib/`
  modules other than `openrunEnv.ts`.
- **Open core: no local feature may consult the edition.** `lib/edition.ts` is the seam the
  commercial control plane attaches to, and it only ever *adds* surfaces. `lib/edition.test.ts`
  walks `src/` and fails the build if anything outside that module references it. If you are
  adding a genuine control-plane capability, add the file to `ALLOWED_EDITION_CONSUMERS` so
  the paid surface grows in a visible diff. Anything that runs on the user's machine is free,
  permanently — see `README.md` and `COMMERCIAL-LICENSE.md`.
- **Turn events speak ACP, not a vocabulary of our own.** New agent output goes through an
  adapter in `lib/agentEvents/` that maps it onto the shapes in `lib/acp.ts`. That subset is
  hand-written to keep `lib/` dependency-free, and `lib/acpConformance.ts` type-checks it
  against `@agentclientprotocol/sdk` — if the spec moves, `pnpm typecheck` says so. Do not add
  a payload field that ACP already has a name for.
- **`turn_events` rows are append-only and forward-compatible.** Payload fields are all
  optional: a row written before a field existed simply lacks it, and readers must tolerate
  `undefined` rather than assuming a backfill happened.
- **`server/core.ts` is the only facade.** New server capability ⇒ export from `core.ts`,
  wrap in `fns/index.ts`, hook in `lib/queries.ts`. Don't let a route reach past it.
  - A server module that needs to reach *back* into `core.ts` must do so with a lazy
    `await import('../core')` — core boots the scheduler, so a static import there is
    a cycle.
- **Value imports in test-covered `lib/` modules carry an explicit `.ts` extension**
  (`from './cron.ts'`) — `--experimental-strip-types` has no bundler resolution. Type-only
  imports and untested modules may omit it. Match the file you're editing.
- Aliases `#/*` and `@/*` both map to `./src/*`, but **only `routes/api/**` uses them**;
  everything else imports relatively. Follow the local file.
- `tsconfig` is strict plus `noUnusedLocals` / `noUnusedParameters` /
  `noFallthroughCasesInSwitch` — an unused import fails `pnpm typecheck`.
- **Interactive Cursor sessions.** Implement the asked change in the current
  checkout. Do **not** create a new branch, commit, push, or open a PR unless
  the user explicitly asks. Runtimes with "May open pull requests" enabled may
  open PRs as part of a run.

## Working on X? read Y

| Area | Files |
| --- | --- |
| Run/turn lifecycle, spawning a CLI, streaming stdout | `server/executor.ts` |
| Per-CLI differences: headless invocation, session id, resume, model/effort flags | `server/resume.ts`, `lib/models.ts` |
| Continuing a chat on another runtime (Claude ⇄ Codex handoff) | `lib/runtimeSwitch.ts` (the rules), `lib/handoffPrompt.ts` (what the new agent is told), `executor.sendFollowUp` (the switch); picker + one-time note in `components/Chat.tsx` |
| Which models a picker offers | `server/modelCatalog.ts` (cache + refresh), `lib/modelDiscovery.ts` (per-CLI parsers); `lib/models.ts` is only the fallback seed |
| Hiding models from the picker | `visibleModels` / `hiddenModelsIn` / `toggleHiddenModel` in `lib/models.ts`; stored as `hiddenModels` in `lib/pickerPrefs.ts` (localStorage, display-only — the server never reads it) |
| Hiding runtimes from the picker | `visibleRuntimes` / `hiddenRuntimesIn` / `toggleHiddenRuntime` in `lib/pickRuntime.ts`; stored as `hiddenRuntimes` in `lib/pickerPrefs.ts` (same display-only contract) |
| CLI stdout → chat events | `lib/agentEvents/` — one adapter per CLI (`claude.ts`, `codex.ts`, `grok.ts`, `acp.ts`); `server/turnEvents.ts` is the server-side re-export |
| Live context gauge (how full the window is) | `lib/turnUsage.ts` (the math + fallback context windows), per-CLI extraction in the `lib/agentEvents/` adapters, `server/turnUsage.ts` (folds it onto the message, publishes `turn_usage`), `components/chat/ContextMeter.tsx` |
| The event vocabulary itself (ACP subset) | `lib/acp.ts` (+ `lib/acpConformance.ts` guard), shapes in `lib/turnEvents.ts` |
| ACP transport: driving an agent over JSON-RPC | `server/acpTurn.ts`, `lib/acpTransport.ts` |
| Verification checks, verdicts, the repair loop | `lib/checks.ts` (defs), `server/checks.ts` (runner), `lib/verdict.ts` (judgement); `executor.concludeTurn` decides *whether* a turn is verified — unattended turns only |
| Supervised mode / tool approvals | `lib/approvals.ts` (the model), `lib/claudeControl.ts` (Claude's responder), `lib/supervisedPolicy.ts` (who may) |
| AI SDK UI Message Stream projection (read-only) | `lib/uiMessageStream.ts`, `routes/api/runs/$runId/ui-stream.ts` |
| Schema, migrations, seeded runtimes, `~/.openrun` paths | `server/db.ts` |
| Cron arming | `server/scheduler.ts`; validation/labels in `lib/cron.ts`, `lib/scheduleHealth.ts` |
| Projects, worktrees, `resolveWorkspacePath`, `assertWorkspaceFree` | `server/workspaces.ts` |
| Is a workspace physically fit to run in (exists, right worktree, right branch, clean)? | `lib/workspaceHealth.ts` (the codes + wording), `server/workspaceHealth.ts` (inspection, quarantine, restore) |
| Why a scheduled / webhook fire is refused (isolation, contamination, `gh` preflight) | `lib/unattendedGate.ts` (the rules), `server/unattendedPreflight.ts` (the lookups); called from `scheduler.refusal`, `runQueue.drainWorkspace`, `integrations/dispatcher.ts`, `core.setTaskEnabled` / `upsertTask` |
| Diffs, commit/push/branch/PR, base snapshots | `server/git.ts`; UI in `components/GitActions.tsx`, `components/DiffPanel.tsx`, `lib/diff.ts` |
| Undoing a run — files vs. the commits it made | `lib/undoRun.ts` (the rule), `git.runCommits` / `git.resetRunCommits`, `core.discardChanges`; the dialog lives in `routes/runs.$runId.tsx` |
| How a diff line looks (git panel **and** chat edit hunks) | `components/DiffRows.tsx`; tokens from `lib/highlight.ts`; agent-supplied hunks via `lib/lineDiff.ts` |
| Workspace file browse/edit (path-traversal trust boundary) | `server/files.ts` |
| Webhooks (relayed from the control plane) | `server/integrations/`, `lib/integrations/`, `routes/integrations.tsx` (layout) · `integrations.index.tsx` · `integrations.$provider.tsx` |
| Connecting a provider: what the panel offers and why | `lib/cloud/providers.ts` (the gate) → `components/IntegrationConnect.tsx`; the catalog it reads comes from `server/cloud/providers.ts` |
| Binding a connection to a workspace + runtime | `server/integrations/automation.ts`, `components/IntegrationAutomationSetup.tsx`; event narrowing in `lib/integrations/automation.ts` |
| "When a ticket moves to X" → events + filters | `lib/integrations/triggers.ts` — compiled on the server write path too, so the form's preview *is* the binding |
| Named automation starting points (trigger + prompt) | `lib/integrations/recipes.ts`; gated on `ProviderMeta.emitsCommentText` and on the trigger existing |
| Cloud client (Sign in, hosted Jira, outbound relay) | `lib/cloud/`, `server/cloud/`, `routes/cloud.callback.tsx` |
| First-run account gate | `routes/welcome.tsx`; the redirect lives in `AppLayout` in `routes/__root.tsx`, the remembered skip in `server/cloud/onboarding.ts` |
| Runtime binary on PATH, args templates, transport | `server/runtimePath.ts`, `server/userPath.ts`, `lib/runtimeBinary.ts`, `lib/argsTemplate.ts`, `lib/runtimePresets.ts`, `lib/acpTransport.ts` |
| Live updates | the modules in the live-path diagram above |
| SSE reconnect, heartbeat watchdog, dev connection overlay | `lib/liveStream.ts`; `components/DevLiveStatus.tsx` (dev-only, mounted in `routes/__root.tsx`) |
| Automation create/edit form (largest file, ~1300 lines) | `components/TaskForm.tsx`; project+workspace pair in `components/WorkspacePicker.tsx` |
| Chat transcript / composer pickers | `components/Chat.tsx`, `components/ComposerControls.tsx` |
| MCP servers: which config file, and editing it | `lib/mcpTargets.ts` (where they live per CLI) → `lib/mcp.ts` (shapes, JSON + TOML editors) → `server/mcp.ts` (the IO); UI in `routes/mcp.tsx` |
| Signing in to an OAuth-gated MCP server | `lib/mcpOAuth.ts` (RFC 9728/8414 URL candidates, refresh skew, refusal, header) → `server/mcpOAuth.ts` (discovery, dynamic client registration, PKCE, token, fan-out, refresh timer) → `routes/api/mcp/oauth/callback.ts` (vendor redirect); UI in `routes/mcp.tsx`. One sign-in writes `Authorization: Bearer` onto the shared server — there is no per-CLI `mcp login` / pty path. |
| One server, every CLI: the shared registry and its fan-out | `lib/mcpShared.ts` (sync states) → `server/mcpShared.ts` (`~/.openrun/mcp.json`, ownership manifest, projection into `SHARED_MCP_TARGETS`) |
| Tools Open Run offers *the agent* over MCP | `lib/openrunTools.ts` (definitions), `server/openrunTools.ts` (answers), `scripts/mcp-server.ts` (the stdio process the CLI spawns) |
| Slash commands | `lib/slashCommands.ts` (parsing, app commands), `server/slashCommands.ts` (discovery on disk), `components/SlashCommandMenu.tsx` |
| Assistant prose: markdown, code fences, file chips | `components/chat/ChatMarkdown.tsx`; `lib/codeLanguage.ts`, `lib/filePathToken.ts`; `.chat-markdown` / `.chat-code` in `styles.css` |
| Custom / MCP tool call rendering | `lib/toolCallView.ts` — `humanizeToolName`, `toolCallFields`, `formatToolResult` |
| Command output paint (ANSI + heuristics) | `lib/terminalOutput.ts` (tokenizer) → `components/chat/TerminalOutput.tsx`; the `--term-ansi-*` slots, the `--term-*` roles, and the `.term-*` classes in `styles.css`. Paint is opt-in via `var(--term-x, currentColor)`, so a theme that maps no slots prints plain — never branch on the theme in the tokenizer |
| Terminal palettes (Nord, Dracula, Gruvbox…) | `lib/terminalPalette.ts` (ids + boot script) → `components/chat/TerminalPalettePicker.tsx` (palette list in the run top-bar ⋯ menu while debug is on); the values are `[data-chat-theme='terminal'][data-term-palette='…']` blocks in `styles.css`, each carrying the scheme's own 16 slots plus the `--term-bg` / `--term-fg` it was drawn against |
| Transcript rows: tool calls, sub-agents, the working line | `components/chat/` — `ToolCall.tsx`, `SubagentCall.tsx`, `EditDiff.tsx`, `WorkingIndicator.tsx`; label from `lib/turnActivity.ts` |
| Tools Open Run offers *the agent* over MCP | `lib/openrunTools.ts` (definitions), `server/openrunTools.ts` (answers), `scripts/mcp-server.ts` (the stdio process the CLI spawns) |
| Supervised allow/deny | `components/Chat.tsx`; `fns.answerApproval`; `useAnswerApproval` in `lib/queries.ts` |
| Command preview (Runtimes only) | `components/CommandPreview.tsx`; `server/commandPreview.ts`; `useCommandPreview` in `lib/queries.ts` |
| Shared run prereqs (workspace/PATH/prompt) | `lib/runPrereqGate.ts` → `enableGate` / `runNowGate` |
| Bind address, access token, "who may call this" | `lib/serverAccess.ts` (rules) · `server/accessToken.ts` (values + enforcement) · `src/start.ts` (global middleware) · `scripts/start.ts` (bind) · `SECURITY.md` |
| Secrets at rest (local DB) | `server/secretBox.ts` (`~/.openrun/data-key`); policy in the private tree `internal/SECRETS.md` |
| Open-core boundary (what is free vs. commercial) | `lib/edition.ts` + its test · `COMMERCIAL-LICENSE.md` |
| Licensing, contributing, disclosure | `LICENSE` (AGPLv3), `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`, `CLA.md` |
| Shared primitives (`Modal`, `StatusBadge`, `PageHeader`) | `components/ui.tsx` |
| Design tokens | `src/styles.css` — Tailwind v4, CSS custom properties, `color-scheme: dark` |
| Chat transcript themes (Open Run / Terminal) | `lib/chatTheme.ts` (ids + what starts expanded) → `components/chat/ChatThemeProvider.tsx` (`data-chat-theme` on `<html>`) → the `--chat-*` tokens and the `[data-chat-theme='terminal']` block in `styles.css`; toggle in `components/chat/ChatDebugToggle.tsx` (Debug view in the run top-bar ⋯ menu). A theme is tokens — if a component hardcodes the look, tokenize it rather than branching on the theme in JSX |
| Planner proposals → install automations | `lib/planProposals.ts`; UI in `components/PlanProposalCard.tsx`, `PlanProposalsInChat.tsx`, `routes/planner.tsx` |

Routes: `index.tsx` redirects to Automations · `mcp.tsx` MCP servers · `tasks.index.tsx` /
`tasks.$taskId.tsx` / `tasks.new.tsx` automations · `runs.index.tsx` /
`runs.$runId.tsx` / `runs.new.tsx` · `integrations.tsx` /
`integrations.index.tsx` / `integrations.$provider.tsx` · `notifications.tsx` ·
`devices.tsx` · `runtimes.tsx` · `planner.tsx`.
Projects live in `components/ProjectsManager.tsx` (modal from the picker), not
a standalone route.

## Conventions

- **Tests** — `node:test` + `node:assert/strict`, colocated as `src/lib/foo.test.ts` beside
  `foo.ts`. Pure `lib/` logic is what's covered: gates, cron, args templates, matchers. A new
  rule module gets a colocated test.
- **`changelog.d/`** — one markdown file per shipped change, folded into `CHANGELOG.md` at
  release. Entries are user-facing and written in the negative-relief voice the existing file
  uses: *"You no longer …"*. Match it.
- **Commits** — always [Conventional Commits](https://www.conventionalcommits.org):
  `type(scope): summary`. Types: `feat` `fix` `refactor` `perf` `docs` `test` `build` `ci`
  `chore`, `!` before the colon for a breaking change. Scope is the area, not the path —
  `tasks`, `chat`, `cloud`, `runtimes`, `security`, `workspace`, `deps` — and is optional.
  Subject is lowercase imperative ("add", not "added"/"adds"), no trailing period, **≤ 60
  characters**. Skip the body when the subject says it all; add one only for the *why* the
  diff cannot show, wrapped at 80. One shippable slice per commit and per PR.

## Gotchas

- `src/routeTree.gen.ts` is **generated**. Never hand-edit it, and don't resolve conflicts in
  it by hand — regenerate. Regenerate with **`pnpm build`** (or `pnpm dev`), not
  `pnpm generate-routes`: the standalone router-cli currently emits a different `Register`
  block from the Vite plugin, dropping the `config` entry that types the `src/start.ts`
  instance. The plugin's output is authoritative.
- `data/openrun.db` is git-ignored and created on first run; delete it to reset all state.
  App-managed clones and worktrees live in `~/.openrun` (`OPENRUN_HOME` overrides).
- The scheduler and both live pub/sub registries are **module singletons guarded on
  `globalThis`** so they survive Vite HMR. Don't re-instantiate them per call.
- `db.ts` migrations are additive-only (`addColumn` diffs `table_info`; SQLite has no
  `ADD COLUMN IF NOT EXISTS`). `backfillWorkspaces` is one-shot, guarded via `app_meta`.
- Runs execute **real commands in a real repo with the user's own credentials**, and some
  runtimes pass `--dangerously-skip-permissions`. Treat run cwd resolution and prompt
  construction as security-relevant.
- The Planner nav entry is commented out in `routes/__root.tsx`; the `/planner` route still
  exists and uses the same empty-projects gate as Automations.

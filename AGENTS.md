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
pnpm contract:generate # rebuild every transport from src/contract/operations.ts
pnpm contract:check    # regenerate, then fail if anything drifted (CI gate)
pnpm test            # unit tests
pnpm generate-routes # compatibility alias for the Vite build, which regenerates routes
pnpm ship "feat(x): y" # branch off main, commit, push, open the PR
pnpm release:plan    # read-only: what would the next release be?
pnpm release:prepare # write the version + changelog onto release/vX.Y.Z (--dry-run to rehearse)
pnpm release:publish # tag HEAD and create the GitHub Release (CI runs this)
```

`pnpm test` is `node --experimental-strip-types --test "src/**/*.test.ts"` —
**node's built-in runner, no Vitest/Jest.** Count `*.test.ts` under `src/` rather than
trusting a hard-coded number here.

## Architecture

```
routes/*.tsx  →  lib/queries.ts (React Query)  →  fns/index.ts (GENERATED server fns)
                                                        ↓
routes/api/v1/$.ts (REST + SSE, every client)  →  server/contract/dispatch.ts
                                                        ↓ lazy import()
                                              server/core.ts (facade, boots scheduler)
                                                ↓            ↓                ↓
                                          server/db.ts  server/executor.ts  server/scheduler.ts
                                          (better-sqlite3)  (spawn CLI)      (node-cron)
```

**`src/contract/operations.ts` is the source of truth for the whole API surface.**
118 operations, described once as data. `pnpm contract:generate` emits from it:
`src/fns/index.ts`, `src/contract/generated/client.ts` (framework-free fetch client),
`src/contract/generated/openapi.json`, and the Swift `OpenRunKit` package under
`clients/apple/`. Never hand-edit those four; `pnpm contract:check` fails CI if you do.
Adding a capability is: export it from `core.ts`, add a descriptor, regenerate.

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
owns both constants: `SERVER_PING_MS` is the heartbeat both SSE factories import (they
re-export it rather than declaring their own), and a stream silent past `STALE_AFTER_MS` —
derived from it — is closed and redialled. Do not reintroduce a second copy of the period.
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
  add a descriptor to `src/contract/operations.ts`, run `pnpm contract:generate`, hook in
  `lib/queries.ts`. Don't let a route reach past it. A descriptor naming a `core` export
  that does not exist fails `server/contract/dispatch.test.ts`.
  - A server module that needs to reach *back* into `core.ts` must do so with a lazy
    `await import('../core')` — core boots the scheduler, so a static import there is
    a cycle.
- **`src/contract/**` is browser-safe and dependency-free**, same rule as `src/lib/**` —
  the descriptors ship to the browser inside the generated client.
  `contract/contract.test.ts` walks the directory and fails the build on a `node:` import,
  a reach into `server/`, or a third-party dependency.
- **Ship gate *decisions*, not gate *logic*, to clients that are not TypeScript.**
  The gate modules stay the single implementation; `lib/actions.ts` runs them on the
  server's read path and attaches the answers to the resource
  (`task.actions.runNow = { enabled, reason }`). A TypeScript client may still call the
  gates locally for an optimistic disable — same function, so they cannot disagree.
  Swift clients own no copy. Never re-derive a refuse condition in another language.
- **Value imports in test-covered `lib/` modules carry an explicit `.ts` extension**
  (`from './cron.ts'`) — `--experimental-strip-types` has no bundler resolution. Type-only
  imports and untested modules may omit it. Match the file you're editing.
- Aliases `#/*` and `@/*` both map to `./src/*`, but **only `routes/api/**` uses them**;
  everything else imports relatively. Follow the local file.
- `tsconfig` is strict plus `noUnusedLocals` / `noUnusedParameters` /
  `noFallthroughCasesInSwitch` — an unused import fails `pnpm typecheck`.
- **The PR title is release metadata, not a label.** `main` takes squashed PRs only and
  the squash uses the title verbatim, so the title is the commit *and* the input the release
  pipeline reads to compute the next version. `feat` ⇒ minor, `fix`/`perf`/`revert` ⇒ patch,
  `!` ⇒ breaking, everything else ⇒ no release. Pick the type by what the change does for a
  user, not by how the diff looks — a bug fix implemented as a refactor is still `fix`.
  `.github/workflows/pr-title.yml` is a required check, and it runs the same
  `validateCommitTitle` from `lib/release/conventional.ts` that `pnpm ship` runs locally, so
  the two cannot drift.
- **No model ever chooses a version.** Given a base version and a commit range the next
  version is a pure function in `lib/release/`, with colocated tests. A breaking change below
  1.0 is a *minor* — reaching 1.0 is a product decision, not a side effect of a `feat!`
  merging — and past 1.0 an automatic major still needs an explicit opt-in. A range of only
  docs and chores produces **no release**, rather than a meaningless patch.
- **Interactive Cursor sessions.** Implement the asked change in the current
  checkout. Do **not** create a new branch, commit, push, or open a PR unless
  the user explicitly asks. Runtimes with "May open pull requests" enabled may
  open PRs as part of a run.

## Working on X? read Y

| Area | Files |
| --- | --- |
| The API surface: adding, renaming or scoping an operation | `src/contract/operations.ts` (the list) → `src/contract/types.ts` (the vocabulary); regenerate with `pnpm contract:generate` |
| How a request reaches the facade, and how a refusal becomes a status | `server/contract/dispatch.ts`; the one REST route is `routes/api/v1/$.ts` |
| "Why is this button disabled", sent to a non-TypeScript client | `lib/actions.ts`; attached in `core.decorate` |
| An Apple client (iOS, macOS) | `clients/apple/OpenRunKit/` — `Generated.swift` is generated, everything else is hand-written |
| Run/turn lifecycle, spawning a CLI, streaming stdout | `server/executor.ts` |
| Per-CLI differences: headless invocation, session id, resume, model/effort flags | `server/resume.ts`, `lib/models.ts` |
| Adopting a chat started in the CLI itself | `lib/nativeSessions.ts` + `server/nativeSessions.ts` (find them), `lib/nativeTranscript.ts` + `server/nativeTranscript.ts` (read one in full), `server/nativeImport.ts` (write it into a run), `executor.adoptNativeChat` (adopt without prompting); picker in `components/NativeSessionMenu.tsx` |
| Continuing a chat on another runtime (Claude ⇄ Codex handoff) | `lib/runtimeSwitch.ts` (the rules), `lib/handoffPrompt.ts` (what the new agent is told), `executor.sendFollowUp` (the switch); picker + one-time note in `components/Chat.tsx` |
| Which models a picker offers | `server/modelCatalog.ts` (cache + refresh), `lib/modelDiscovery.ts` (per-CLI parsers); `lib/models.ts` is only the fallback seed |
| Hiding models from the picker | `visibleModels` / `hiddenModelsIn` / `toggleHiddenModel` in `lib/models.ts`; stored as `hiddenModels` in `lib/pickerPrefs.ts` (localStorage, display-only — the server never reads it) |
| Hiding runtimes from the picker | `visibleRuntimes` / `hiddenRuntimesIn` / `toggleHiddenRuntime` in `lib/pickRuntime.ts`; stored as `hiddenRuntimes` in `lib/pickerPrefs.ts` (same display-only contract) |
| CLI stdout → chat events | `lib/agentEvents/` — one adapter per CLI (`claude.ts`, `codex.ts`, `grok.ts`, `acp.ts`); `server/turnEvents.ts` is the server-side re-export |
| The event vocabulary itself (ACP subset) | `lib/acp.ts` (+ `lib/acpConformance.ts` guard), shapes in `lib/turnEvents.ts` |
| ACP transport: driving an agent over JSON-RPC | `server/acpTurn.ts`, `lib/acpTransport.ts` |
| Verification checks, verdicts, the repair loop | `lib/checks.ts` (defs), `server/checks.ts` (runner), `lib/verdict.ts` (judgement); `executor.concludeTurn` decides *whether* a turn is verified — unattended turns only |
| Supervised mode / tool approvals | `lib/approvals.ts` (the model), `lib/claudeControl.ts` (Claude's responder), `lib/supervisedPolicy.ts` (who may) |
| AI SDK UI Message Stream projection (read-only) | `lib/uiMessageStream.ts`, `routes/api/runs/$runId/ui-stream.ts` |
| Schema, migrations, seeded runtimes, `~/.openrun` paths | `server/db.ts` |
| Cron arming | `server/scheduler.ts`; validation/labels in `lib/cron.ts`, `lib/scheduleHealth.ts` |
| Projects, shared-checkout chats, worktrees, `resolveWorkspacePath`, `assertWorkspaceFree` | `server/workspaces.ts`; `/runs/new` offers the primary checkout only for interactive chats, while automations remain worktree-only |
| Is a workspace physically fit to run in (exists, right worktree, right branch, clean)? | `lib/workspaceHealth.ts` (the codes + wording), `server/workspaceHealth.ts` (inspection, quarantine, restore) |
| Why a scheduled / webhook fire is refused (isolation, contamination, `gh` preflight) | `lib/unattendedGate.ts` (the rules), `server/unattendedPreflight.ts` (the lookups); called from `scheduler.refusal`, `runQueue.drainWorkspace`, `integrations/dispatcher.ts`, `core.setTaskEnabled` / `upsertTask` |
| Diffs, commit/push/branch/PR, base snapshots | `server/git.ts`; UI in `components/GitActions.tsx`, `components/DiffPanel.tsx`, `lib/diff.ts` |
| Undoing a run — files vs. the commits it made | `lib/undoRun.ts` (the rule), `git.runCommits` / `git.resetRunCommits`, `core.discardChanges`; the dialog lives in `routes/runs.$runId.tsx` |
| How a diff line looks (git panel **and** chat edit hunks) | `components/DiffRows.tsx`; tokens from `lib/highlight.ts`; agent-supplied hunks via `lib/lineDiff.ts` |
| Workspace file browse/edit (path-traversal trust boundary) | `server/files.ts` |
| Webhooks (relayed from the control plane) | `server/integrations/`, `lib/integrations/`, `routes/integrations.tsx` (layout) · `integrations.index.tsx` · `integrations.$provider.tsx` |
| Connecting a provider: what the panel offers and why | `lib/cloud/providers.ts` (the gate) → `components/IntegrationConnect.tsx`; the catalog it reads comes from `server/cloud/providers.ts` |
| Binding a connection to a workspace + runtime | `components/IntegrationAutomationSetup.tsx` (the panel after Connect) → `server/integrations/automation.ts`; refuse conditions mirrored in `lib/integrations/setupGate.ts`, event narrowing in `lib/integrations/automation.ts` |
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
| Shared run prereqs (workspace/PATH/prompt) | `lib/runPrereqGate.ts` → `enableGate` / `runNowGate` / `lib/integrations/setupGate.ts` |
| Starting an empty conversation (desktop composer **and** phone) | `lib/startChatGate.ts` (the rules) → `core.startChat` / `core.startRunOptions` |
| What a paired phone may do, and the routes that enforce it | `lib/mobileScope.ts` (the one allowlist; tags are frozen, widening adds a tag) → `server/mobile/auth.ts` → `server/mobile/handlers.ts`; routes in `routes/api/mobile/**`; the app in the private tree's `ios/` |
| What "Send test event" sends | `lib/integrations/testEvent.ts` shapes it from the connection's own bindings; `cloud/hosted.ts` `ingestTestEvent` delivers it |
| Bind address, access token, "who may call this" | `lib/serverAccess.ts` (rules) · `server/accessToken.ts` (values + enforcement) · `src/start.ts` (global middleware) · `scripts/start.ts` (bind) · `SECURITY.md` |
| Secrets at rest (local DB) | `server/secretBox.ts` (`~/.openrun/data-key`); policy in the private tree's `SECRETS.md` |
| Open-core boundary (what is free vs. commercial) | `lib/edition.ts` + its test · `COMMERCIAL-LICENSE.md` |
| Release pipeline: version maths, cadence, notes | `scripts/release/` (`semver.ts`, `conventional.ts`, `plan.ts`, `cadence.ts`, `notes.ts`) — all pure, all tested; IO in `scripts/release/index.ts`; runbook in `RELEASING.md` |
| Why CI rejected a PR title, or a missing changelog entry | `lib/release/conventional.ts` (`validateCommitTitle`) → `scripts/check-title.ts`; `scripts/check-changelog.ts`; the `pr-title` workflow and the `changelog` job in `ci.yml` |
| Cutting a release, or why one did not happen | `RELEASING.md`; `release.cadence` in `package.json`; `.github/workflows/release-prepare.yml` + `release-publish.yml` |
| Licensing, contributing, disclosure | `LICENSE` (AGPLv3), `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`, `CLA.md` |
| Shared primitives (`Modal`, `StatusBadge`, `PageHeader`) | `components/ui.tsx` |
| Design tokens | `src/styles.css` — Tailwind v4, CSS custom properties, `color-scheme: dark` |
| Chat transcript themes (Open Run / Terminal) | `lib/chatTheme.ts` (ids + what starts expanded) → `components/chat/ChatThemeProvider.tsx` (`data-chat-theme` on `<html>`) → the `--chat-*` tokens and the `[data-chat-theme='terminal']` block in `styles.css`; toggle in `components/chat/ChatDebugToggle.tsx` (Debug view in the run top-bar ⋯ menu). A theme is tokens — if a component hardcodes the look, tokenize it rather than branching on the theme in JSX |
| Start page and `/runs/new`: the draft a run begins from | `hooks/useNewRunDraft.ts` (all the wiring), `components/NewRunSurface.tsx` (the pickers around it), `routes/index.tsx`, `routes/runs.new.tsx`; `components/chat/Composer.tsx` stays props-only |
| Automation shortcuts on the start page | `lib/automationShortcuts.ts` (the templates) → `components/AutomationShortcuts.tsx`; seeded into the form by `routes/tasks.new.tsx` via `?shortcut=` |
| Planner proposals → install automations | `lib/planProposals.ts`; UI in `components/PlanProposalCard.tsx`, `PlanProposalsInChat.tsx`, `routes/planner.tsx` |

Routes: `index.tsx` is the start page (composer + resume dropdown + automation
shortcuts) · `mcp.tsx` MCP servers · `tasks.index.tsx` /
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
  uses: *"You no longer …"*. Match it. This is a **CI gate**, not a request: a `feat`, `fix`,
  `perf`, `revert` or breaking PR without a fragment fails the `changelog entry` check. The
  `changelog-entry` skill drafts one from the diff. Genuinely internal? Add the
  `no changelog` label or `[skip changelog]` to the PR body.
  Conventional subjects decide the *version*; fragments decide the *prose*. Keeping them
  apart is why the version can be fully automatic without the changelog collapsing into a
  list of commit subjects.
- **Commits** — always [Conventional Commits](https://www.conventionalcommits.org):
  `type(scope): summary`. Types: `feat` `fix` `refactor` `perf` `docs` `test` `build` `ci`
  `chore`, `!` before the colon for a breaking change. Scope is the area, not the path —
  `tasks`, `chat`, `cloud`, `runtimes`, `security`, `workspace`, `deps` — and is optional.
  Subject is lowercase imperative ("add", not "added"/"adds"), no trailing period, **≤ 60
  characters**. Skip the body when the subject says it all; add one only for the *why* the
  diff cannot show, wrapped at 80. One shippable slice per commit and per PR.

## Pull requests

**Branch first.** Never commit on `main`. Branch names are `<type>/<slug>` using
the commit type vocabulary — `feat/bulk-run-delete`, `fix/turnstile-verify`. No
tool-generated names such as `cursor/…`.

**The title is the commit.** `main` takes squashed PRs only, and the squash uses
the PR *title* verbatim — so the title, not the branch's commits, is what lands.
It must satisfy every commit rule above.

**PR body — always these three sections, in this order.** No extra headings, no
preamble. `.github/pull_request_template.md` is this shape already; fill it in,
do not restructure it.

```markdown
## Summary
- What changed, from a user's point of view. One bullet per shippable idea,
  two to four bullets. Say what the change *does*, not which files moved.

Closes #12
Closes #13

## Test plan
- [ ] A step a reviewer can actually perform, with the route and the expected result
- [ ] One line per behaviour worth checking, including the edge case you fixed
```

- **Summary** is bullets, not prose. Even a one-line fix gets one bullet.
- **Related issues** are bare `Closes #N` lines directly under the summary
  bullets, one per line, no heading of their own. Use `Refs #N` when the PR
  advances an issue without ending it. No issue? Drop the lines; never leave a
  bare `Closes #` with nothing after it.
- **Test plan** is unchecked `- [ ]` boxes describing manual verification —
  which route, which runtime, what you expect to see. It is not the CI list: CI
  already runs `pnpm test`, `pnpm typecheck` and `pnpm build`, and repeating them
  here buries the steps a human must actually do. Tick a box only once you have
  performed it.

**PR review comments are brief, natural, and useful.** Comment only on a specific
actionable problem or a genuinely helpful optional improvement. Keep each comment
to one or two short sentences; use `Nitpick: ...` for minor suggestions. Do not
summarize the diff, restate the code, narrate checks, or post obvious observations
such as "TypeScript is OK" or "tests pass." If there is nothing worth commenting
on, say only `Looks good to me.`

Reference shape: <https://github.com/dennisadriaans/openrun/pull/34>.

The gates that used to live in the template are still hard rules, enforced in
review and by CI rather than by a checkbox: one shippable slice per PR; a
user-facing change carries a `changelog.d/` entry in the negative-relief voice;
a new rule module in `src/lib/` carries a colocated `*.test.ts`; a new refuse
condition is mirrored in the matching gate module; `src/routeTree.gen.ts` is
regenerated, never hand-edited; nothing new runs off the user's machine.

**Never credit an agent.** No commit, PR title, PR body, branch name, issue,
issue comment, review comment, or `changelog.d/` entry mentions Claude, Claude
Code, Codex, Cursor, Grok, Gemini, Copilot, or any other assistant — not in
prose, not in a footer, not in a trailer. Strip all of these before they land:

- `Co-authored-by: Claude …`, `Co-authored-by: Cursor …`, and any other
  assistant co-author trailer
- `🤖 Generated with [Claude Code](…)` and `Made with [Cursor](…)` footers
- session or agent links (`claude.ai/code/session_…`, `cursor.com/agents/…`)
- Cursor's `<!-- CURSOR_AGENT_PR_BODY_BEGIN -->` block and its PR footer images

Commit and push as the authenticated GitHub account: `git config user.name` and
`user.email` are the human's, `gh auth status` is that same account, and a
co-author trailer names only a *person* who worked on the change. The history is
the author's own work record; a tool footer in it is noise that outlives the
tool. (Runtime names in *product* code, docs and changelog entries are of course
fine — this rule is about crediting the agent that wrote the diff.)

A human co-author is still welcome:

```
Co-authored-by: Some Person <person@example.com>
```


**Which agent reads what.** The rules live in this file. Everything else is a
thin pointer or a setting, so a change goes here — never into six copies.

| Agent | How it picks this file up |
| --- | --- |
| Codex CLI | Reads `AGENTS.md` natively: `~/.codex/AGENTS.md`, then every directory from the git root down to the cwd, closest last. One file per directory, 32 KiB total (`project_doc_max_bytes`). No pointer file. |
| Grok Build (`grok`) | Reads the `AGENTS.md` family natively, plus `CLAUDE.md` and — for compatibility — `.claude/rules/` and `.cursor/rules/`. No pointer file. |
| Cursor | Reads root and nested `AGENTS.md`. Do not add `.cursor/rules/*.mdc` copies of this file. |
| GitHub Copilot | Reads `AGENTS.md` (coding agent, and VS Code via `chat.useAgentsMdFile`). `.github/copilot-instructions.md` is a pointer for the surfaces that look there first. |
| Claude Code | Reads `CLAUDE.md`, **never** `AGENTS.md`. So `CLAUDE.md` is a single `@AGENTS.md` import — Anthropic's documented way to share one file between agents. |
| Gemini CLI | Defaults to `GEMINI.md`. `.gemini/settings.json` sets `context.fileName` to `["AGENTS.md", "GEMINI.md"]`, so it loads this file; workspace settings beat `~/.gemini/settings.json`. |

There is no `GROK.md`, no `GEMINI.md`, and no `.cursor/rules/` copy of this
file. A pointer (`CLAUDE.md`, `.github/copilot-instructions.md`) is a
one-paragraph import, never a restatement.

## Gotchas

- Four more files are **generated** from `src/contract/operations.ts`: `src/fns/index.ts`,
  `src/contract/generated/client.ts`, `src/contract/generated/openapi.json`, and
  `clients/apple/OpenRunKit/Sources/OpenRunKit/Generated.swift`. Never hand-edit them —
  run `pnpm contract:generate`. The generator formats its own output with Biome, so
  `pnpm lint:fix` and the generator cannot disagree.
- `src/routeTree.gen.ts` is **generated**. Never hand-edit it, and don't resolve conflicts in
  it by hand — regenerate with **`pnpm build`** (or `pnpm dev`). The compatibility
  command `pnpm generate-routes` also runs the Vite build. Use the Vite plugin rather
  than the standalone router CLI so the `Register` block retains the `config` entry
  that types the `src/start.ts` instance.
- Runs, automations, and the rest of app state live in `~/.openrun/openrun.db`
  (`OPENRUN_HOME` overrides the whole directory). Delete that file to reset.
  A leftover `data/openrun.db` in a checkout is moved there on first boot.
  App-managed clones and worktrees live under the same home directory.
- The scheduler and both live pub/sub registries are **module singletons guarded on
  `globalThis`** so they survive Vite HMR. Don't re-instantiate them per call.
- `db.ts` migrations are additive-only (`addColumn` diffs `table_info`; SQLite has no
  `ADD COLUMN IF NOT EXISTS`). `backfillWorkspaces` is one-shot, guarded via `app_meta`.
- Runs execute **real commands in a real repo with the user's own credentials**, and some
  runtimes pass `--dangerously-skip-permissions`. Treat run cwd resolution and prompt
  construction as security-relevant.
- The Planner nav entry is commented out in `routes/__root.tsx`; the `/planner` route still
  exists and uses the same empty-projects gate as Automations.

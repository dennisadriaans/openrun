# Open Run — project map for coding agents

Read this first. It exists so you can skip a whole-codebase sweep and open only the two or
three files your prompt actually needs.

## What this is

A **TanStack Start** proof-of-concept that plans and schedules **local coding-agent CLIs**
(`claude`, `codex`, `grok`, `gemini`, `agy`, `fx`) as child
processes. No model APIs, no cloud, no keys — it drives the CLIs the user is already logged into.

The optional natural-language CLI launcher is the exception for interpretation:
`apps/cli/src/commands/natural.ts` sends the typed request and model choices to Open Run's
hosted interpreter, without an account or user API key. Explicit flags work
offline. The endpoint returns selections and source spans; all agent execution
and scheduling remain local. `apps/cli/src/commands/native.ts` owns terminal handoff and
native launch/resume. Never embed the hosted service credential in this repo.

Each runtime has a **transport**: `cli` parses the binary's own JSON output, `acp` drives it
over the [Agent Client Protocol](https://agentclientprotocol.com). Either way what lands in
the DB is the same ACP-shaped event vocabulary (`packages/domain/src/chat/acp.ts`) — tool calls with a title, kind,
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
pnpm cli <args>      # the local CLI, e.g. pnpm cli schedule at 16:40 "…" for claude
pnpm preview         # vite preview
pnpm typecheck       # tsc --noEmit
pnpm architecture:check # dependency directions, exports and capability cycles
pnpm cli:smoke       # install the packed CLI and run its integration suite
pnpm contract:generate # rebuild every transport from packages/contracts/src/operations.ts
pnpm contract:check    # regenerate, then fail if anything drifted (CI gate)
pnpm test            # unit tests
pnpm generate-routes # compatibility alias for the Vite build, which regenerates routes
pnpm ship "feat(x): y" # branch off main, commit, push, open the PR
pnpm release:plan    # read-only: what would the next release be?
pnpm release:prepare # write the version + changelog, no git (--dry-run to rehearse)
pnpm release:publish # GitHub Release for the tagged commit (CI runs this on a v* tag)
pnpm release:cli:plan # same three commands for the npm CLI (cli-vX.Y.Z)
```

`pnpm test` runs `node --experimental-strip-types --test` across `apps/`, `packages/` and `scripts/` —
**node's built-in runner, no Vitest/Jest.** Count colocated `*.test.ts` across the workspaces rather than
trusting a hard-coded number here.

## Architecture

Open Run is a pnpm workspace. Read `docs/architecture.md` for the dependency map
and extension guide. Existing root commands and `scripts/` entry points remain available.

| Package | Responsibility |
| --- | --- |
| `apps/web` | TanStack routes, React components and feature-owned queries |
| `apps/cli` | Terminal UI, command parsing and local/HTTP client adapters |
| `apps/worker` | Headless process and stdio MCP entry points |
| `packages/runtime` | Shared Node runtime, application capabilities, SQLite and integrations |
| `packages/domain` | Browser-safe rules, resource types, events and protocol constants |
| `packages/contracts` | Operation descriptors and generated HTTP/OpenAPI client artifacts |
| `packages/apple/OpenRunKit` | Shared Swift client for native Apple apps |

The web reaches the runtime through lazy generated server functions or API routes;
the CLI uses local IPC or the generated HTTP client. Both dispatch through
`packages/runtime/src/contract/dispatch.ts` and the public `core.ts` facade.
`bootstrap.ts` owns process startup. Feature implementations in `application/`
never import the facade. They compose named capabilities without booting another runtime.

`packages/contracts/src/operations/` owns descriptors grouped by capability.
`operations.ts` assembles them. `pnpm contract:generate` produces the web server
functions, framework-free TypeScript client, OpenAPI document and Swift operations.
Never edit generated files by hand; `pnpm contract:check` is a CI gate.

Live updates flow from the executor through the runtime's `events/` SSE factories
into `apps/web/src/lib/useRunLive.ts` and `useActivityLive.tsx`.
`apps/web/src/lib/liveStream.ts` owns browser reconnects and the heartbeat watchdog.
The one heartbeat definition is `packages/domain/src/live/protocol.ts`; the CLI,
server and generated Swift client use those constants too. HTTP polling is only
the fallback while a stream is unhealthy. Do not hardcode a polling interval or
open a second EventSource in a hook.

## Hard rules

- **`packages/runtime/src/**` is server-only.** UI route components never import it — they reach it
  exclusively through `apps/web/src/fns/index.ts`, where every handler does
  `await import('@openrun/runtime/contract/dispatch')` **lazily**. That laziness is what keeps `better-sqlite3`,
  `node-cron` and `child_process` out of the client bundle; a top-level static import of
  `@openrun/runtime/*` in `apps/web/src/fns/index.ts` or a route component breaks the client build.
  - Two legitimate exceptions: `apps/web/src/routes/api/**` handlers are server-side and import
    declared `@openrun/runtime/*` exports directly; several UI components import **types only** from those exports
    (erased at compile time) — `apps/web/src/routes/planner.tsx`, `apps/web/src/features/chat/Chat.tsx`,
    `GitActions.tsx`, `DiffPanel.tsx`, `FileTree.tsx`. Value imports of the runtime from
    the client are still forbidden.
- **`packages/domain/src/**` is browser-safe.** Its schedule helpers use `cron-parser`; everything else is framework-free. No `node:` imports, no SQLite, no
  worktree resolution. This is deliberate: the *same* rule module runs in the browser form
  and on the server write path, so the UI can disable a control with the exact message the
  server would have thrown. See the header comments in `packages/domain/src/workspaces/workspaceReady.ts`,
  `packages/domain/src/workspaces/workspaceRef.ts`, `packages/domain/src/runtimes/runtimeBinary.ts`, `packages/domain/src/tasks/cron.ts`.
- **Gate modules answer "why is this button disabled".** `packages/domain/src/tasks/runPrereqGate.ts` holds the
  shared workspace/PATH/prompt checks; `packages/domain/src/tasks/enableGate.ts` (cron + prereq),
  `packages/domain/src/tasks/runNowGate.ts`, `packages/domain/src/workspaces/projectGate.ts`, and `packages/domain/src/workspaces/gitActionGate.ts` mirror the
  server's refuse conditions so the UI disables and explains on hover instead of
  `alert()`-ing after the click. A new refuse condition goes in the server path **and**
  the matching gate / shared prereq module, or the two drift.
- **Access control is one decision, not seventy-one.** `apps/web/src/start.ts` registers a global
  request middleware in front of *every* server function and API route; `apps/web/scripts/start.ts`
  settles the bind address before the socket opens. Both apply the same tested rules from
  `packages/domain/src/security/serverAccess.ts`. **Never add a per-route auth check** — a new server function is
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
- **Open core: no local feature may consult the edition.** `packages/domain/src/cloud/edition.ts` is the seam the
  commercial control plane attaches to, and it only ever *adds* surfaces. `packages/domain/src/cloud/edition.test.ts`
  walks `apps/` and `packages/` and fails the build if anything outside that module references it. If you are
  adding a genuine control-plane capability, add the file to `ALLOWED_EDITION_CONSUMERS` so
  the paid surface grows in a visible diff. Anything that runs on the user's machine is free,
  permanently — see `README.md` and `COMMERCIAL-LICENSE.md`.
- **Turn events speak ACP, not a vocabulary of our own.** New agent output goes through an
  adapter in `packages/domain/src/chat/agentEvents/` that maps it onto the shapes in `packages/domain/src/chat/acp.ts`. That subset is
  hand-written to keep `lib/` dependency-free, and `packages/domain/src/chat/acpConformance.ts` type-checks it
  against `@agentclientprotocol/sdk` — if the spec moves, `pnpm typecheck` says so. Do not add
  a payload field that ACP already has a name for.
- **`turn_events` rows are append-only and forward-compatible.** Payload fields are all
  optional: a row written before a field existed simply lacks it, and readers must tolerate
  `undefined` rather than assuming a backfill happened.
- **`packages/runtime/src/core.ts` is the application facade.** Implement a new capability in
  `packages/runtime/src/application/`, export it from `core.ts`, add its descriptor to
  `packages/contracts/src/operations/`, run `pnpm contract:generate`, and connect it in
  `apps/web/src/features/<feature>/queries.ts`. Don't let a route reach past the package's
  declared exports. A descriptor naming a `core` export
  that does not exist fails `packages/runtime/src/contract/dispatch.test.ts`.
  - Application modules never import `core.ts` or `bootstrap.ts`. Compose the owning
    capability directly; keep startup in `bootstrap.ts`. A lower-level runtime module
    that needs the facade must load it lazily to avoid a startup cycle.
- **`packages/contracts/src/**` is browser-safe and depends only on shared domain types**, same rule as `packages/domain/src/**` —
  the descriptors ship to the browser inside the generated client.
  `packages/contracts/src/contract.test.ts` walks the directory and fails the build on a `node:` import,
  a reach into the runtime, or a third-party dependency.
- **Ship gate *decisions*, not gate *logic*, to clients that are not TypeScript.**
  The gate modules stay the single implementation; `packages/domain/src/tasks/actions.ts` runs them on the
  server's read path and attaches the answers to the resource
  (`task.actions.runNow = { enabled, reason }`). A TypeScript client may still call the
  gates locally for an optimistic disable — same function, so they cannot disagree.
  Swift clients own no copy. Never re-derive a refuse condition in another language.
- **Relative source imports carry an explicit `.ts` or `.tsx` extension**
  (`from './cron.ts'`) — `--experimental-strip-types` has no bundler resolution. Use exported `@openrun/<package>/<capability>` paths across package boundaries.
- Aliases `#/*` and `@/*` both map to the web app's `src/*`. They never cross a
  workspace boundary. Prefer relative imports within a feature and package exports
  between workspaces.
- `tsconfig` is strict plus `noUnusedLocals` / `noUnusedParameters` /
  `noFallthroughCasesInSwitch` — an unused import fails `pnpm typecheck`.
- **The PR title is release metadata, not a label.** `main` takes squashed PRs only and
  the squash uses the title verbatim, so the title is the commit *and* the input the release
  pipeline reads to compute the next version. `feat` ⇒ minor, `fix`/`perf`/`revert` ⇒ patch,
  `!` ⇒ breaking, everything else ⇒ no release. Pick the type by what the change does for a
  user, not by how the diff looks — a bug fix implemented as a refactor is still `fix`.
  `.github/workflows/pr-title.yml` is a required check, and it runs the same
  `validateCommitTitle` from `scripts/release/conventional.ts` that `pnpm ship` runs locally, so
  the two cannot drift.
- **No model ever chooses a version.** Given a base version and a commit range the next
  version is a pure function in `scripts/release/`, with colocated tests. A breaking change below
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
| The API surface: adding, renaming or scoping an operation | `packages/contracts/src/operations.ts` (the list) → `packages/contracts/src/types.ts` (the vocabulary); regenerate with `pnpm contract:generate` |
| How a request reaches the facade, and how a refusal becomes a status | `packages/runtime/src/contract/dispatch.ts`; the one REST route is `apps/web/src/routes/api/v1/$.ts` |
| "Why is this button disabled", sent to a non-TypeScript client | `packages/domain/src/tasks/actions.ts`; attached in `application/taskQueries.ts` |
| An Apple client (iOS, macOS) | `packages/apple/OpenRunKit/` — `Generated.swift` is generated, everything else is hand-written |
| Run/turn lifecycle, spawning a CLI, streaming stdout | `packages/runtime/src/execution/executor.ts` |
| Per-CLI differences: headless invocation, session id, resume, model/effort flags | `packages/runtime/src/execution/resume.ts`, `packages/domain/src/runtimes/models.ts` |
| Adopting a chat started in the CLI itself | `packages/domain/src/runtimes/nativeSessions.ts` + `packages/runtime/src/runtimes/nativeSessions.ts` (find them), `packages/domain/src/runtimes/nativeTranscript.ts` + `packages/runtime/src/runtimes/nativeTranscript.ts` (read one in full), `packages/runtime/src/runtimes/nativeImport.ts` (write it into a run), `executor.adoptNativeChat` (adopt without prompting); picker in `apps/web/src/features/chat/ComposerControls.tsx`. Automations resume saved chats in their existing workspace. |
| Continuing a chat on another runtime (Claude ⇄ Codex handoff) | `packages/domain/src/runs/runtimeSwitch.ts` (the rules), `packages/domain/src/runs/handoffPrompt.ts` (what the new agent is told), `executor.sendFollowUp` (the switch); picker + one-time note in `apps/web/src/features/chat/Chat.tsx` |
| Which models a picker offers | `packages/runtime/src/runtimes/modelCatalog.ts` (cache + refresh), `packages/domain/src/runtimes/modelDiscovery.ts` (per-CLI parsers); `packages/domain/src/runtimes/models.ts` is only the fallback seed |
| Hiding models from the picker | `visibleModels` / `hiddenModelsIn` / `toggleHiddenModel` in `packages/domain/src/runtimes/models.ts`; stored as `hiddenModels` in `apps/web/src/lib/pickerPrefs.ts` (localStorage, display-only — the server never reads it) |
| Hiding runtimes from the picker | `visibleRuntimes` / `hiddenRuntimesIn` / `toggleHiddenRuntime` in `packages/domain/src/runtimes/pickRuntime.ts`; stored as `hiddenRuntimes` in `apps/web/src/lib/pickerPrefs.ts` (same display-only contract) |
| CLI stdout → chat events | `packages/domain/src/chat/agentEvents/` — one adapter per CLI (`claude.ts`, `codex.ts`, `grok.ts`, `acp.ts`); `packages/runtime/src/execution/turnEvents.ts` is the server-side re-export |
| The event vocabulary itself (ACP subset) | `packages/domain/src/chat/acp.ts` (+ `packages/domain/src/chat/acpConformance.ts` guard), shapes in `packages/domain/src/chat/turnEvents.ts` |
| ACP transport: driving an agent over JSON-RPC | `packages/runtime/src/execution/acpTurn.ts`, `packages/domain/src/runtimes/acpTransport.ts` |
| Verification checks, verdicts, the repair loop | `packages/domain/src/runs/checks.ts` (defs), `packages/runtime/src/execution/checks.ts` (runner), `packages/domain/src/runs/verdict.ts` (judgement); `executor.concludeTurn` decides *whether* a turn is verified — unattended turns only |
| Supervised mode / tool approvals | `packages/domain/src/runs/approvals.ts` (the model), `packages/domain/src/chat/claudeControl.ts` (Claude's responder), `packages/domain/src/runs/supervisedPolicy.ts` (who may) |
| AI SDK UI Message Stream projection (read-only) | `packages/domain/src/chat/uiMessageStream.ts`, `apps/web/src/routes/api/runs/$runId/ui-stream.ts` |
| Schema, migrations, seeded runtimes, `~/.openrun` paths | `packages/runtime/src/storage/db.ts`; shared home resolution in `packages/runtime/src/paths.ts` |
| Cron arming | `packages/runtime/src/scheduling/scheduler.ts`; validation/labels in `packages/domain/src/tasks/cron.ts`, `packages/domain/src/tasks/scheduleHealth.ts` |
| The local CLI (`openrun schedule …`) | `scripts/openrun.ts` owns argv and printing; `apps/cli/src/runtime/local.ts` connects to or starts the local worker, and `apps/cli/src/commands/integrations.ts` owns terminal setup and the temporary OAuth callback. Local calls use the same contract dispatcher as HTTP; `--url` explicitly selects the generated HTTP client. `scripts/worker.ts` boots the existing core without a web build. `packages/runtime/src/process/localRuntime.ts` elects one scheduler/executor owner per database before orphan recovery and exposes authenticated loopback IPC. Never write task rows from a short-lived CLI or start a second scheduler. Parsing/resolution stay in `apps/cli/src/commands/cliSchedule.ts` and `apps/cli/src/commands/cliResolve.ts`. |
| Projects, shared-checkout chats, worktrees, `resolveWorkspacePath`, `assertWorkspaceFree` | `packages/runtime/src/workspaces/workspaces.ts`; externally-created Git worktrees are registered as user-owned workspaces and are never reset or removed by Open Run. |
| Is a workspace physically fit to run in (exists, right worktree, right branch, clean)? | `packages/domain/src/workspaces/workspaceHealth.ts` (the codes + wording), `packages/runtime/src/workspaces/workspaceHealth.ts` (inspection, quarantine, restore) |
| Where an automation fire runs (fresh execution checkout vs. the selected one) | `packages/domain/src/runs/executionWorkspace.ts` (the rule), `packages/runtime/src/execution/runEnvironment.ts` (create, fetch base, release, resume) |
| Verified automation run → pull request → green CI | `packages/domain/src/runs/autoShip.ts` (ship + watch rules, conflict prompt) → `packages/runtime/src/application/autoShip.ts` (ship, `pr_watches`, repair turns); called from `executor.concludeTurn` via `setAutoShipHook` |
| Why a scheduled / webhook fire is refused (isolation, contamination, `gh` preflight) | `packages/domain/src/tasks/unattendedGate.ts` (the rules), `packages/runtime/src/execution/unattendedPreflight.ts` (the lookups); called from `scheduler.refusal`, `runQueue.drainWorkspace`, `integrations/dispatcher.ts`, `core.setTaskEnabled` / `upsertTask` |
| Diffs, commit/push/branch/PR, base snapshots | `packages/runtime/src/workspaces/git.ts`; UI in `apps/web/src/features/git/GitActions.tsx`, `apps/web/src/features/git/DiffPanel.tsx`, `packages/domain/src/workspaces/diff.ts` |
| Undoing a run — files vs. the commits it made | `packages/domain/src/runs/undoRun.ts` (the rule), `git.runCommits` / `git.resetRunCommits`, `core.discardChanges`; the dialog lives in `apps/web/src/routes/runs.$runId.tsx` |
| How a diff line looks (git panel **and** chat edit hunks) | `apps/web/src/features/git/DiffRows.tsx`; tokens from `apps/web/src/lib/highlight.ts`; agent-supplied hunks via `packages/domain/src/workspaces/lineDiff.ts` |
| Workspace file browse/edit (path-traversal trust boundary) | `packages/runtime/src/workspaces/files.ts` |
| Webhooks (relayed from the control plane) | `packages/runtime/src/integrations/`, `lib/integrations/`, `apps/web/src/routes/integrations.tsx` (layout) · `integrations.index.tsx` · `integrations.$provider.tsx` |
| Connecting a provider: what the panel offers and why | `packages/domain/src/cloud/providers.ts` (the gate) → `apps/web/src/features/integrations/IntegrationConnect.tsx`; the catalog it reads comes from `packages/runtime/src/cloud/providers.ts` |
| Binding a connection to a workspace + runtime | `apps/web/src/features/integrations/IntegrationAutomationSetup.tsx` (the panel after Connect) → `packages/runtime/src/integrations/automation.ts`; refuse conditions mirrored in `packages/domain/src/integrations/setupGate.ts`, event narrowing in `packages/domain/src/integrations/automation.ts` |
| "When a ticket moves to X" → events + filters | `packages/domain/src/integrations/triggers.ts` — compiled on the server write path too, so the form's preview *is* the binding |
| Named automation starting points (trigger + prompt) | `packages/domain/src/integrations/recipes.ts`; gated on `ProviderMeta.emitsCommentText` and on the trigger existing |
| Cloud client (Sign in, hosted Jira, outbound relay) | `lib/cloud/`, `server/cloud/`, `apps/web/src/routes/cloud.callback.tsx` |
| First-run account gate | `apps/web/src/routes/welcome.tsx`; the redirect lives in `AppLayout` in `apps/web/src/routes/__root.tsx`, the remembered skip in `packages/runtime/src/cloud/onboarding.ts` |
| Runtime binary on PATH, args templates, transport | `packages/runtime/src/runtimes/runtimePath.ts`, `packages/runtime/src/process/userPath.ts`, `packages/domain/src/runtimes/runtimeBinary.ts`, `packages/domain/src/runtimes/argsTemplate.ts`, `packages/domain/src/runtimes/runtimePresets.ts`, `packages/domain/src/runtimes/acpTransport.ts` |
| Live updates | the modules in the live-path diagram above |
| SSE reconnect, heartbeat watchdog, dev connection overlay | `apps/web/src/lib/liveStream.ts`; `apps/web/src/components/DevLiveStatus.tsx` (dev-only, mounted in `apps/web/src/routes/__root.tsx`) |
| Automation create/edit form (largest file, ~1300 lines) | `apps/web/src/features/automations/TaskForm.tsx`; project+workspace pair in `apps/web/src/features/workspaces/WorkspacePicker.tsx` |
| Chat transcript / composer pickers | `apps/web/src/features/chat/Chat.tsx`, `apps/web/src/features/chat/ComposerControls.tsx` |
| MCP servers: which config file, and editing it | `packages/domain/src/mcp/mcpTargets.ts` (where they live per CLI) → `packages/domain/src/mcp/mcp.ts` (shapes, JSON + TOML editors) → `packages/runtime/src/mcp/mcp.ts` (the IO); UI in `apps/web/src/routes/mcp.tsx` |
| Signing in to an OAuth-gated MCP server | `packages/domain/src/mcp/mcpOAuth.ts` (RFC 9728/8414 URL candidates, refresh skew, refusal, header) → `packages/runtime/src/mcp/mcpOAuth.ts` (discovery, dynamic client registration, PKCE, token, fan-out, refresh timer) → `apps/web/src/routes/api/mcp/oauth/callback.ts` (vendor redirect); UI in `apps/web/src/routes/mcp.tsx`. One sign-in writes `Authorization: Bearer` onto the shared server — there is no per-CLI `mcp login` / pty path. |
| One server, every CLI: the shared registry and its fan-out | `packages/domain/src/mcp/mcpShared.ts` (sync states) → `packages/runtime/src/mcp/mcpShared.ts` (`~/.openrun/mcp.json`, ownership manifest, projection into `SHARED_MCP_TARGETS`) |
| Tools Open Run offers *the agent* over MCP | `packages/domain/src/mcp/openrunTools.ts` (definitions), `packages/runtime/src/mcp/openrunTools.ts` (answers), `scripts/mcp-server.ts` (the stdio process the CLI spawns) |
| Slash commands | `packages/domain/src/chat/slashCommands.ts` (parsing, app commands), `packages/runtime/src/runtimes/slashCommands.ts` (discovery on disk), `apps/web/src/features/chat/SlashCommandMenu.tsx` |
| Assistant prose: markdown, code fences, file chips | `apps/web/src/features/chat/ChatMarkdown.tsx`; `packages/domain/src/chat/codeLanguage.ts`, `packages/domain/src/workspaces/filePathToken.ts`; `.chat-markdown` / `.chat-code` in `styles.css` |
| Custom / MCP tool call rendering | `packages/domain/src/chat/toolCallView.ts` — `humanizeToolName`, `toolCallFields`, `formatToolResult` |
| Command output paint (ANSI + heuristics) | `packages/domain/src/chat/terminalOutput.ts` (tokenizer) → `apps/web/src/features/chat/TerminalOutput.tsx`; the `--term-ansi-*` slots, the `--term-*` roles, and the `.term-*` classes in `styles.css`. Paint is opt-in via `var(--term-x, currentColor)`, so a theme that maps no slots prints plain — never branch on the theme in the tokenizer |
| Terminal palettes (Nord, Dracula, Gruvbox…) | `apps/web/src/lib/terminalPalette.ts` (ids + boot script) → `apps/web/src/features/chat/TerminalPalettePicker.tsx` (palette list in the run top-bar ⋯ menu while debug is on); the values are `[data-chat-theme='terminal'][data-term-palette='…']` blocks in `styles.css`, each carrying the scheme's own 16 slots plus the `--term-bg` / `--term-fg` it was drawn against |
| Transcript rows: tool calls, sub-agents, the working line | `apps/web/src/features/chat/` — `ToolCall.tsx`, `SubagentCall.tsx`, `EditDiff.tsx`, `WorkingIndicator.tsx`; label from `packages/domain/src/chat/turnActivity.ts` |
| Tools Open Run offers *the agent* over MCP | `packages/domain/src/mcp/openrunTools.ts` (definitions), `packages/runtime/src/mcp/openrunTools.ts` (answers), `scripts/mcp-server.ts` (the stdio process the CLI spawns) |
| Supervised allow/deny | `apps/web/src/features/chat/Chat.tsx`; `fns.answerApproval`; `useAnswerApproval` in `apps/web/src/features/chat/queries.ts` |
| Command preview (Runtimes only) | `apps/web/src/features/runtimes/CommandPreview.tsx`; `packages/runtime/src/runtimes/commandPreview.ts`; `useCommandPreview` in `apps/web/src/features/runtimes/queries.ts` |
| Shared run prereqs (workspace/PATH/prompt) | `packages/domain/src/tasks/runPrereqGate.ts` → `enableGate` / `runNowGate` / `packages/domain/src/integrations/setupGate.ts` |
| Starting an empty conversation (desktop composer **and** phone) | `packages/domain/src/runs/startChatGate.ts` (the rules) → `core.startChat` / `core.startRunOptions` |
| What a paired phone may do, and the routes that enforce it | `packages/domain/src/security/mobileScope.ts` (the one allowlist; tags are frozen, widening adds a tag) → `packages/runtime/src/mobile/auth.ts` → `packages/runtime/src/mobile/handlers.ts`; routes in `routes/api/mobile/**`; the app in the private tree's `ios/` |
| What "Send test event" sends | `packages/domain/src/integrations/testEvent.ts` shapes it from the connection's own bindings; `cloud/hosted.ts` `ingestTestEvent` delivers it |
| Bind address, access token, "who may call this" | `packages/domain/src/security/serverAccess.ts` (rules) · `packages/runtime/src/security/accessToken.ts` (values + enforcement) · `apps/web/src/start.ts` (global middleware) · `scripts/start.ts` (bind) · `SECURITY.md` |
| Secrets at rest (local DB) | `packages/runtime/src/security/secretBox.ts` (`~/.openrun/data-key`); policy in the private tree's `SECRETS.md` |
| Open-core boundary (what is free vs. commercial) | `packages/domain/src/cloud/edition.ts` + its test · `COMMERCIAL-LICENSE.md` |
| Release pipeline: version maths, notes | `scripts/release/` (`semver.ts`, `conventional.ts`, `plan.ts`, `notes.ts`) — all pure, all tested; IO in `scripts/release/index.ts` over `io.ts`; runbook in `RELEASING.md` |
| Why CI rejected a PR title, or a missing changelog entry | `scripts/release/conventional.ts` (`validateCommitTitle`) → `scripts/check-title.ts`; `scripts/check-changelog.ts`; the `pr-title` workflow and the `changelog` job in `ci.yml` |
| Cutting a release, or why one did not publish | `RELEASING.md`; `.github/workflows/release-publish.yml` runs on a `v*` tag |
| Releasing the CLI to npm (independent of the app) | `RELEASING.md`; the `release` field in `apps/cli/package.json` (name, tag prefix, bundled paths) → `scripts/release/cli.ts` (pure) → `scripts/release/cliRelease.ts` (IO) → `scripts/package-cli.ts`; published by `.github/workflows/release-cli.yml` on a `cli-v*` tag |
| Licensing, contributing, disclosure | `LICENSE` (AGPLv3), `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`, `CLA.md` |
| Shared primitives (`Modal`, `StatusBadge`, `PageHeader`) | `apps/web/src/components/ui.tsx` |
| Design tokens | `apps/web/src/styles.css` — Tailwind v4, CSS custom properties, `color-scheme: dark` |
| Chat transcript themes (Open Run / Terminal) | `apps/web/src/lib/chatTheme.ts` (ids + what starts expanded) → `apps/web/src/features/chat/ChatThemeProvider.tsx` (`data-chat-theme` on `<html>`) → the `--chat-*` tokens and the `[data-chat-theme='terminal']` block in `styles.css`; toggle in `apps/web/src/features/chat/ChatDebugToggle.tsx` (Debug view in the run top-bar ⋯ menu). A theme is tokens — if a component hardcodes the look, tokenize it rather than branching on the theme in JSX |
| Start page and `/runs/new`: the draft a run begins from | `apps/web/src/features/chat/useNewRunDraft.ts` (all the wiring), `apps/web/src/features/chat/NewRunSurface.tsx` (the pickers around it), `apps/web/src/routes/index.tsx`, `apps/web/src/routes/runs.new.tsx`; `apps/web/src/features/chat/Composer.tsx` stays props-only |
| Automation shortcuts on the start page | `apps/web/src/lib/automationShortcuts.ts` (the templates) → `apps/web/src/features/automations/AutomationShortcuts.tsx`; seeded into the form by `apps/web/src/routes/tasks.new.tsx` via `?shortcut=` |
| Planner proposals → install automations | `packages/domain/src/tasks/planProposals.ts`; UI in `apps/web/src/features/automations/PlanProposalCard.tsx`, `PlanProposalsInChat.tsx`, `apps/web/src/routes/planner.tsx` |

Routes: `index.tsx` is the start page (composer + resume dropdown + automation
shortcuts) · `mcp.tsx` MCP servers · `tasks.index.tsx` /
`tasks.$taskId.tsx` / `tasks.new.tsx` automations · `runs.index.tsx` /
`runs.$runId.tsx` / `runs.new.tsx` · `integrations.tsx` /
`integrations.index.tsx` / `integrations.$provider.tsx` · `notifications.tsx` ·
`devices.tsx` · `runtimes.tsx` · `planner.tsx`.
Projects live in `apps/web/src/features/workspaces/ProjectsManager.tsx` (modal from the picker), not
a standalone route.

## Conventions

- **Tests** — `node:test` + `node:assert/strict`, colocated as `packages/domain/src/foo.test.ts` beside
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
a new rule module in `packages/domain/src/` carries a colocated `*.test.ts`; a new refuse
condition is mirrored in the matching gate module; `apps/web/src/routeTree.gen.ts` is
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

- Four more files are **generated** from `packages/contracts/src/operations.ts`: `apps/web/src/fns/index.ts`,
  `packages/contracts/src/generated/client.ts`, `packages/contracts/src/generated/openapi.json`, and
  `packages/apple/OpenRunKit/Sources/OpenRunKit/Generated.swift`. Never hand-edit them —
  run `pnpm contract:generate`. The generator formats its own output with Biome, so
  `pnpm lint:fix` and the generator cannot disagree.
- `apps/web/src/routeTree.gen.ts` is **generated**. Never hand-edit it, and don't resolve conflicts in
  it by hand — regenerate with **`pnpm build`** (or `pnpm dev`). The compatibility
  command `pnpm generate-routes` also runs the Vite build. Use the Vite plugin rather
  than the standalone router CLI so the `Register` block retains the `config` entry
  that types the `apps/web/src/start.ts` instance.
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
- The Planner nav entry is commented out in `apps/web/src/routes/__root.tsx`; the `/planner` route still
  exists and uses the same empty-projects gate as Automations.

# Contributing to Open Run

Thanks for looking. This project is unusual in one respect that will save you
time: **it is written to be worked on by coding agents as well as humans.** The
project map, the module boundaries and the hard rules are all written down, and
if you follow them your patch will land quickly.

## Before you write code

Read **[AGENTS.md](./AGENTS.md)** first. It is the single source of truth for
architecture, module boundaries and conventions, and it has a *"working on X?
read Y"* table that will point you at the two or three files you actually need.
Do not sweep the whole codebase; that file exists so you don't have to.

## Getting set up

```bash
pnpm install     # pnpm only — there is no npm lockfile
pnpm dev         # http://localhost:3000
```

Node 22+ and `pnpm` are required. Platform notes and first-run steps:
[openrun.sh/docs/install](https://openrun.sh/docs/install).

## Before you open a pull request

```bash
pnpm lint        # Biome — formatting and lint in one pass (pnpm lint:fix applies it)
pnpm typecheck   # tsc --noEmit — strict, plus noUnusedLocals/Parameters
pnpm architecture:check # package dependencies, exports and capability cycles
pnpm contract:check # regenerate and verify client artifacts
pnpm test        # node:test, no Vitest/Jest
pnpm build       # catches client/server bundle violations
```

All checks must pass. `pnpm build` matters more than it looks: the most common
way to break this project is a static import of `packages/runtime/src/*` from a route
component or from `apps/web/src/fns/index.ts`, which drags `better-sqlite3` and
`child_process` into the client bundle. Typecheck will not catch it; the build
will.

## The hard rules (short version)

These are in [AGENTS.md](./AGENTS.md) in full. A PR that breaks one will be sent
back, so they are worth knowing up front:

1. **`packages/runtime/src/**` is server-only.** UI routes reach it *only* through
   `apps/web/src/fns/index.ts`, where every handler imports `@openrun/runtime/contract/dispatch`
   **lazily**. Type-only runtime imports are fine; value imports in UI components are not.
2. **`packages/domain/src/**` is browser-safe, with no framework or platform IO.** No `node:` imports. The
   same rule module runs in the browser and on the server write path, so the UI
   can disable a control with the exact message the server would have thrown.
3. **Turn events speak ACP.** New agent output goes through an adapter in
   `packages/domain/src/chat/agentEvents/` that maps onto the shapes in `packages/domain/src/chat/acp.ts`. Do not
   invent a payload field that the Agent Client Protocol already names.
4. **`turn_events` rows are append-only and forward-compatible.** Every payload
   field is optional; readers tolerate `undefined` rather than assuming a
   backfill.
5. **`packages/runtime/src/core.ts` is the application facade.** Implement a capability
   in `application/`, export it from `core.ts`, add a contract descriptor, regenerate,
   and connect it in the web feature's `queries.ts`.
6. **A new refuse condition goes in the server path *and* the matching gate
   module** (`packages/domain/src/tasks/runPrereqGate.ts`, `enableGate.ts`, `runNowGate.ts`,
   `projectGate.ts`, `gitActionGate.ts`) — otherwise the UI and the server drift
   and the button lies.
7. **Never hand-edit `apps/web/src/routeTree.gen.ts`.** Run `pnpm build` to regenerate it.

## Conventions

- **Style is Biome's problem, not yours.** `biome.json` is the whole answer:
  single quotes, no semicolons, 100 columns. Run `pnpm lint:fix` and move on.
  The pre-push hook only checks; it never rewrites the working tree while a push
  is in progress.
  Two rule groups are switched off deliberately rather than silently: React's
  `useExhaustiveDependencies` / `noArrayIndexKey`, and most of the `a11y` group.
  Each needs per-site judgement, and turning them on across the existing UI is a
  standalone contribution we would welcome — one rule per PR, not all at once.
- **Tests** — `node:test` + `node:assert/strict`, colocated as
  `packages/domain/src/foo.test.ts` beside `foo.ts`. Pure `lib/` logic is what's covered:
  gates, cron, args templates, matchers. **A new rule module gets a colocated
  test.**
- **Import extensions** — relative source imports carry an explicit `.ts` or
  `.tsx` extension because `--experimental-strip-types` has no bundler resolution.
  Cross-package imports use declared `@openrun/...` exports.
- **Changelog** — add one markdown file to `changelog.d/`, written in the
  negative-relief voice the existing entries use: *"You no longer …"*. Describe
  what changed for a user, not what you refactored.
- **Commits** — `feat:` / `fix:` / `docs:` / `DX:`. One shippable slice per PR.

## Where to start

**Good first issues** are labelled on GitHub. Pick one and open a PR that
references it.

The highest-value contribution paths, in order:

1. **A new runtime adapter.** Adding support for another headless coding-agent
   CLI. A CLI is a fit only if it is non-interactive (prompt on stdin or a
   file, then exit). TUI-only agents and IDE extensions are out of scope. The
   four levels are: preset (`packages/domain/src/runtimes/runtimePresets.ts`), events
   (`packages/domain/src/chat/agentEvents/`), resume (`packages/runtime/src/execution/resume.ts`), models (`packages/domain/src/runtimes/models.ts`).
   Walkthrough: [openrun.sh/docs/adding-a-runtime](https://openrun.sh/docs/adding-a-runtime).
2. **A new webhook provider**, normalising onto the existing
   `CanonicalWebhookEvent`.
3. **Platform fixes** — Windows/WSL paths, `PATH` discovery, shell differences.
4. **Bug fixes with a colocated test.**

## What we will not merge

Not because the work is bad, but because it conflicts with what this project is.
Knowing this now is cheaper than finding out after you have written it:

- **Anything that puts a model API key into the product.** "No tokens, your own
  CLI logins" is the entire positioning. A PR that adds a direct model API call
  will be declined.
- **Anything that breaks the hard rules above.**
- **Multi-tenant authentication, hosted control planes, or team/seat
  management.** These belong to the commercial planes, not to this repository —
  see [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md) for where the line sits
  and why. Local single-user features are always welcome.
- **Rewrites.** Framework swaps, ORM introductions, or replacing `node:test`
  with a test framework.
- **IDE-agent runtimes** (Cursor, Windsurf, Continue). They are not clean
  unattended spawn CLIs; the mismatch is architectural, not a missing adapter.

If you are unsure whether an idea fits, open a Discussion before writing the
code. We would much rather talk for ten minutes than decline a finished branch.

## Contributor License Agreement

You will be asked to sign a [CLA](./CLA.md) before a first pull request is
merged. A bot comments on the PR with a link; it takes about a minute.

We ask for this because Open Run is dual-licensed: the code here is AGPLv3, and
we also offer it under commercial terms to organisations that cannot use AGPL
(see [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md)). That is only possible if
a single party can license the whole codebase. A DCO sign-off would leave
copyright distributed across every contributor and permanently foreclose it.

You keep the right to use your own contribution however you like. If the CLA is
a dealbreaker for you, open an issue describing the fix instead — a good bug
report is a real contribution.

## Governance

Decision-making is currently BDFL: the maintainer has the final call on scope and
design. That is a deliberate choice for a project this size — a committee ships
nothing at this stage — and it will change as the contributor base grows.

The roadmap is a public GitHub Project. Lanes marked *commercial* are built in a
private repository; everything else happens here in the open.

## Support boundary

- **Issues** are for bugs in Open Run and for roadmap work.
- **Discussions** are for setup help — "my webhook won't fire", "which
  runtime should I use", "how do I structure this prompt".

Please respect that split. It is the only way a small team keeps the issue
tracker usable. Setup friction reported in Discussions is read carefully; it
directly shapes what gets built next.

## Code of conduct

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

See [the architecture guide](docs/architecture.md) for package ownership, feature locations, and the steps for adding a capability. Run `pnpm architecture:check` and `pnpm contract:check` before opening a PR.

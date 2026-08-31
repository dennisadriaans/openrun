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
pnpm test        # node:test, no Vitest/Jest
pnpm build       # catches client/server bundle violations
```

All four must pass. `pnpm build` matters more than it looks: the most common
way to break this project is a static import of `src/server/*` from a route
component or from `src/fns/index.ts`, which drags `better-sqlite3` and
`child_process` into the client bundle. Typecheck will not catch it; the build
will.

## The hard rules (short version)

These are in [AGENTS.md](./AGENTS.md) in full. A PR that breaks one will be sent
back, so they are worth knowing up front:

1. **`src/server/**` is server-only.** UI routes reach it *only* through
   `src/fns/index.ts`, where every handler does `await import('../server/core')`
   **lazily**. Type-only imports from `server/*` are fine; value imports are not.
2. **`src/lib/**` is browser-safe and dependency-free.** No `node:` imports. The
   same rule module runs in the browser and on the server write path, so the UI
   can disable a control with the exact message the server would have thrown.
3. **Turn events speak ACP.** New agent output goes through an adapter in
   `src/lib/agentEvents/` that maps onto the shapes in `src/lib/acp.ts`. Do not
   invent a payload field that the Agent Client Protocol already names.
4. **`turn_events` rows are append-only and forward-compatible.** Every payload
   field is optional; readers tolerate `undefined` rather than assuming a
   backfill.
5. **`src/server/core.ts` is the only facade.** New server capability ⇒ export
   from `core.ts`, wrap in `fns/index.ts`, hook in `lib/queries.ts`.
6. **A new refuse condition goes in the server path *and* the matching gate
   module** (`lib/runPrereqGate.ts`, `enableGate.ts`, `runNowGate.ts`,
   `projectGate.ts`, `gitActionGate.ts`) — otherwise the UI and the server drift
   and the button lies.
7. **Never hand-edit `src/routeTree.gen.ts`.** Run `pnpm generate-routes`.

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
  `src/lib/foo.test.ts` beside `foo.ts`. Pure `lib/` logic is what's covered:
  gates, cron, args templates, matchers. **A new rule module gets a colocated
  test.**
- **Import extensions** — value imports in test-covered `lib/` modules carry an
  explicit `.ts` extension (`from './cron.ts'`), because
  `--experimental-strip-types` has no bundler resolution. Type-only imports and
  untested modules may omit it. Match the file you are editing.
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
   four levels are: preset (`lib/runtimePresets.ts`), events
   (`lib/agentEvents/`), resume (`server/resume.ts`), models (`lib/models.ts`).
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

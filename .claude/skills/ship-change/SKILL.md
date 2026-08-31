---
name: ship-change
description: Take a change from an issue or a request through to an open pull request that satisfies Open Run's CI gates — branch, conventional title, changelog fragment, test plan. Use when asked to implement an issue, ship a change, or open a PR in this repo.
---

# Shipping a change

Open Run releases itself from `main`. Every merged PR becomes one squash commit,
and those commits are what the release pipeline reads to compute the next
version. A PR that skips a gate does not just fail review — it corrupts the
release. Work in this order.

## 1. Never work on `main`

Branch first, named `<type>/<slug>` from the commit vocabulary:
`feat/bulk-run-delete`, `fix/turnstile-verify`. Never a tool-generated name.

`pnpm ship "feat(tasks): add bulk delete"` does the whole tail of this — branch
off `main` if needed, commit, push, open the PR from the repo template — and
refuses a title CI would reject, before pushing anything.

## 2. Read `AGENTS.md` before touching a file

It holds the module boundaries most review comments come from. The two that
catch people most often:

- `src/server/**` is server-only; UI reaches it through `src/fns/index.ts` with
  a **lazy** `await import()`.
- `src/lib/**` is browser-safe and dependency-free — no `node:` imports. Value
  imports in test-covered `lib/` modules carry an explicit `.ts` extension.

## 3. One shippable slice

One PR, one idea, one changelog entry. If the work splits into two sentences a
user would care about separately, it is two PRs.

## 4. The title is the commit

`main` takes squashed PRs only and the squash uses the PR **title** verbatim, so
the title is what lands and what the release reads. It must be a conventional
commit: `type(scope): summary`, lowercase imperative, no trailing period,
**≤ 60 characters**. The type decides the release:

| Type | Effect on the next release |
| --- | --- |
| `feat` | minor |
| `fix`, `perf`, `revert` | patch |
| `refactor`, `docs`, `test`, `build`, `ci`, `chore` | none |
| any type with `!` | breaking — held at minor below 1.0, and reported |

Pick the type by what the change *does for a user*, not by how the diff looks. A
bug fix implemented as a refactor is still `fix`.

## 5. A rule module gets a colocated test

New logic in `src/lib/` carries `foo.test.ts` beside `foo.ts`, using `node:test`
and `node:assert/strict`. No Vitest, no Jest.

## 6. A user-facing change carries a changelog entry

`feat`, `fix`, `perf`, `revert` and anything breaking need a `changelog.d/*.md`
fragment, or CI fails the `changelog entry` check. Use the **changelog-entry**
skill to write it — the negative-relief voice is not optional.

## 7. Verify before you push

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

`pnpm build` regenerates `src/routeTree.gen.ts`; commit it if it changed, never
hand-edit it.

## 8. The PR body is three sections

`## Summary` bullets from a user's point of view, bare `Closes #N` lines under
them, then `## Test plan` as unchecked boxes a reviewer can actually perform.
Not the CI list — CI already runs the tests.

## Never credit an agent

No commit, title, body, branch name, or changelog entry mentions Claude, Codex,
Cursor, Copilot or any other assistant — no co-author trailers, no "Generated
with" footers, no session links. This is a hard rule in `AGENTS.md`.

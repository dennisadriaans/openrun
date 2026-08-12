<!--
Thanks for contributing. Read AGENTS.md first if you haven't — it holds the
module boundaries and hard rules that most review comments come from.
-->

## What this changes

<!-- One or two sentences, from a user's point of view. -->

## Why

<!-- The problem. Link the GitHub issue if there is one. -->

Closes #

## How it works

<!-- Only if the approach isn't obvious from the diff. Note anything you
     considered and rejected. -->

## Checks

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes (catches server code leaking into the client bundle)
- [ ] Added a `changelog.d/` entry in the existing negative-relief voice
      ("You no longer …"), or this change is not user-facing
- [ ] New rule module in `src/lib/` has a colocated `*.test.ts`
- [ ] New refuse condition is mirrored in the matching gate module, so the UI
      disables and explains instead of failing after the click
- [ ] `src/routeTree.gen.ts` was regenerated with `pnpm generate-routes`, not
      hand-edited (or is untouched)

## Scope

- [ ] This runs entirely on the user's machine (no new hosted dependency, no
      model API key, no multi-tenant state)

## Testing

<!-- What you actually ran. Which runtime, which OS. Screenshots for UI. -->

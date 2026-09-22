# thinking-orbs (vendored)

Verbatim copy of `src/` from [Jakubantalik/thinking-orbs](https://github.com/Jakubantalik/thinking-orbs)
v0.3.1 (MIT, see `LICENSE`) — demo at https://orbs.jakubantalik.com.

Vendored instead of installed so the orbs ship with the repo and can be tuned
in place. `engine/index.ts` (the package's secondary entry point) is dropped;
import from `./index.ts`.

Do not reformat: kept byte-identical to upstream so it can be re-synced with a
plain diff. Excluded from biome and `scripts/lint-comments.ts`.

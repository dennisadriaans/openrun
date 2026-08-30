You no longer have to guess this project's house style before opening a pull
request — `pnpm lint` (Biome) checks formatting and lint in one pass, `pnpm
lint:fix` applies it, supported editors fix files on save, and the pre-push hook
no longer rewrites files implicitly. CI runs the same check. Buttons that sat inside the
automation form without an explicit `type` no longer submit that form when you
click them.

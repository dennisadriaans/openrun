You no longer need a C++ toolchain to install on Windows. `pnpm install` uses
the prebuilt better-sqlite3 binary that already ships in the package, so it no
longer dies when node-gyp cannot detect Visual Studio 2026. `pnpm test` no
longer shells out to `find`, so it runs on Windows cmd as well. A verification
check that times out on Windows now kills the whole process tree, and spawning
an agent with extra env (for example fx's `FX_MODEL`) no longer drops `PATH`.

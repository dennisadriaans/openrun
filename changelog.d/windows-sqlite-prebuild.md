You no longer need a C++ toolchain to install on Windows. `pnpm install` uses
the prebuilt better-sqlite3 binary that already ships in the package, so it no
longer dies when node-gyp cannot detect Visual Studio 2026.

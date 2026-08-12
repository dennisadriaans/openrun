You no longer find Claude Code missing from the model picker on an automation
just because your database predates the other builtin runtimes. Runtimes had
been listed by `createdAt`, so a database that seeded Gemini first and only
backfilled Claude, Codex and Grok on a later boot floated Gemini to the top —
and the default runtime, along with the model list in step 1, followed it. A
fresh install ordered them correctly, which is why this only showed up on
long-lived machines. Runtimes now sort by their preset order, so every install
opens on the same first runtime and user-added runtimes still sort after the
builtins.

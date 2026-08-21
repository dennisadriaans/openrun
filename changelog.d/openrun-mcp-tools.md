- The agent can now ask Open Run what it is doing. A built-in MCP server —
  one click to install from the MCP page — offers `run_context` (which
  automation started this run, which workspace and branch, which verification
  checks will judge it), `changed_files` (against the commit the run started
  from, not the last commit) and `recent_runs`. Read-only, and scoped to the
  run that spawned it.

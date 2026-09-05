You no longer lose unsaved file edits when the browser refreshes workspace data
or when an earlier save finishes. Saving also refreshes the workspace diff.

You no longer need to reload when a live connection stalls before opening, and
continuous activity no longer postpones list updates indefinitely.

You no longer install unused React devtools and the standalone router CLI. Setup
now specifies Node 22.12+, route generation uses the same Vite build as CI, and
development flags work after pnpm's `--` separator.

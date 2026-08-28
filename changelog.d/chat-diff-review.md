You no longer hunt a per-file row in the run transcript to inspect what the
agent changed. Each edit lands in the response as a Cursor-style change card
(icon, filename, +/−, hunk) with **Undo** to restore that file. After Undo the
card fades and **Redo** puts the change back. The composer files card stays
collapsed until you open it and sits on the input like a tab. **Review** — or
the filename on a change block — opens a fullscreen diff, where **Undo** on a
hunk reverses just that patch the way `git apply -R` does.

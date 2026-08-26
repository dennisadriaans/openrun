A new automation no longer defaults to the checkout your editor has open. The
project picker now reaches for a ready worktree under `~/.openrun` first and
only falls back to the main checkout when the project has no worktree yet — and
says so on the form when it does, so an unattended run never lands in your open
files without warning you.

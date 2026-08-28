Undo All no longer leaves the agent's commits behind. When a run committed,
the dialog now lists those commits and offers to move the branch back to where
the run found it, so the files and `git log` stop disagreeing. It refuses once
a commit has reached a remote — that would be rewriting published history — and
the reset keeps changes you had in flight before the run, which a
`git reset --hard` would have taken with it. Dropped commits stay in your
reflog, and the dialog tells you which commit the branch went back to.

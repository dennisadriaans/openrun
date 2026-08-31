You no longer decide when Open Run releases, or what the next version is. Merged
pull request titles are the release metadata: `feat` makes a minor, `fix` and
`perf` make a patch, and a week of only docs and chores makes no release at all
rather than a meaningless patch. On the configured cadence — weekly on Monday by
default, set in `release` in `package.json` — a release pull request opens by
itself with the version bumped, `changelog.d/` folded into `CHANGELOG.md`, and
the notes written; merging it tags the commit and publishes the GitHub Release.

You also no longer find out at review time that a pull request title was not a
conventional commit, or that a user-facing change shipped with no changelog
entry. Both are checks now, and both run the same rules `pnpm ship` runs before
it pushes. `pnpm release:plan` prints what the next release would be without
writing anything.

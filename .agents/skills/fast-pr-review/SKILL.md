---
name: fast-pr-review
description: Review pull requests for actionable defects and provide brief, natural developer comments. Use when asked to review a PR, diff, branch, or proposed code change.
---

# Fast PR Review

Read the applicable repository instructions, the complete diff, and enough surrounding code to judge whether the change introduces a correctness, regression, security, compatibility, or repository-rule problem.

Comment only when the author can take a useful action. Do not invent findings, summarize the change, restate code, narrate successful checks, or make obvious observations. Skip comments such as “TypeScript is OK,” “typecheck passes,” and “tests pass.”

Write like a developer reviewing quickly:

- Keep each comment to one or two short sentences.
- State a defect and its consequence directly. Add a fix direction only when it helps.
- Prefix a genuinely useful optional suggestion with `Nitpick:`.
- Consolidate comments with the same root cause.
- If there are no actionable findings, say only `Looks good to me.`

Do not add headings, scorecards, a diff summary, or a verification summary. Do not post, approve, or otherwise mutate a pull request unless the user explicitly asks.

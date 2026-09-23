/**
 * What happens to a composer draft when a send is refused.
 *
 * The box empties the moment you hit send, because waiting on the round-trip
 * makes every message feel slow. That optimism is only safe if a refusal puts
 * the text back: the reasons a send fails — the workspace directory is gone,
 * the branch already has a run, the CLI is not on PATH — are all things you
 * fix and then retry with exactly the words you already typed. Losing them is
 * the worst possible outcome of an error the user did nothing to cause.
 *
 * Browser-safe and dependency-free so the rule is testable on its own, and so
 * the composer holds the wiring rather than the policy.
 */

/**
 * The draft to show after a refused send, given what was sent and whatever is
 * in the box now.
 *
 * A refusal can land long after the send — the user may already be typing the
 * next thing. Their newer text always wins; restoring over it would throw away
 * input for a second time. Only a box that is empty (or whitespace) gets the
 * refused prompt back.
 */
export function draftAfterRefusal(sentText: string, currentText: string): string {
  return currentText.trim() ? currentText : sentText
}

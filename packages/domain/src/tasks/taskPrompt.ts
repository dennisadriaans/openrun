/**
 * Automation prompt helpers shared by TaskForm (browser) and upsertTask
 * (server). Kept dependency-free so the client never pulls SQLite / executor
 * modules. An empty or whitespace-only prompt used to save as a runnable
 * automation that did nothing useful on Run now.
 */

/** Trim; empty means "no instructions for the agent". */
export function normalizeTaskPrompt(prompt: string | null | undefined): string {
  return (prompt ?? '').trim()
}

/** Whether an automation has a non-empty prompt after trim. */
export function hasTaskPrompt(prompt: string | null | undefined): boolean {
  return normalizeTaskPrompt(prompt).length > 0
}

/**
 * Developer-facing error when Create / Save / Enable / Run now would proceed
 * with a blank prompt (including legacy rows saved before the Create gate).
 */
export function emptyTaskPromptMessage(): string {
  return 'Add agent instructions before saving or running this automation. An empty prompt would run the CLI with nothing to do.'
}

/** Throw when the prompt is blank; returns the trimmed value for persistence. */
export function assertTaskPrompt(prompt: string | null | undefined): string {
  const text = normalizeTaskPrompt(prompt)
  if (!text) throw new Error(emptyTaskPromptMessage())
  return text
}

/**
 * Args-template helpers shared by the Runtimes page (browser) and the
 * runtime write-path / spawn path (server). Kept dependency-free so the
 * client never pulls server modules; a template must be a JSON array of
 * strings (with optional `{prompt}` / `{cwd}` tokens).
 */

/** Developer-facing error for a rejected args template. */
export function invalidArgsTemplateMessage(raw: string): string {
  const preview = raw.trim().length > 80 ? `${raw.trim().slice(0, 77)}…` : raw.trim()
  return `Invalid args template${preview ? ` "${preview}"` : ''}. Use a JSON array of strings, e.g. ["-p", "--output-format", "stream-json"], with optional {prompt} / {cwd} tokens.`
}

/**
 * Parse a runtime args template into a string array.
 * Throws when the value is not valid JSON, not an array, or contains a
 * non-string element — never silently coerces to `[]`.
 */
export function parseArgsTemplate(raw: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(invalidArgsTemplateMessage(raw))
  }

  if (!Array.isArray(parsed)) {
    throw new Error(invalidArgsTemplateMessage(raw))
  }

  if (!parsed.every((item): item is string => typeof item === 'string')) {
    throw new Error(invalidArgsTemplateMessage(raw))
  }

  return parsed
}

/** Throw when `raw` is not a JSON string array. */
export function assertArgsTemplate(raw: string): void {
  parseArgsTemplate(raw)
}

/** True when `raw` is a JSON array of strings. */
export function isValidArgsTemplate(raw: string): boolean {
  try {
    parseArgsTemplate(raw)
    return true
  } catch {
    return false
  }
}

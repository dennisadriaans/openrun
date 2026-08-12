/**
 * Detect CLI args that request human-readable text instead of JSONL.
 * Planner Grok uses `--output-format plain` and Gemini's headless preset uses
 * the short `-o text`; those runs must not line-split stdout into per-line turn
 * events, or the transcript becomes one `raw` pill per line of prose.
 */
export function isPlainCliOutput(args: string[]): boolean {
  const idx = args.findIndex((a) => a === '--output-format' || a === '-o')
  if (idx < 0) return false
  const value = args[idx + 1]
  return value === 'plain' || value === 'text'
}

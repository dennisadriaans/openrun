- The model picker no longer lags behind your CLI. Open Run reads the models
  your *installed* `claude`, `grok` and `agy` actually offer and caches them, so
  a CLI update puts the new model in the composer on the next page load — no
  waiting for an Open Run release, and nothing to configure. The list you get is
  the CLI's own: its display names, its default model preselected, and only the
  effort levels each model really accepts.
- Choosing a model no longer costs you a spinner. Discovery runs in the
  background against a fingerprint of the binary, so the composer reads a cached
  row and renders immediately; a fresh clone shows a built-in list at once and
  the real one moments later.
- Effort levels are no longer offered where the CLI would reject them. Haiku,
  which takes no `--effort`, stops pretending to.
- Antigravity (`agy`) is no longer invisible. It ships as a runtime preset with
  its own models, tool calls, access modes and follow-up turns, alongside Claude
  Code, Codex, Grok and Gemini.
- The model dropdown is no longer a list you have to re-skim past models you
  stopped using. Hover any model and hide it; the picker keeps a "N hidden"
  footer to bring them back. Hiding is display-only and never traps you — the
  model a run is already on stays visible, and hiding everything falls back to
  the full list.

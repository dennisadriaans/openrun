- The run transcript no longer has to look like a chat app. A theme picker in the run top bar switches it between **Open Run** (bubbles, icons, folded work) and **Terminal** — monospace throughout, the user's prompt as a full-width `>` line instead of a bubble, `●` and `⎿` markers in place of icons and cards, shell output printed inline the way `claude` and `codex exec` print it, and a finished turn replayed in full rather than hidden behind "Worked for 15s". The choice is remembered per browser and applied before first paint.
- Command output in the Terminal theme is no longer flat grey. Colors a tool
  printed itself are honoured instead of being swallowed (or leaking escape
  codes into the transcript), and output captured without a TTY — the usual
  case — is painted anyway: failures red, warnings yellow, passes green, diff
  sides green and red, and file paths and URLs picked out of ordinary lines.
  The Open Run theme prints output unpainted as before.
- The transcript switcher is a Debug button in the run top bar rather than a
  theme menu: on for the terminal transcript, off for the ordinary chat UI.
- Terminal output is painted from a purpose-built 16-slot ANSI palette instead
  of borrowed accent colors. Every regular slot sits at one perceptual
  lightness so no hue shouts over its neighbours, each clears 7:1 against the
  transcript background, and the bright slots are the same hue lifted — so a
  program that colors its own output looks the way it does in your terminal.
- Output in the debug view is no longer one flat grey when a tool prints no
  colors of its own — which is most of the time, since a CLI captured without a
  terminal attached drops them. Strings, numbers, keys, flags, paths, URLs,
  booleans and JSON keys are picked out of plain text, on top of the existing
  error / warning / pass / diff line colors.
- The debug view carries a palette picker: Open Run's own AAA-contrast scheme
  plus Nord, Dracula, Catppuccin Mocha, Gruvbox Dark, One Dark, Tokyo Night and
  Solarized Dark, each painted on the background its author drew it against.

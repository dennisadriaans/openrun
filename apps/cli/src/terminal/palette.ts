/**
 * Match the web workspace: styles.css supplies the accent, status and CodeMirror
 * colors; ProviderIcons.tsx supplies the runtime logo colors.
 */
const color = (value: string): string => (process.env.NO_COLOR === undefined ? value : '#ffffff')

export const colors = {
  background: 'transparent',
  input: '#181818',
  text: color('#f0f0f0'),
  secondary: color('#c2c2c2'),
  muted: color('#999999'),
  border: color('#333333'),
  info: color('#599ce7'),
  healthy: color('#70b489'),
  warning: color('#f1b467'),
  failure: color('#fc6b83'),
  keyword: color('#82d2ce'),
  string: color('#e394dc'),
  function: color('#efb080'),
  number: color('#ebc88d'),
  link: color('#87c3ff'),
  claude: color('#d97757'),
  gemini: color('#c58af9'),
  button: color('#599ce7'),
  buttonText: '#181818',
}

export function statusColor(status: string): string {
  if (/\b(failed|error|blocked)\b/i.test(status)) return colors.failure
  if (/\b(completed|succeeded|success)\b/i.test(status)) return colors.healthy
  if (/\b(queued|pending|paused|cancelled|canceled|attention)\b/i.test(status))
    return colors.warning
  if (/\b(scheduled)\b/i.test(status)) return colors.string
  return colors.info
}

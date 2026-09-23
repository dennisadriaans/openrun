/**
 * One-click starting points for a scheduled automation.
 *
 * Same idea as `integrations/recipes.ts`, minus the webhook: a name, a prompt
 * and a schedule so the start page can hand `/tasks/new` a filled form instead
 * of a blank one. Templates, not black boxes — everything stays editable, and
 * the automation is created disabled so nothing fires before it is reviewed.
 */

export type AutomationShortcutId =
  | 'review-open-prs'
  | 'fix-failing-checks'
  | 'update-dependencies'
  | 'triage-issues'
  | 'cover-untested'
  | 'refresh-docs'

export type AutomationShortcut = {
  id: AutomationShortcutId
  /** Leading word of the suggestion row, shown in full contrast. */
  verb: string
  /** The rest of the sentence, shown muted after the verb. */
  line: string
  /** Name for the automation row. */
  automationName: string
  prompt: string
  /** Seed schedule; the form still asks for confirmation. */
  cron: string
  /** Icon key resolved by the UI — this module stays dependency-free. */
  icon: 'review' | 'checks' | 'deps' | 'triage' | 'tests' | 'docs'
}

export const AUTOMATION_SHORTCUTS: AutomationShortcut[] = [
  {
    id: 'review-open-prs',
    verb: 'Review',
    line: 'the open pull requests every morning and leave a short review',
    automationName: 'Review open pull requests',
    icon: 'review',
    cron: '0 9 * * *',
    prompt: [
      'List the open pull requests on this repository with `gh pr list`.',
      '',
      'For each one that has no review yet, read the diff and write a short review:',
      'correctness bugs first, then anything that is clearly simpler to express.',
      'Skip style nits the formatter already owns.',
      '',
      'Do not push commits and do not merge anything.',
    ].join('\n'),
  },
  {
    id: 'fix-failing-checks',
    verb: 'Fix',
    line: 'whatever the project’s tests, typecheck or lint turn up',
    automationName: 'Fix failing checks',
    icon: 'checks',
    cron: '0 8 * * 1-5',
    prompt: [
      'Run this project’s verification checks (tests, typecheck, lint).',
      '',
      'If everything passes, stop and say so — do not change files.',
      'If something fails, fix the smallest cause you can find and re-run the',
      'checks until they pass. Leave the tree ready to review.',
    ].join('\n'),
  },
  {
    id: 'update-dependencies',
    verb: 'Update',
    line: 'dependencies once a week and re-run the checks',
    automationName: 'Update dependencies',
    icon: 'deps',
    cron: '0 9 * * 1',
    prompt: [
      'Check for outdated dependencies in this workspace.',
      '',
      'Apply patch and minor updates only. Leave majors alone and list them at',
      'the end instead. After updating, install and run the project’s checks;',
      'revert any single update that breaks them and report which one it was.',
    ].join('\n'),
  },
  {
    id: 'triage-issues',
    verb: 'Triage',
    line: 'the issues opened since yesterday and say what each one needs',
    automationName: 'Triage new issues',
    icon: 'triage',
    cron: '0 10 * * 1-5',
    prompt: [
      'List the issues opened in the last day with `gh issue list`.',
      '',
      'For each one, find the code it concerns and write two or three lines:',
      'what the reporter is describing, which files are involved, and whether it',
      'looks like a bug, a question, or a feature request.',
      '',
      'Do not change any files.',
    ].join('\n'),
  },
  {
    id: 'cover-untested',
    verb: 'Cover',
    line: 'one untested module a week with tests in the local style',
    automationName: 'Cover untested logic',
    icon: 'tests',
    cron: '0 9 * * 3',
    prompt: [
      'Find one module in this project whose logic carries real rules and has no',
      'colocated test.',
      '',
      'Write tests for it in the style the neighbouring tests already use — same',
      'runner, same assertions, same file naming. Cover the edge cases, not only',
      'the happy path, and run them before finishing.',
    ].join('\n'),
  },
  {
    id: 'refresh-docs',
    verb: 'Refresh',
    line: 'the docs that drifted from what the code does today',
    automationName: 'Refresh the docs',
    icon: 'docs',
    cron: '0 9 * * 5',
    prompt: [
      'Compare this project’s documentation against what the code actually does',
      'today — commands, flags, file paths, and route names.',
      '',
      'Fix the lines that are wrong and delete the ones describing something that',
      'no longer exists. Do not rewrite prose that is still accurate.',
    ].join('\n'),
  },
]

export function isAutomationShortcutId(value: string): value is AutomationShortcutId {
  return AUTOMATION_SHORTCUTS.some((shortcut) => shortcut.id === value)
}

export function automationShortcut(id: string | undefined): AutomationShortcut | undefined {
  if (!id) return undefined
  return AUTOMATION_SHORTCUTS.find((shortcut) => shortcut.id === id)
}

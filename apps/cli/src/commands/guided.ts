/** Interactive choices only. Execution still goes through the shared contract. */
import { execFileSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { parseChecks, MAX_CHECK_COMMAND_CHARS } from '@openrun/domain/runs/checks'
import {
  resolveRuntime,
  resolveWorkspace,
  type RuntimeChoice,
  type WorkspaceChoice,
} from './cliResolve.ts'
import {
  deriveTaskName,
  parseCliSchedule,
  parseClockTime,
  type CliIntent,
  type CliSchedule,
} from './cliSchedule.ts'
import { isValidCron } from '@openrun/domain/tasks/cron'
import { pickDefaultRuntime } from '@openrun/domain/runtimes/pickRuntime'
import { RUNTIME_PRESETS } from '@openrun/domain/runtimes/runtimePresets'
import { formatNextRunLabel, formatScheduledRunLabel } from '@openrun/domain/tasks/schedule'
import type { CliClient } from '../runtime/local.ts'
import { editableCommand, splitCommandLine } from './args.ts'
import { backTo, Cancelled, steps, type FlowUi } from '../terminal/ui.ts'

type Project = { id: string; path: string; checks: string }

export async function registerProject(
  client: CliClient,
  directory: string,
  remote: boolean,
  ui: FlowUi,
): Promise<Project> {
  let path = directory
  for (;;) {
    let problem = ''
    if (remote) {
      if (!isAbsolute(path)) problem = 'Enter an absolute repository path on the server.'
    } else {
      try {
        path = execFileSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: resolve(path),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim()
      } catch {
        problem = `Could not find a Git checkout at ${resolve(path)}.`
      }
    }
    if (!problem) break
    if (!ui.interactive)
      throw new Error(`${problem} Run "openrun init" inside an existing checkout.`)
    ui.info(problem)
    path = await ui.text(
      remote ? 'Repository path on the server' : 'Path to your Git repository',
      path,
    )
  }
  const projects = (await client.call('projects.list')) as Project[]
  const existing = projects.find((project) => project.path === path)
  if (existing) return existing
  return (await client.call('projects.add', { mode: 'register', path })) as Project
}

export async function selectRuntime(
  client: CliClient,
  hint: string,
  ui: FlowUi,
  allowConfigure = true,
): Promise<RuntimeChoice> {
  for (;;) {
    const rows = (await client.call('runtimes.list')) as RuntimeChoice[]
    const resolved = resolveRuntime(hint, rows)
    if (!ui.interactive) {
      if (!resolved.ok) throw new Error(resolved.error)
      return resolved.value
    }
    const available = rows.filter(
      (r) => r.installed !== false && r.enabled !== false && r.enabled !== 0,
    )
    if (!available.length) {
      ui.note(
        'Install and sign in to an agent CLI, then return here.\nEnabled agents: ' +
          (rows
            .filter((r) => r.enabled)
            .map((r) => r.bin)
            .join(', ') || 'none; configure one with openrun runtimes'),
        'Set up an agent',
      )
      const next = await ui.select('Ready to check again?', [
        { value: 'check', label: 'Check available agents again' },
        ...(allowConfigure ? [{ value: 'configure', label: 'Enable or configure an agent' }] : []),
        { value: 'exit', label: 'Leave setup' },
      ])
      if (next === 'exit') throw new Cancelled('Setup left for later.')
      if (next === 'configure') {
        const selected = await backTo(() => manageRuntimes(client, ui))
        if (selected) hint = selected.id
      }
      continue
    }
    if (hint && !resolved.ok) ui.info(resolved.error)
    const initial = resolved.ok
      ? resolved.value
      : pickDefaultRuntime(available, ui.preferredRuntime)!
    const id = await ui.select(
      'Which agent? Enter to confirm · ↑↓ to change',
      available.map((r) => ({
        value: r.id,
        label: r.label || r.bin,
        hint: `${r.bin}${r.id === ui.preferredRuntime ? ' · last used' : ''}`,
      })),
      initial.id,
    )
    return available.find((r) => r.id === id)!
  }
}

export async function manageRuntimes(
  client: CliClient,
  ui: FlowUi,
): Promise<RuntimeChoice | undefined> {
  for (;;) {
    const rows = (await client.call('runtimes.list')) as (RuntimeChoice & Record<string, unknown>)[]
    const id = await ui.select(
      'Your agents',
      [
        ...rows.map((row) => ({
          value: row.id,
          label: row.label || row.bin,
          hint: !row.enabled ? 'disabled' : row.installed === false ? 'not on PATH' : 'available',
        })),
        { value: ':add', label: 'Add an agent preset' },
        { value: ':exit', label: 'Done' },
      ],
      pickDefaultRuntime(
        rows.filter((r) => r.installed && r.enabled),
        ui.preferredRuntime,
      )?.id,
    )
    if (id === ':exit') return
    const selected = await backTo(async () => {
      if (id === ':add') {
        const presets = RUNTIME_PRESETS.filter(
          (preset) => !rows.some((row) => row.id === preset.id),
        )
        if (!presets.length) {
          ui.info('All built-in presets are already configured. Choose an agent to enable it.')
          return
        }
        const presetId = await ui.select(
          'Which preset?',
          presets.map((preset) => ({ value: preset.id, label: preset.label, hint: preset.bin })),
        )
        const preset = presets.find((row) => row.id === presetId)!
        if (await ui.confirm(`Add ${preset.label}?`)) {
          await client.call('runtimes.save', {
            ...preset,
            argsTemplate: JSON.stringify(preset.argsTemplate),
            enabled: true,
          })
          ui.info(
            `${preset.label} added. Its CLI must be installed and signed in on the worker’s machine.`,
          )
        }
        return
      }
      const runtime = rows.find((row) => row.id === id)!
      const canUse =
        runtime.enabled !== 0 && runtime.enabled !== false && runtime.installed !== false
      const action = await ui.select(
        runtime.label || runtime.bin,
        [
          ...(canUse
            ? [
                {
                  value: 'default',
                  label: 'Use as my default agent',
                  hint: 'preselected on future runs',
                },
              ]
            : []),
          { value: 'toggle', label: runtime.enabled ? 'Disable agent' : 'Enable agent' },
          { value: 'back', label: 'Done' },
        ],
        canUse ? 'default' : runtime.enabled ? 'back' : 'toggle',
      )
      if (action === 'default') return runtime
      if (action === 'toggle') {
        await client.call('runtimes.save', {
          ...runtime,
          enabled: !runtime.enabled,
          promptViaStdin: Boolean(runtime.promptViaStdin),
          canOpenPrs: Boolean(runtime.canOpenPrs),
        })
        ui.info(`${runtime.label} ${runtime.enabled ? 'disabled' : 'enabled'}.`)
      }
      if (runtime.installed === false)
        ui.info(
          `Install and sign in to ${runtime.bin} on the worker’s machine, then run openrun runtimes again.`,
        )
    })
    if (selected) return selected
  }
}

export async function selectWorkspace(
  client: CliClient,
  hint: string,
  ui: FlowUi,
  { remote = false, force = false, dryRun = false } = {},
): Promise<WorkspaceChoice> {
  const rows = (await client.call('workspaces.list', {})) as WorkspaceChoice[]
  // A local cwd must never silently choose a workspace on a remote machine.
  const resolved = resolveWorkspace(hint, remote ? '' : process.cwd(), rows)
  if (resolved.ok && (!force || !ui.interactive)) return resolved.value
  if (!ui.interactive) throw new Error(resolved.ok ? 'Choose a workspace.' : resolved.error)
  if (hint && !resolved.ok) ui.info(resolved.error)
  const available = rows.filter((row) => row.status !== 'archived')
  if (!available.length && dryRun)
    ui.info(
      'A preview needs a registered workspace. Set one up with openrun init, then preview again.',
    )
  const id = await ui.select(
    'Where should the agent work?',
    [
      ...(!dryRun
        ? [
            {
              value: ':register',
              label: remote ? 'Register a repository on the server' : 'Use this repository',
              hint: remote ? 'enter its absolute path' : process.cwd(),
            },
          ]
        : []),
      ...available.map((row) => ({
        value: row.id,
        label: `${row.projectName || row.name} · ${row.branch || row.name}`,
        hint: row.path,
      })),
      { value: ':exit', label: 'Leave setup' },
    ],
    resolved.ok ? resolved.value.id : remote && available.length ? available[0]!.id : undefined,
  )
  if (id === ':exit') throw new Cancelled('No run created.')
  if (id !== ':register') return available.find((row) => row.id === id)!
  const selected = await backTo(async () => {
    const directory = await ui.text(
      remote ? 'Repository path on the server' : 'Repository path',
      remote ? '' : process.cwd(),
    )
    const project = await registerProject(client, directory, remote, ui)
    ui.info(`Project ready: ${project.path}`)
    return selectWorkspace(client, project.path, ui, { remote, dryRun })
  })
  return selected ?? selectWorkspace(client, hint, ui, { remote, dryRun, force: true })
}

/** Offer the missing prerequisite in place; never invent a check that always passes. */
export async function ensureProjectChecks(
  client: CliClient,
  workspace: WorkspaceChoice,
  ui: FlowUi,
): Promise<void> {
  if (!ui.interactive) return
  const projects = (await client.call('projects.list')) as Project[]
  const projectId = (workspace as WorkspaceChoice & { projectId?: string }).projectId
  const project = projects.find((row) => row.id === projectId || row.path === workspace.path)
  if (!project || parseChecks(project.checks).length) return
  ui.info('Scheduled work needs a verification command. It runs after the agent finishes.')
  const command = await ui.text('Project check (for example: npm test)', '', (value) =>
    value.length > MAX_CHECK_COMMAND_CHARS
      ? `Keep the command under ${MAX_CHECK_COMMAND_CHARS} characters.`
      : undefined,
  )
  await client.call('projects.update', {
    id: project.id,
    checks: [{ id: 'cli-check-1', name: command.slice(0, 60), command }],
  })
}

export async function chooseSchedule(
  ui: FlowUi,
  remote = false,
  current?: CliSchedule,
): Promise<CliSchedule> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  ui.info(
    `${remote ? `One-time dates use ${zone}; repeating schedules use the server’s timezone.` : `Times use ${zone}.`} Keep the worker running and the machine awake.`,
  )
  for (;;) {
    const choice = await ui.select('When should it run?', [
      ...(current && current.kind !== 'now'
        ? [{ value: ':keep', label: 'Keep current schedule', hint: timing(current, remote) }]
        : []),
      { value: 'tomorrow', label: 'Tomorrow morning', hint: 'once · 09:00' },
      { value: 'in', label: 'In a little while', hint: 'once · 20 minutes' },
      { value: 'at', label: 'At a specific time', hint: 'once · next occurrence' },
      { value: 'weekday', label: 'Every weekday', hint: '09:00 · Monday–Friday' },
      { value: 'day', label: 'Every day', hint: '09:00' },
      { value: 'week', label: 'Every week', hint: 'choose a day and time' },
      { value: 'interval', label: 'At an interval', hint: 'every 15 minutes' },
      { value: 'cron', label: 'Custom cron expression' },
    ])
    if (choice === ':keep' && current) return current
    const result = await backTo(async () => {
      let words: string[]
      if (choice === 'cron') {
        const cron = await ui.text('Cron expression', '0 9 * * 1-5', (value) =>
          isValidCron(value) ? undefined : 'Use a valid cron expression, such as 0 9 * * 1-5.',
        )
        return { kind: 'recurring' as const, cron }
      }
      if (choice === 'in' || choice === 'interval') {
        const expression = await ui.text(
          choice === 'in' ? 'How long from now?' : 'How often?',
          choice === 'in' ? '20 minutes' : '15 minutes',
          (value) => {
            const parsed = parseCliSchedule(
              [choice === 'in' ? 'in' : 'every', ...value.split(/\s+/)],
              new Date(),
              { allowEmptyPrompt: true },
            )
            return !parsed.ok
              ? parsed.error
              : parsed.intent.prompt || parsed.intent.schedule.kind === 'now'
                ? 'Enter a duration, such as 20 minutes or 2 hours.'
                : undefined
          },
        )
        words = [choice === 'in' ? 'in' : 'every', ...expression.split(/\s+/)]
      } else {
        let day = choice
        let time = '09:00'
        await steps([
          ...(choice === 'week'
            ? [
                async () => {
                  day = await ui.select(
                    'Which day?',
                    [
                      'monday',
                      'tuesday',
                      'wednesday',
                      'thursday',
                      'friday',
                      'saturday',
                      'sunday',
                    ].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
                    day === 'week' ? 'monday' : day,
                  )
                },
              ]
            : []),
          async () => {
            time = await ui.text('What time?', time, (value) =>
              parseClockTime(value) ? undefined : 'Enter a time, such as 09:00 or 4:30pm.',
            )
          },
        ])
        words =
          choice === 'tomorrow'
            ? ['tomorrow', 'at', time]
            : choice === 'at'
              ? ['at', time]
              : ['every', day, 'at', time]
      }
      const parsed = parseCliSchedule(words, new Date(), { allowEmptyPrompt: true })
      if (!parsed.ok) throw new Error(parsed.error)
      return parsed.intent.schedule
    })
    if (result) return result
  }
}

function timing(schedule: CliSchedule, remote: boolean): string {
  if (schedule.kind === 'now') return 'Now'
  if (schedule.kind === 'once') return `${formatScheduledRunLabel(schedule.at)} · once, then pauses`
  return remote
    ? `Repeats (${schedule.cron}) · server timezone`
    : `${formatNextRunLabel(schedule.cron)} · repeats (${schedule.cron})`
}

type RunDraft = { intent: CliIntent; runtime: RuntimeChoice; workspace: WorkspaceChoice }

async function editRunSettings(
  client: CliClient,
  ui: FlowUi,
  draft: RunDraft,
  remote: boolean,
  dryRun: boolean,
): Promise<void> {
  for (;;) {
    const setting = await ui.select('What would you like to change?', [
      { value: 'back', label: 'Back to summary' },
      { value: 'runtime', label: 'Agent' },
      { value: 'workspace', label: 'Project / workspace' },
      { value: 'model', label: 'Model' },
      { value: 'effort', label: 'Reasoning effort' },
      { value: 'prompt', label: 'Prompt' },
      { value: 'name', label: 'Automation name' },
      { value: 'pr', label: 'Ask the agent to open a pull request' },
    ])
    if (setting === 'back') return
    const changed = await backTo(async () => {
      if (setting === 'runtime') {
        const selected = await selectRuntime(client, draft.runtime.id, ui, !dryRun)
        if (selected.id !== draft.runtime.id) {
          draft.intent.modelHint = ''
          draft.intent.effortHint = ''
        }
        draft.runtime = selected
      }
      if (setting === 'workspace')
        draft.workspace = await selectWorkspace(client, draft.workspace.id, ui, {
          remote,
          dryRun,
          force: true,
        })
      if (setting === 'model')
        draft.intent.modelHint = await ui.text(
          'Model ID (leave empty for the agent default)',
          draft.intent.modelHint,
          undefined,
          true,
        )
      if (setting === 'prompt')
        draft.intent.prompt = await ui.text('What should the agent do?', draft.intent.prompt)
      if (setting === 'effort')
        draft.intent.effortHint = await ui.text(
          'Reasoning effort (leave empty for the agent default)',
          draft.intent.effortHint || '',
          undefined,
          true,
        )
      if (setting === 'name')
        draft.intent.name = await ui.text(
          'Automation name',
          draft.intent.name || deriveTaskName(draft.intent.prompt),
        )
      if (setting === 'pr')
        draft.intent.openPr = await ui.confirm(
          'Ask the agent to commit, push and open a pull request?',
          draft.intent.openPr,
        )
      return true
    })
    if (changed) return
  }
}

export async function guideRun(
  client: CliClient,
  words: string[],
  mode: 'run' | 'schedule',
  ui: FlowUi,
  { remote = false, dryRun = false } = {},
): Promise<CliIntent> {
  let parsed = parseCliSchedule(words, new Date(), { allowEmptyPrompt: true })
  while (!parsed.ok) {
    ui.info(parsed.error)
    const corrected = await ui.text(
      'Edit the task and options',
      editableCommand(words),
      (value) => {
        try {
          const result = parseCliSchedule(splitCommandLine(value), new Date(), {
            allowEmptyPrompt: true,
          })
          return result.ok ? undefined : result.error
        } catch (error) {
          return (error as Error).message
        }
      },
    )
    words = splitCommandLine(corrected)
    parsed = parseCliSchedule(words, new Date(), { allowEmptyPrompt: true })
  }
  const { intent } = parsed
  if (intent.schedule.kind === 'recurring' && !isValidCron(intent.schedule.cron)) {
    intent.schedule.cron = await ui.text(
      'Correct the cron expression',
      intent.schedule.cron,
      (value) =>
        isValidCron(value) ? undefined : 'Use a valid cron expression, such as 0 9 * * 1-5.',
    )
  }
  let runtime: RuntimeChoice
  let workspace: WorkspaceChoice
  let workspaceVisited = false
  const setup: (() => Promise<void>)[] = []
  if (!intent.prompt)
    setup.push(async () => {
      intent.prompt = await ui.text('What should the agent do?', intent.prompt)
    })
  setup.push(
    async () => {
      const selected = await selectRuntime(client, runtime?.id || intent.runtimeHint, ui, !dryRun)
      if (runtime && runtime.id !== selected.id) {
        intent.modelHint = ''
        intent.effortHint = ''
      }
      runtime = selected
    },
    async () => {
      workspace = await selectWorkspace(client, workspace?.id || intent.workspaceHint, ui, {
        remote,
        dryRun,
        force: workspaceVisited,
      })
      workspaceVisited = true
    },
  )
  if (mode === 'schedule' && intent.schedule.kind === 'now')
    setup.push(async () => {
      intent.schedule = await chooseSchedule(ui, remote, intent.schedule)
    })
  setup.push(async () => {
    for (;;) {
      ui.note(
        [
          `Task     ${intent.prompt}`,
          `Agent    ${runtime.label || runtime.bin} · ${intent.modelHint || 'default model'}`,
          ...(intent.effortHint ? [`Effort   ${intent.effortHint}`] : []),
          `Project  ${workspace.projectName || workspace.name} · ${workspace.branch || workspace.name}`,
          `Path     ${workspace.path}`,
          `When     ${timing(intent.schedule, remote)}`,
          ...(intent.schedule.kind !== 'now'
            ? [`Name     ${intent.name || deriveTaskName(intent.prompt)}`]
            : []),
          ...(intent.openPr ? ['Finish   Commit, push and open a pull request'] : []),
        ].join('\n'),
        dryRun ? 'Preview' : 'Ready when you are',
      )
      const scheduled = intent.schedule.kind !== 'now'
      const action = await ui.select('What next? Enter to continue', [
        {
          value: 'go',
          label: dryRun ? 'Finish preview' : scheduled ? 'Confirm schedule' : 'Run now',
          hint: 'Enter',
        },
        { value: 'schedule', label: scheduled ? 'Change schedule' : 'Schedule for later' },
        ...(scheduled ? [{ value: 'now', label: 'Run immediately instead' }] : []),
        { value: 'settings', label: 'Change settings', hint: 'agent, project, model, prompt' },
        { value: 'cancel', label: 'Cancel' },
      ])
      if (action === 'cancel') throw new Cancelled('No run or automation created.')
      if (action === 'schedule') {
        const schedule = await backTo(() => chooseSchedule(ui, remote, intent.schedule))
        if (schedule) intent.schedule = schedule
      } else if (action === 'now') intent.schedule = { kind: 'now' }
      else if (action === 'go') {
        if (scheduled && !dryRun) {
          const ready = await backTo(async () => {
            await ensureProjectChecks(client, workspace, ui)
            return true
          })
          if (!ready) continue
        }
        return
      } else {
        const draft = { intent, runtime, workspace }
        await backTo(() => editRunSettings(client, ui, draft, remote, dryRun))
        runtime = draft.runtime
        workspace = draft.workspace
      }
    }
  })
  await steps(setup)
  return { ...intent, runtimeHint: runtime!.id, workspaceHint: workspace!.id }
}

import { createServer } from 'node:http'
import { backTo, browse, Cancelled, CliUi, interactiveTerminal, steps } from '../terminal/ui.ts'
import { ensureProjectChecks, selectRuntime, selectWorkspace } from './guided.ts'
import type { CliClient } from '../runtime/local.ts'
import type { RuntimeChoice, WorkspaceChoice } from './cliResolve.ts'

type Connection = { id: string; name: string; provider: string; enabled: number }
type Provider = { id: string; label: string; events: { id: string; label: string }[] }

async function choose<T extends { id: string }>(
  ui: CliUi,
  label: string,
  rows: T[],
  name: (row: T) => string,
  hint?: string,
  autoSelect = false,
): Promise<T> {
  if (!rows.length) throw new Error(`No ${label} available.`)
  if (hint) {
    const matches = rows.filter(
      (row) => row.id === hint || name(row).toLowerCase() === hint.toLowerCase(),
    )
    if (matches.length === 1) return matches[0]!
    const message = `Unknown or ambiguous ${label}: ${hint}. Choose one below.`
    if (!ui.interactive)
      throw new Error(`${message} Available IDs: ${rows.map((row) => row.id).join(', ')}`)
    ui.info(message)
  }
  if (!ui.interactive && autoSelect && rows.length === 1) return rows[0]!
  if (!ui.interactive)
    throw new Error(`Choose a ${label} explicitly: ${rows.map((row) => row.id).join(', ')}`)
  const id = await ui.select(
    `Choose ${label}`,
    rows.map((row) => ({ value: row.id, label: name(row), hint: row.id })),
  )
  return rows.find((row) => row.id === id)!
}

/** Temporary loopback callback only; no app server or web build is needed. */
export async function authorize(client: CliClient, provider?: string): Promise<unknown> {
  let expectedState = ''
  let busy = false
  let finish!: (value: unknown) => void
  let fail!: (error: Error) => void
  const completed = new Promise((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  // A startup failure can precede the await below.
  void completed.catch(() => {})
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (req.method !== 'GET' || url.pathname !== '/cloud/callback') {
      res.writeHead(404).end()
      return
    }
    if (!expectedState || url.searchParams.get('state') !== expectedState) {
      res.writeHead(400).end('Invalid authorization state.')
      return
    }
    if (busy) {
      res.writeHead(409).end('Authorization is already completing.')
      return
    }
    busy = true
    void (async () => {
      try {
        const params = url.searchParams
        if (params.get('error')) throw new Error(params.get('error')!)
        const result = provider
          ? await client.call('cloud.completeHostedConnect', {
              provider,
              cloudConnectionId: params.get('connection_id') ?? '',
              state: expectedState,
              siteUrl: params.get('site_url') ?? '',
              accountName: params.get('account') ?? '',
            })
          : await client.call('cloud.completeLogin', {
              code: params.get('code') ?? '',
              state: expectedState,
            })
        res.end('Connected. You can close this tab and return to your terminal.')
        finish(result)
      } catch (error) {
        res.writeHead(400).end('Authorization failed. Return to your terminal for details.')
        fail(error as Error)
      }
    })()
  })
  const timeout = setTimeout(
    () => fail(new Error('Authorization timed out. Run the command again.')),
    5 * 60_000,
  )
  const cancel = () => fail(new Cancelled('Authorization cancelled.'))
  process.once('SIGINT', cancel)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Could not start authorization callback.')
    const origin = `http://127.0.0.1:${address.port}`
    const started = (await client.call(provider ? 'cloud.startHostedConnect' : 'cloud.startLogin', {
      origin,
      ...(provider ? { provider } : {}),
    })) as { url: string }
    expectedState = new URL(started.url).searchParams.get('state') ?? ''
    if (!expectedState) throw new Error('Authorization response is missing state.')
    console.error(
      `Open this URL in your browser to ${provider ? `connect ${provider}` : 'sign in'}:\n${started.url}\nWaiting for authorization…`,
    )
    return await completed
  } finally {
    clearTimeout(timeout)
    process.removeListener('SIGINT', cancel)
    server.closeAllConnections()
    server.close()
  }
}

export async function integrations(
  client: CliClient,
  words: string[],
  json: boolean,
  ui = new CliUi(!json && interactiveTerminal()),
  remote = false,
): Promise<void> {
  if (!words.length && ui.interactive) {
    await browse(
      () =>
        ui.select('Integrations', [
          {
            value: 'list',
            label: 'Your connections',
            hint: 'See connected providers and their status.',
          },
          {
            value: 'connect',
            label: 'Connect a provider',
            hint: 'Link an account to receive events.',
          },
          {
            value: 'configure',
            label: 'Set up an event automation',
            hint: 'Run an agent when a provider event arrives.',
          },
          {
            value: 'providers',
            label: 'Available providers and events',
            hint: 'Browse providers and the events that can start work.',
          },
          {
            value: 'enable',
            label: 'Enable a connection',
            hint: 'Resume events from a paused connection.',
          },
          {
            value: 'disable',
            label: 'Pause a connection',
            hint: 'Pause event triggers while keeping the connection.',
          },
          {
            value: 'disconnect',
            label: 'Disconnect a provider',
            hint: 'Remove the provider connection.',
          },
          { value: ':exit', label: 'Back' },
        ]),
      (action) => integrations(client, [action], json, ui, remote),
    )
    return
  }
  const [command = 'list', ...args] = words
  let hint: string | undefined
  const options: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('--')) {
      if (hint)
        throw new Error('Pass one connection or provider. Run "openrun integrations --help".')
      hint = arg
      continue
    }
    const eq = arg.indexOf('=')
    const flag = eq < 0 ? arg : arg.slice(0, eq)
    const value = eq < 0 ? args[++i] : arg.slice(eq + 1)
    if (
      command !== 'configure' ||
      !['--runtime', '--in', '--event', '--prompt', '--name'].includes(flag) ||
      !value?.trim() ||
      (eq < 0 && value.startsWith('--'))
    ) {
      throw new Error(
        `Unknown or missing integration option: ${flag}. Run "openrun integrations --help".`,
      )
    }
    options[flag] = value
  }
  const providers = (await client.call('integrations.listProviders')) as Provider[]
  if (command === 'providers') {
    if (json) console.log(JSON.stringify(providers, null, 2))
    else
      for (const row of providers)
        console.log(
          `${row.id.padEnd(14)} ${row.label}\n  ${row.events.map((event) => event.id).join(', ')}`,
        )
    return
  }
  if (command === 'connect') {
    const provider = await choose(ui, 'provider', providers, (row) => row.label, hint)
    const status = (await client.call('cloud.status')) as {
      signedIn: boolean
      cloudUrl: string | null
    }
    if (!status.cloudUrl)
      throw new Error(
        'Hosted integrations require Open Run Cloud. Local schedules and runs work with OPENRUN_CLOUD_URL=off.',
      )
    if (!status.signedIn) await authorize(client)
    const connected = (await authorize(client, provider.id)) as Connection
    console.log(
      json
        ? JSON.stringify(connected, null, 2)
        : `Connected ${connected.name}. Next: openrun integrations configure ${connected.id}`,
    )
    if (ui.interactive && (await ui.confirm('Set up an event automation for this connection?')))
      await integrations(client, ['configure', connected.id], json, ui, remote)
    return
  }
  const connections = (await client.call('integrations.list')) as Connection[]
  if (!connections.length && ui.interactive) {
    ui.info('No providers connected yet.')
    if (await ui.confirm('Connect a provider?'))
      await integrations(client, ['connect'], json, ui, remote)
    return
  }
  if (command === 'list' || command === 'ls') {
    if (json) console.log(JSON.stringify(connections, null, 2))
    else if (!connections.length) console.log('No integrations. Run: openrun integrations connect')
    else
      for (const row of connections)
        console.log(
          `${row.id}  ${row.enabled ? 'on ' : 'off'}  ${row.provider.padEnd(12)} ${row.name}`,
        )
    if (ui.interactive) {
      const action = await ui.select('What next?', [
        { value: 'exit', label: 'Done' },
        { value: 'configure', label: 'Set up an event automation' },
        { value: 'connect', label: 'Connect another provider' },
        { value: 'disable', label: 'Pause a connection' },
        { value: 'disconnect', label: 'Disconnect a provider' },
      ])
      if (action !== 'exit') await integrations(client, [action], json, ui, remote)
    }
    return
  }
  if (!['configure', 'enable', 'disable', 'disconnect'].includes(command))
    throw new Error(`Unknown integrations command: ${command}`)
  let connection!: Connection
  if (command === 'configure') {
    let runtime!: RuntimeChoice
    let workspace!: WorkspaceChoice
    let event!: Provider['events'][number]
    const setup: (() => Promise<void>)[] = [
      async () => {
        connection = await choose(
          ui,
          'connection',
          connections,
          (row) => row.name,
          connection ? undefined : hint,
          true,
        )
      },
      async () => {
        runtime = await selectRuntime(client, runtime?.id || options['--runtime'] || '', ui)
      },
      async () => {
        workspace = await selectWorkspace(client, workspace?.id || options['--in'] || '', ui, {
          remote,
          force: Boolean(workspace),
        })
      },
      async () => {
        const provider = providers.find((p) => p.id === connection.provider)
        if (!provider)
          throw new Error(
            `Unknown provider: ${connection.provider}. Run "openrun integrations providers".`,
          )
        event = await choose(
          ui,
          'event',
          provider.events,
          (e) => e.label,
          event ? undefined : options['--event'],
          true,
        )
      },
      async () => {
        if (ui.interactive) {
          for (;;) {
            ui.note(
              `${connection.name} · ${event.label}\nAgent: ${runtime.label}\nProject: ${workspace.projectName || workspace.name}\nPrompt: ${options['--prompt'] || 'provider default'}\nName: ${options['--name'] || 'automatic'}`,
              'Event automation',
            )
            const action = await ui.select('What next?', [
              { value: 'create', label: 'Enable automation', hint: 'Enter' },
              { value: 'prompt', label: 'Customize prompt' },
              { value: 'name', label: 'Change name' },
              { value: 'cancel', label: 'Cancel' },
            ])
            if (action === 'cancel') throw new Cancelled('No automation created.')
            if (action === 'create') {
              const ready = await backTo(async () => {
                await ensureProjectChecks(client, workspace, ui)
                return true
              })
              if (ready) break
              continue
            }
            const value = await backTo(() =>
              ui.text(
                action === 'prompt'
                  ? 'Prompt (empty uses the provider default)'
                  : 'Automation name (empty uses the default)',
                options[`--${action}`] || '',
                undefined,
                true,
              ),
            )
            if (value !== undefined) options[`--${action}`] = value
          }
        }
      },
    ]
    await steps(setup)
    const result = (await client.call('integrations.createAutomation', {
      integrationId: connection.id,
      workspaceId: workspace.id,
      runtimeId: runtime.id,
      events: [event.id],
      ...(options['--prompt'] ? { prompt: options['--prompt'] } : {}),
      ...(options['--name'] ? { name: options['--name'] } : {}),
      enabled: true,
    })) as { taskId: string }
    ui.rememberRuntime(runtime.id)
    console.log(
      json
        ? JSON.stringify(result, null, 2)
        : `Automation enabled for ${connection.name}: ${event.label}\nNext: openrun automations list\nRun now: openrun now ${result.taskId}`,
    )
    return
  }
  let confirmed = !ui.interactive
  await steps([
    async () => {
      connection = await choose(
        ui,
        'connection',
        connections,
        (row) => row.name,
        connection ? undefined : hint,
      )
    },
    async () => {
      if (ui.interactive)
        confirmed = await ui.confirm(
          `${command === 'disconnect' ? 'Disconnect' : command === 'enable' ? 'Enable' : 'Pause'} ${connection.name}?`,
          command !== 'disconnect',
        )
    },
  ])
  if (!confirmed) return
  const result = (await client.call(
    command === 'disconnect' ? 'integrations.disconnectHosted' : 'integrations.update',
    command === 'disconnect'
      ? { integrationId: connection.id }
      : { id: connection.id, enabled: command === 'enable' },
  )) as { ok?: boolean; remoteError?: string }
  if (result?.ok === false)
    throw new Error(result.remoteError ?? 'Could not disconnect integration.')
  console.log(json ? JSON.stringify(result, null, 2) : `${command}: ${connection.name}`)
}

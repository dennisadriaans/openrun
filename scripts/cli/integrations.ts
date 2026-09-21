import { createServer } from 'node:http'
import { createInterface } from 'node:readline/promises'
import {
  resolveRuntime,
  resolveWorkspace,
  type RuntimeChoice,
  type WorkspaceChoice,
} from '../../src/lib/cliResolve.ts'
import type { CliClient } from './local.ts'

type Connection = { id: string; name: string; provider: string; enabled: number }
type Provider = { id: string; label: string; events: { id: string; label: string }[] }

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error(`${question} Supply an explicit argument when stdin is not a terminal.`)
  const terminal = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await terminal.question(`${question} `)).trim()
  } finally {
    terminal.close()
  }
}

async function choose<T extends { id: string }>(
  label: string,
  rows: T[],
  name: (row: T) => string,
  hint?: string,
): Promise<T> {
  if (!rows.length) throw new Error(`No ${label} available.`)
  if (hint) {
    const matches = rows.filter(
      (row) => row.id === hint || name(row).toLowerCase() === hint.toLowerCase(),
    )
    if (matches.length === 1) return matches[0]!
    throw new Error(`Unknown or ambiguous ${label}: ${hint}. Choose an ID from the list.`)
  }
  for (const [index, row] of rows.entries()) console.error(`${index + 1}. ${name(row)} (${row.id})`)
  const index = Number(await ask(`Choose ${label} [1-${rows.length}]:`)) - 1
  if (!Number.isInteger(index) || !rows[index]) throw new Error('Invalid selection.')
  return rows[index]!
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
  const cancel = () => fail(new Error('Authorization cancelled.'))
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
): Promise<void> {
  const [command = 'list', hint, ...rest] = words
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
    const provider = await choose('provider', providers, (row) => row.label, hint)
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
    return
  }
  const connections = (await client.call('integrations.list')) as Connection[]
  if (command === 'list' || command === 'ls') {
    if (json) console.log(JSON.stringify(connections, null, 2))
    else if (!connections.length) console.log('No integrations. Run: openrun integrations connect')
    else
      for (const row of connections)
        console.log(
          `${row.id}  ${row.enabled ? 'on ' : 'off'}  ${row.provider.padEnd(12)} ${row.name}`,
        )
    return
  }
  if (!['configure', 'enable', 'disable', 'disconnect'].includes(command))
    throw new Error(`Unknown integrations command: ${command}`)
  const connection = await choose('connection', connections, (row) => row.name, hint)
  if (command === 'configure') {
    const options: Record<string, string> = {}
    for (let i = 0; i < rest.length; i += 2) {
      const flag = rest[i]!
      if (!['--runtime', '--in', '--event', '--prompt', '--name'].includes(flag) || !rest[i + 1])
        throw new Error(`Unknown or missing integration option: ${flag}`)
      options[flag] = rest[i + 1]!
    }
    const runtimes = (await client.call('runtimes.list')) as RuntimeChoice[]
    const workspaces = (await client.call('workspaces.list', {})) as WorkspaceChoice[]
    const runtime = options['--runtime']
      ? resolveRuntime(options['--runtime'], runtimes)
      : {
          ok: true as const,
          value: await choose(
            'runtime',
            runtimes.filter((r) => r.installed && r.enabled),
            (r) => r.bin,
          ),
        }
    if (!runtime.ok) throw new Error(runtime.error)
    const workspace = options['--in']
      ? resolveWorkspace(options['--in'], process.cwd(), workspaces)
      : {
          ok: true as const,
          value: await choose(
            'workspace',
            workspaces.filter((w) => w.status !== 'archived'),
            (w) => `${w.projectName ?? w.name} (${w.path})`,
          ),
        }
    if (!workspace.ok) throw new Error(workspace.error)
    const provider = providers.find((p) => p.id === connection.provider)!
    const event = await choose('event', provider.events, (e) => e.label, options['--event'])
    const prompt = options['--prompt'] ?? (await ask('Prompt (Enter for the provider default):'))
    const result = await client.call('integrations.createAutomation', {
      integrationId: connection.id,
      workspaceId: workspace.value.id,
      runtimeId: runtime.value.id,
      events: [event.id],
      prompt,
      ...(options['--name'] ? { name: options['--name'] } : {}),
      enabled: true,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
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

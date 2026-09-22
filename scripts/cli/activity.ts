import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { openrunHome } from '../../src/server/paths.ts'
import { SERVER_PING_MS, STALE_AFTER_MS } from '../../src/lib/liveStream.ts'
import type { ActivityLiveEvent } from '../../src/lib/activityLive.ts'

type ActivityOptions = {
  url: string
  token?: string
  onChange: () => void
  onHealthy: (healthy: boolean) => void
}

/** Authenticated IPC locally, the existing SSE endpoint for --url. */
export function watchActivity(options: ActivityOptions): () => void {
  let closed = false
  let healthy = false
  let lastFrameAt = Date.now()
  let retry: ReturnType<typeof setTimeout> | undefined
  let disconnect = () => {}
  let generation = 0
  const health = (value: boolean) => {
    if (closed || value === healthy) return
    healthy = value
    options.onHealthy(value)
  }
  const receive = (data: string) => {
    const event = JSON.parse(data) as ActivityLiveEvent
    if (!event.type) throw new Error('Activity subscriptions are unavailable on this worker.')
    lastFrameAt = Date.now()
    health(true)
    if (event.type !== 'ping') options.onChange()
  }
  const failed = () => {
    if (closed || retry) return
    health(false)
    disconnect()
    retry = setTimeout(start, 3000)
  }
  const start = () => {
    retry = undefined
    if (closed) return
    const attempt = ++generation
    const fail = () => {
      if (attempt === generation) failed()
    }
    lastFrameAt = Date.now()
    if (options.url) {
      const abort = new AbortController()
      disconnect = () => abort.abort()
      void (async () => {
        const response = await fetch(`${options.url}/api/activity/stream`, {
          headers: {
            accept: 'text/event-stream',
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          },
          signal: abort.signal,
        })
        if (!response.ok || !response.body) throw new Error('Activity stream unavailable.')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        try {
          while (!closed) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            if (buffer.length > 1_048_576) throw new Error('Activity frame too large.')
            let end = buffer.indexOf('\n')
            while (end >= 0) {
              const line = buffer.slice(0, end).trimEnd()
              buffer = buffer.slice(end + 1)
              if (line.startsWith('data:')) receive(line.slice(5).trimStart())
              end = buffer.indexOf('\n')
            }
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      })().then(fail, fail)
      return
    }
    try {
      const endpoint = JSON.parse(
        readFileSync(join(openrunHome(), 'ipc', 'runtime.json'), 'utf8'),
      ) as { port: number; token: string }
      const socket = connect({ host: '127.0.0.1', port: endpoint.port })
      disconnect = () => socket.destroy()
      socket.setEncoding('utf8')
      socket.once('connect', () =>
        socket.write(`${JSON.stringify({ operation: '$activity', token: endpoint.token })}\n`),
      )
      socket.on('error', fail)
      socket.on('close', fail)
      let buffer = ''
      socket.on('data', (chunk) => {
        try {
          buffer += chunk
          if (buffer.length > 1_048_576) throw new Error('Activity frame too large.')
          let end = buffer.indexOf('\n')
          while (end >= 0) {
            const frame = buffer.slice(0, end)
            buffer = buffer.slice(end + 1)
            receive(frame)
            end = buffer.indexOf('\n')
          }
        } catch {
          fail()
        }
      })
    } catch {
      fail()
    }
  }
  const watchdog = setInterval(() => {
    if (!retry && Date.now() - lastFrameAt > STALE_AFTER_MS) failed()
  }, SERVER_PING_MS)
  options.onHealthy(false)
  start()
  return () => {
    closed = true
    clearInterval(watchdog)
    clearTimeout(retry)
    disconnect()
  }
}

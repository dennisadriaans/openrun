import { subscribeTerminalSession } from './terminalSessions.ts'

const encoder = new TextEncoder()

function encode(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
}

export function createTerminalStream(sessionId: string, signal: AbortSignal): ReadableStream {
  let unsubscribe = () => {}
  return new ReadableStream({
    start(controller) {
      const subscription = subscribeTerminalSession(sessionId, (event) => {
        try {
          controller.enqueue(encode(event))
          if (event.type === 'exit') controller.close()
        } catch {
          unsubscribe()
        }
      })
      unsubscribe = subscription.unsubscribe
      if (subscription.buffer)
        controller.enqueue(encode({ type: 'data', data: subscription.buffer }))

      signal.addEventListener(
        'abort',
        () => {
          unsubscribe()
          try {
            controller.close()
          } catch {
            // The PTY exit may already have closed the stream.
          }
        },
        { once: true },
      )
    },
    cancel() {
      unsubscribe()
    },
  })
}

/**
 * Server entrypoint.
 *
 * Import core before exposing fetch so cron jobs, queue recovery and shutdown
 * hooks are live as soon as the production process starts — no browser request
 * should be required to wake unattended work.
 */
import './server/core'
import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

const fetch = createStartHandler(defaultStreamHandler)

export default { fetch }

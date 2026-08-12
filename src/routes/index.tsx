import { createFileRoute, redirect } from '@tanstack/react-router'

/** Automations is the home screen; there is no separate dashboard to maintain. */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/tasks' })
  },
})

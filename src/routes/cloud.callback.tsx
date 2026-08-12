/**
 * OAuth return path. The Worker redirects the browser here with either a
 * login `code` or a completed Jira `connection_id`.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { IntegrationPage } from '../components/IntegrationPage'
import { useCompleteCloudLogin, useCompleteHostedJiraConnect } from '../lib/queries'

export const Route = createFileRoute('/cloud/callback')({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : '',
    state: typeof search.state === 'string' ? search.state : '',
    error: typeof search.error === 'string' ? search.error : '',
    jira: search.jira === '1' || search.jira === 'true' || search.jira === true,
    connection_id: typeof search.connection_id === 'string' ? search.connection_id : '',
    site_url: typeof search.site_url === 'string' ? search.site_url : '',
  }),
  component: CloudCallbackPage,
})

function CloudCallbackPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const completeLogin = useCompleteCloudLogin()
  const completeJira = useCompleteHostedJiraConnect()
  const [message, setMessage] = useState('Finishing…')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const run = async () => {
      if (search.error) {
        setMessage(search.error)
        return
      }
      try {
        if (search.jira && search.connection_id) {
          await completeJira.mutateAsync({
            cloudConnectionId: search.connection_id,
            siteUrl: search.site_url || undefined,
          })
          await navigate({ to: '/integrations/$provider', params: { provider: 'jira' } })
          return
        }
        if (search.code && search.state) {
          await completeLogin.mutateAsync({ code: search.code, state: search.state })
          await navigate({ to: '/tasks' })
          return
        }
        setMessage('Nothing to complete. You can close this tab.')
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err))
      }
    }
    void run()
  }, [completeJira, completeLogin, navigate, search])

  return (
    <IntegrationPage title="Account">
      <p className="text-ui-sm text-tier-secondary">{message}</p>
    </IntegrationPage>
  )
}

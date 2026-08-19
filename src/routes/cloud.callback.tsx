/**
 * OAuth return path. The Worker redirects the browser here with either a login
 * `code` or a completed hosted integration `connection_id`.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { IntegrationPage } from '../components/IntegrationPage'
import { safeLocalNext } from '../lib/cloud/login'
import { isIntegrationProviderId } from '../lib/integrations/catalog'
import { useCompleteCloudLogin, useCompleteHostedConnect } from '../lib/queries'

export const Route = createFileRoute('/cloud/callback')({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : '',
    state: typeof search.state === 'string' ? search.state : '',
    error: typeof search.error === 'string' ? search.error : '',
    provider: typeof search.provider === 'string' ? search.provider : '',
    connection_id: typeof search.connection_id === 'string' ? search.connection_id : '',
    status: typeof search.status === 'string' ? search.status : '',
    site_url: typeof search.site_url === 'string' ? search.site_url : '',
    account: typeof search.account === 'string' ? search.account : '',
  }),
  component: CloudCallbackPage,
})

function CloudCallbackPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const completeLogin = useCompleteCloudLogin()
  const completeConnect = useCompleteHostedConnect()
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
        if (search.connection_id) {
          const row = await completeConnect.mutateAsync({
            provider: search.provider,
            cloudConnectionId: search.connection_id,
            state: search.state,
            siteUrl: search.site_url || undefined,
            accountName: search.account || undefined,
          })
          const provider = isIntegrationProviderId(row.provider) ? row.provider : ''
          if (provider) {
            await navigate({ to: '/integrations/$provider', params: { provider } })
          } else {
            await navigate({ to: '/integrations' })
          }
          return
        }
        if (search.code && search.state) {
          const result = await completeLogin.mutateAsync({
            code: search.code,
            state: search.state,
          })
          // Signing in from a provider page resumes that connect; the path was
          // recorded before the browser left and re-validated on the way back.
          await navigate({ to: safeLocalNext(result.next) || '/tasks' })
          return
        }
        setMessage('Nothing to complete. You can close this tab.')
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err))
      }
    }
    void run()
  }, [completeConnect, completeLogin, navigate, search])

  return (
    <IntegrationPage title="Account">
      <p className="text-ui-sm text-tier-secondary">{message}</p>
    </IntegrationPage>
  )
}

/**
 * Register a Linear webhook with a one-shot personal API key (not stored).
 */
export type LinearWebhookCreateResult = {
  remoteWebhookId: string
}

type LinearGraphQlError = { message?: string }

async function linearGraphql<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const key = apiKey.trim()
  if (!key) throw new Error('Paste a Linear personal API key (Settings → API → Personal API keys).')

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: key,
    },
    body: JSON.stringify({ query, variables }),
  })
  const text = await res.text()
  let json: {
    data?: T
    errors?: LinearGraphQlError[]
  }
  try {
    json = JSON.parse(text) as { data?: T; errors?: LinearGraphQlError[] }
  } catch {
    throw new Error(res.ok ? 'Linear returned invalid JSON' : `Linear HTTP ${res.status}`)
  }
  if (!res.ok || json.errors?.length) {
    const msg = json.errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join('; ')
    throw new Error(msg || `Linear HTTP ${res.status}`)
  }
  if (!json.data) throw new Error('Linear returned an empty response')
  return json.data
}

export async function createLinearWebhook(input: {
  apiKey: string
  webhookUrl: string
  secret: string
  resourceTypes: string[]
  label: string
}): Promise<LinearWebhookCreateResult> {
  const data = await linearGraphql<{
    webhookCreate: {
      success: boolean
      webhook: { id: string } | null
    }
  }>(
    input.apiKey,
    `mutation WebhookCreate($input: WebhookCreateInput!) {
      webhookCreate(input: $input) {
        success
        webhook { id }
      }
    }`,
    {
      input: {
        url: input.webhookUrl,
        secret: input.secret,
        label: input.label.slice(0, 80) || 'Open Run',
        resourceTypes: input.resourceTypes,
        allPublicTeams: true,
      },
    },
  )
  if (!data.webhookCreate.success || !data.webhookCreate.webhook?.id) {
    throw new Error('Linear did not create the webhook')
  }
  return { remoteWebhookId: data.webhookCreate.webhook.id }
}

export async function deleteLinearWebhook(input: {
  apiKey: string
  remoteWebhookId: string
}): Promise<void> {
  await linearGraphql(
    input.apiKey,
    `mutation WebhookDelete($id: String!) {
      webhookDelete(id: $id) { success }
    }`,
    { id: input.remoteWebhookId },
  )
}

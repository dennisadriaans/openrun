/** mcp queries and cache updates. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'
import type { McpServerConfig } from '@openrun/domain/mcp/mcp'

type McpConfigKey = { runtimeId: string; workspaceId?: string }

function mcpKey(input: McpConfigKey) {
  return ['mcpConfig', input.runtimeId, input.workspaceId ?? ''] as const
}

/** MCP servers as they sit in the runtime's own config file, right now. */
export function useMcpConfig(input: McpConfigKey, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mcpKey(input),
    queryFn: () => fns.getMcpConfig({ data: input }),
    enabled: (opts?.enabled ?? true) && !!input.runtimeId,
    // The file is the source of truth and the user may edit it in an editor
    // while this page is open.
    staleTime: 2000,
  })
}

export function useSaveMcpServer(input: McpConfigKey) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { targetId: string; server: McpServerConfig; previousName?: string }) =>
      fns.saveMcpServer({ data: { ...input, ...vars } }),
    onSuccess: (data) => qc.setQueryData(mcpKey(input), data),
  })
}

export function useRemoveMcpServer(input: McpConfigKey) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { targetId: string; name: string }) =>
      fns.removeMcpServer({ data: { ...input, ...vars } }),
    onSuccess: (data) => qc.setQueryData(mcpKey(input), data),
  })
}

const sharedMcpKey = ['sharedMcp'] as const

const mcpDiscoveryKey = ['mcpDiscovery'] as const

/**
 * Servers defined once in Open Run and projected into every CLI's config.
 * Mutations return the refreshed view plus what the fan-out actually wrote.
 */
export function useSharedMcp() {
  return useQuery({
    queryKey: sharedMcpKey,
    queryFn: () => fns.getSharedMcp(),
    staleTime: 2000,
  })
}

export function useSaveSharedMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { server: McpServerConfig; previousName?: string; force?: boolean }) =>
      fns.saveSharedMcpServer({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      void qc.invalidateQueries({ queryKey: mcpDiscoveryKey })
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

/**
 * Servers the user already had in a CLI config and has not shared yet. Read
 * only — importing is an explicit action, never something a page load does.
 */
export function useMcpDiscovery() {
  return useQuery({
    queryKey: mcpDiscoveryKey,
    queryFn: () => fns.discoverMcpServers(),
    staleTime: 2000,
  })
}

export function useImportMcpServers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { choices: { name: string; fromTargetId: string }[] }) =>
      fns.importMcpServers({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      qc.setQueryData(mcpDiscoveryKey, data.discovery)
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

export function useRemoveSharedMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { name: string; scope?: 'registry' | 'everywhere' }) =>
      fns.removeSharedMcpServer({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      void qc.invalidateQueries({ queryKey: mcpDiscoveryKey })
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

export function useSyncSharedMcp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { force?: boolean } = {}) => fns.syncSharedMcp({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      void qc.invalidateQueries({ queryKey: mcpDiscoveryKey })
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

const mcpOAuthKey = ['mcpOAuth'] as const

/**
 * Hosted servers Open Run holds a token for. Fetching also refreshes anything
 * near expiry, so opening the page is what keeps the header in each CLI config
 * live.
 */
export function useMcpOAuth() {
  return useQuery({
    queryKey: mcpOAuthKey,
    queryFn: () => fns.getMcpOAuthStatus(),
    staleTime: 5000,
  })
}

export function useStartMcpOAuth() {
  return useMutation({
    mutationFn: (vars: { name: string; redirectUri: string }) => fns.startMcpOAuth({ data: vars }),
  })
}

export function useDisconnectMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { name: string }) => fns.disconnectMcpServer({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      qc.setQueryData(mcpOAuthKey, { connections: data.connections, errors: [] })
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

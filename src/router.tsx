import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { getQueryClient } from './lib/queryClient'

function RoutePendingSkeleton() {
  return (
    <div className="flex h-[calc(100vh-var(--header-h,0px))] min-h-0 flex-col bg-background">
      <div className="flex h-[var(--workspace-topbar-height,44px)] shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="size-4 animate-pulse rounded bg-muted-foreground/10" />
        <div className="h-3 w-28 animate-pulse rounded bg-muted-foreground/10" />
        <div className="h-3 w-20 animate-pulse rounded bg-muted-foreground/10" />
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-5 pt-5">
        <div className="ml-auto h-14 w-[55%] animate-pulse rounded-[10px] bg-secondary" />
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-3 w-full max-w-md animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-3 w-[85%] max-w-sm animate-pulse rounded bg-muted-foreground/10" />
        </div>
      </div>
    </div>
  )
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPendingComponent: RoutePendingSkeleton,
    context: {
      queryClient: getQueryClient(),
    },
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

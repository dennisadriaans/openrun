import { Link, useRouterState } from '@tanstack/react-router'
import { isIntegrationProviderId, providerPageTitle } from '../lib/integrations/catalog'
import { ChevronRight, PanelLeft } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

const SIDEBAR_KEY = 'agentops:sidebar'

type SidebarContextValue = {
  open: boolean
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

type TopBarActionsContextValue = {
  actions: ReactNode | null
  setActions: (actions: ReactNode | null) => void
}

const TopBarActionsContext = createContext<TopBarActionsContextValue | null>(null)

export function TopBarActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null)
  return (
    <TopBarActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </TopBarActionsContext.Provider>
  )
}

/** Inject actions into the top bar (breadcrumb row) for the current page. */
export function useTopBarActions(actions: ReactNode | null) {
  const ctx = useContext(TopBarActionsContext)
  useEffect(() => {
    if (!ctx) return
    ctx.setActions(actions)
    return () => ctx.setActions(null)
  }, [ctx, actions])
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider')
  return ctx
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_KEY) === '0') setOpen(false)
    } catch {
      // ignore
    }
  }, [])

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  return <SidebarContext.Provider value={{ open, toggle }}>{children}</SidebarContext.Provider>
}

export function SidebarToggle({ className = '' }: { className?: string }) {
  const { open, toggle } = useSidebar()
  return (
    <button
      type="button"
      aria-label={open ? 'Close sidebar' : 'Open sidebar'}
      aria-pressed={open}
      title={open ? 'Close sidebar' : 'Open sidebar'}
      onClick={toggle}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-tier-quaternary transition-colors hover:bg-hover hover:text-foreground ${className}`}
    >
      <PanelLeft className="size-3.5" />
    </button>
  )
}

type Crumb = { label: string; to?: string }

function crumbsForPath(pathname: string): Crumb[] {
  if (pathname === '/integrations' || pathname === '/integrations/') {
    return [{ label: 'Integrations' }]
  }
  if (pathname.startsWith('/integrations/')) {
    const id = pathname.slice('/integrations/'.length)
    const title = isIntegrationProviderId(id) ? providerPageTitle(id) : 'Integration'
    return [{ label: 'Integrations', to: '/integrations' }, { label: title }]
  }
  if (pathname === '/notifications') return [{ label: 'Notifications' }]
  if (pathname === '/runtimes') return [{ label: 'Runtimes' }]
  if (pathname === '/planner') return [{ label: 'Planner' }]
  if (pathname === '/tasks' || pathname === '/tasks/') {
    return [{ label: 'Automations', to: '/tasks' }]
  }
  if (pathname === '/tasks/new') {
    return [{ label: 'Automations', to: '/tasks' }, { label: 'New automation' }]
  }
  if (pathname.startsWith('/tasks/')) {
    return [{ label: 'Automations', to: '/tasks' }, { label: 'Automation' }]
  }
  if (pathname === '/runs' || pathname === '/runs/') {
    return [{ label: 'Runs', to: '/runs' }]
  }
  if (pathname.startsWith('/runs/')) {
    return [{ label: 'Runs', to: '/runs' }, { label: 'Run' }]
  }
  return [{ label: 'Automations', to: '/tasks' }]
}

export function AppBreadcrumb() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const crumbs = crumbsForPath(pathname)

  // Top-level pages already have a PageHeader title — skip the duplicate crumb.
  if (crumbs.length < 2) return null

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-ui-sm"
    >
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1
        return (
          <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3 shrink-0 text-tier-quaternary" /> : null}
            {crumb.to && !last ? (
              <Link
                to={crumb.to}
                className="min-w-0 truncate text-tier-tertiary transition-colors hover:text-foreground"
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                className={`min-w-0 truncate ${last ? 'text-tier-secondary' : 'text-tier-tertiary'}`}
              >
                {crumb.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

/** Top chrome for nested pages. Hidden on full-bleed workspace routes and top-level lists. */
export function AppTopBar() {
  const { open } = useSidebar()
  const topBar = useContext(TopBarActionsContext)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isWorkspace = /^\/runs\/[^/]+$/.test(pathname)
  const crumbs = crumbsForPath(pathname)
  const showCrumbs = crumbs.length >= 2
  const actions = topBar?.actions

  if (isWorkspace) return null
  if (!showCrumbs && open && !actions) return null

  return (
    <header className="flex h-[var(--workspace-topbar-height,40px)] shrink-0 items-center gap-2 border-b border-border px-3">
      {!open ? <SidebarToggle /> : null}
      {showCrumbs ? <AppBreadcrumb /> : <span className="min-w-0 flex-1" />}
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  )
}

import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Bell,
  ChevronsUpDown,
  History,
  ListChecks,
  MessageSquare,
  Smartphone,
  User,
  Webhook,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import {
  AppTopBar,
  SidebarProvider,
  SidebarToggle,
  TopBarActionsProvider,
  useSidebar,
} from '../components/AppChrome'
import { ActivityLiveProvider } from '../lib/useActivityLive'
import { useCloudStatus, useSignOutCloud, useStartCloudLogin } from '../lib/queries'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Open Run' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: AppLayout,
  shellComponent: RootDocument,
})

let browserQueryClient: QueryClient | undefined
function getQueryClient() {
  if (typeof document === 'undefined') {
    return new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } })
  }
  if (!browserQueryClient) {
    browserQueryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } })
  }
  return browserQueryClient
}

const NAV = [
  { to: '/tasks', label: 'Automations', icon: ListChecks },
  { to: '/runs', label: 'Runs', icon: History },
  // { to: '/planner', label: 'Planner', icon: Sparkles },
]

const USER_MENU = [
  { to: '/slack', label: 'Slack', icon: MessageSquare },
  { to: '/devices', label: 'Devices', icon: Smartphone },
  { to: '/integrations', label: 'Integrations', icon: Webhook },
  { to: '/notifications', label: 'Notifications', icon: Bell },
]

export const Icon = ({ className = 'w-6 h-6 rounded bg-inverted', ...props }) => {
  return (
    <svg
      width="93"
      height="93"
      viewBox="0 0 93 93"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <rect width="93" height="93" rx="9" />
      <g className="fill-current text-inverted bg-inverted">
        <ellipse cx="45.7872" cy="25.5807" rx="3.77421" ry="12.5807" />
        <ellipse
          cx="56.6042"
          cy="28.2985"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(30 56.6042 28.2985)"
        />
        <ellipse
          cx="64.6131"
          cy="36.0606"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(60 64.6131 36.0606)"
        />
        <ellipse
          cx="67.668"
          cy="46.7873"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(90 67.668 46.7873)"
        />
        <ellipse
          cx="64.9502"
          cy="57.6042"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(120 64.9502 57.6042)"
        />
        <ellipse
          cx="57.1881"
          cy="65.6132"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(150 57.1881 65.6132)"
        />
        <ellipse
          cx="46.4614"
          cy="68.668"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(-180 46.4614 68.668)"
        />
        <ellipse
          cx="35.6444"
          cy="65.9503"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(-150 35.6444 65.9503)"
        />
        <ellipse
          cx="27.6355"
          cy="58.1881"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(-120 27.6355 58.1881)"
        />
        <ellipse
          cx="24.5807"
          cy="47.4615"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(-90 24.5807 47.4615)"
        />
        <ellipse
          cx="27.2985"
          cy="36.6445"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(-60 27.2985 36.6445)"
        />
        <ellipse
          cx="35.0606"
          cy="28.6356"
          rx="3.77421"
          ry="12.5807"
          transform="rotate(-30 35.0606 28.6356)"
        />
      </g>
    </svg>
  )
}

function useClickOutside(
  active: boolean,
  onOutside: () => void,
  refs: Array<RefObject<HTMLElement | null>>,
) {
  const refsRef = useRef(refs)
  refsRef.current = refs

  useEffect(() => {
    if (!active) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (refsRef.current.some((r) => r.current?.contains(target))) return
      onOutside()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOutside()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [active, onOutside])
}

function UserMenu() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: cloud } = useCloudStatus()
  const startLogin = useStartCloudLogin()
  const signOut = useSignOutCloud()

  useClickOutside(open, () => setOpen(false), [triggerRef, menuRef])

  const label = cloud?.signedIn ? cloud.email || 'Connected' : 'Local'
  const canSignIn = Boolean(cloud?.cloudUrl) && !cloud?.signedIn

  const onSignIn = async () => {
    setOpen(false)
    try {
      const { url } = await startLogin.mutateAsync(window.location.origin)
      window.location.href = url
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div ref={triggerRef} className="relative mt-auto px-1.5 pb-1">
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="absolute bottom-full left-1.5 right-1.5 z-50 mb-1 overflow-hidden rounded-[10px] border border-border bg-elevated p-0.5"
        >
          {USER_MENU.map((item) => {
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`)
            return (
              <Link
                key={item.to}
                to={item.to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-ui-sm transition-colors ${
                  active
                    ? 'bg-[var(--inactive-selection-background)] text-foreground'
                    : 'text-tier-secondary hover:bg-hover hover:text-foreground'
                }`}
              >
                <item.icon className="size-3.5 shrink-0 text-tier-quaternary" />
                {item.label}
              </Link>
            )
          })}
          {canSignIn ? (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm text-tier-secondary hover:bg-hover hover:text-foreground"
              onClick={() => void onSignIn()}
            >
              Sign in
            </button>
          ) : null}
          {cloud?.signedIn ? (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm text-tier-secondary hover:bg-hover hover:text-foreground"
              onClick={() => {
                setOpen(false)
                void signOut.mutateAsync()
              }}
            >
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--inactive-selection-background)] text-tier-quaternary">
          <User className="size-3" />
        </span>
        <span className="min-w-0 flex-1 truncate text-ui-sm text-tier-secondary">{label}</span>
        <ChevronsUpDown className="size-3 shrink-0 text-tier-quaternary" />
      </button>
    </div>
  )
}

function Sidebar() {
  const { open } = useSidebar()
  if (!open) return null

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar py-2">
      <div className="mb-2 flex items-center gap-1 px-3">
        <Icon className="size-4 rounded-[3px] bg-inverted text-foreground" />
        <span className="ml-1.5 text-ui-sm font-medium tracking-tight text-foreground">
          Open Run
        </span>
        <div className="ml-auto">
          <SidebarToggle />
        </div>
      </div>
      <nav className="flex flex-col gap-px px-1.5">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: false }}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-ui-sm text-tier-secondary transition-colors hover:bg-hover hover:text-foreground data-[status=active]:bg-[var(--inactive-selection-background)] data-[status=active]:text-foreground"
          >
            <item.icon className="size-3.5 text-tier-quaternary group-data-[status=active]:text-tier-secondary" />
            {item.label}
          </Link>
        ))}
      </nav>
      <UserMenu />
    </aside>
  )
}

function AppLayout() {
  return (
    <SidebarProvider>
      <TopBarActionsProvider>
        <div className="flex min-h-screen bg-chrome">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden bg-chrome">
            <AppTopBar />
            <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
              <Outlet />
            </main>
          </div>
        </div>
      </TopBarActionsProvider>
    </SidebarProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={getQueryClient()}>
          <ActivityLiveProvider>{children}</ActivityLiveProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import {
  Bell,
  Blocks,
  ChevronsUpDown,
  Gauge,
  History,
  ListChecks,
  Smartphone,
  User,
  Webhook,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useClickOutside } from '../hooks/useClickOutside'

import {
  AppTopBar,
  SidebarProvider,
  SidebarToggle,
  TopBarActionsProvider,
  useSidebar,
} from '../components/AppChrome'
import { ChatThemeProvider } from '../components/chat/ChatThemeProvider'
import { DevLiveStatus } from '../components/DevLiveStatus'
import { InstallBanner } from '../components/InstallBanner'
import { Toaster } from '../components/toast'
import { CHAT_THEME_BOOT_SCRIPT } from '../lib/chatTheme'
import { TERMINAL_PALETTE_BOOT_SCRIPT } from '../lib/terminalPalette'
import { getQueryClient } from '../lib/queryClient'
import { ActivityLiveProvider } from '../lib/useActivityLive'
import { useCloudStatus, useSignOutCloud, useStartCloudLogin } from '../lib/queries'
import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#141414' },
      { title: 'Open Run' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'shortcut icon', href: '/favicon.ico' },
      { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
  }),
  component: AppLayout,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-ui-sm text-tier-secondary">This page does not exist.</p>
      <Link
        to="/tasks"
        className="rounded-md border border-border px-2.5 py-1.5 text-ui-sm text-tier-secondary transition-colors hover:bg-hover hover:text-foreground"
      >
        Back to Automations
      </Link>
    </div>
  )
}

const NAV = [
  { to: '/tasks', label: 'Automations', icon: ListChecks, exact: false },
  { to: '/runs', label: 'Runs', icon: History, exact: false },
  // { to: '/planner', label: 'Planner', icon: Sparkles },
]

const USER_MENU = [
  { to: '/devices', label: 'Devices', icon: Smartphone },
  { to: '/integrations', label: 'Integrations', icon: Webhook },
  { to: '/mcp', label: 'MCP servers', icon: Blocks },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/usage', label: 'Usage', icon: Gauge },
]

export const Icon = ({ className = 'size-4 rounded-[3px]' }: { className?: string }) => {
  return <img src="/favicon.svg" alt="" className={className} />
}

export const Logo = ({ className = 'size-4 rounded-[3px]' }: { className?: string }) => {
  return <img src="/logo.png" alt="" className={className} />
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
    <aside className="flex h-full w-52 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar py-2">
      <div className="mb-2 flex items-center gap-1 px-3">
        <Link
          to="/"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md transition-colors hover:opacity-80"
        >
          <Logo className="size-3 rounded-[2px]" />
          <span className="truncate text-ui-sm font-medium tracking-tight text-foreground">
            Open Run
          </span>
        </Link>
        <SidebarToggle />
      </div>
      <nav className="flex flex-col gap-px px-1.5">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.exact }}
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

/** Routes that must render before the account gate has an answer. */
function isUngatedPath(pathname: string): boolean {
  return pathname === '/welcome' || pathname.startsWith('/cloud/')
}

function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const { data: cloud, isPending, isFetching } = useCloudStatus()

  const ungated = isUngatedPath(pathname)
  // `isFetching` too: a sign-in invalidates this query, and acting on the stale
  // answer while it reloads sends a freshly linked machine back to /welcome.
  const needsWelcome =
    !isPending && !isFetching && Boolean(cloud) && !cloud!.signedIn && !cloud!.onboardingSkipped

  useEffect(() => {
    if (needsWelcome && !ungated) void navigate({ to: '/welcome', replace: true })
  }, [needsWelcome, ungated, navigate])

  if (ungated) return <Outlet />

  return (
    <SidebarProvider>
      <TopBarActionsProvider>
        <div className="flex h-dvh max-h-dvh overflow-hidden bg-chrome">
          <Sidebar />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-chrome">
            <AppTopBar />
            <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
              <Outlet />
            </main>
          </div>
        </div>
      </TopBarActionsProvider>
    </SidebarProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  const queryClient = useRouter().options.context.queryClient ?? getQueryClient()
  return (
    // The boot scripts below stamp data-chat-theme / data-term-palette on this
    // element before hydration, so its attributes never match the SSR markup.
    <html lang="en" data-theme="dark" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Sets data-chat-theme / data-term-palette before paint so the transcript never flashes. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static boot script generated from allowlisted values */}
        <script dangerouslySetInnerHTML={{ __html: CHAT_THEME_BOOT_SCRIPT }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static boot script generated from allowlisted values */}
        <script dangerouslySetInnerHTML={{ __html: TERMINAL_PALETTE_BOOT_SCRIPT }} />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <ChatThemeProvider>
            <ActivityLiveProvider>
              {children}
              <Toaster />
              <InstallBanner />
              <DevLiveStatus />
            </ActivityLiveProvider>
          </ChatThemeProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const DISMISSED_KEY = 'openrun:install-banner-dismissed'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type InstallMode = 'chrome' | 'safari' | null

function browserInstallMode(): InstallMode {
  const ua = navigator.userAgent
  const isIos =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (isIos) return 'safari'

  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS|Android/.test(ua)
  if (isSafari) return 'safari'

  return /Chrome|CriOS/.test(ua) ? 'chrome' : null
}

function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function InstallBanner() {
  const [mode, setMode] = useState<InstallMode>(null)
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (isInstalled()) return
    try {
      if (localStorage.getItem(DISMISSED_KEY) === 'true') {
        setDismissed(true)
        return
      }
    } catch {
      // Continue when storage is unavailable.
    }

    setMode(browserInstallMode())
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as InstallPromptEvent)
      setMode('chrome')
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  if (dismissed || !mode) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED_KEY, 'true')
    } catch {
      // Ignore unavailable storage.
    }
  }

  const install = async () => {
    if (!promptEvent) return
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    if (choice.outcome === 'accepted') dismiss()
    setPromptEvent(null)
  }

  const safariMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  return (
    <aside
      role="status"
      className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-lg items-start gap-3 rounded-xl border border-border bg-elevated p-4 text-foreground shadow-[0_8px_24px_var(--shadow-primary)]"
    >
      <Download className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-ui-sm font-medium">Install Open Run</p>
        {mode === 'chrome' ? (
          <p className="mt-1 text-ui-sm text-tier-tertiary">
            {promptEvent
              ? 'Install the app for quick access from your desktop or home screen.'
              : 'Use Chrome’s install icon in the address bar or menu to add Open Run.'}
          </p>
        ) : (
          <p className="mt-1 text-ui-sm text-tier-tertiary">
            {safariMobile
              ? 'Tap Share, then Add to Home Screen to install Open Run.'
              : 'Choose File, then Add to Dock in Safari to install Open Run.'}
          </p>
        )}
        {mode === 'chrome' && promptEvent ? (
          <button
            type="button"
            onClick={() => void install()}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-ui-sm font-medium text-action-label hover:opacity-90"
          >
            Install app
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss install banner"
        onClick={dismiss}
        className="shrink-0 rounded-md p-1 text-tier-quaternary hover:bg-hover hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </aside>
  )
}

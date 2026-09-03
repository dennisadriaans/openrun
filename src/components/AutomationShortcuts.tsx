/**
 * The start page's automation suggestions: one click lands on a filled-in
 * `/tasks/new`, so a schedule is a review-and-save rather than a blank form.
 */
import { Link } from '@tanstack/react-router'
import {
  BookOpen,
  FlaskConical,
  GitPullRequest,
  Inbox,
  Package,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { AUTOMATION_SHORTCUTS, type AutomationShortcut } from '../lib/automationShortcuts'

const ICONS: Record<AutomationShortcut['icon'], LucideIcon> = {
  review: GitPullRequest,
  checks: ShieldCheck,
  deps: Package,
  triage: Inbox,
  tests: FlaskConical,
  docs: BookOpen,
}

export function AutomationShortcuts({ heading = 'Suggested automations' }: { heading?: string }) {
  return (
    <section className="w-full">
      <h2 className="px-1 text-ui-sm text-tier-tertiary">{heading}</h2>
      <div className="mt-1 flex flex-col">
        {AUTOMATION_SHORTCUTS.map((shortcut) => {
          const Icon = ICONS[shortcut.icon]
          return (
            <Link
              key={shortcut.id}
              to="/tasks/new"
              search={{ shortcut: shortcut.id }}
              className="group flex items-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-hover"
            >
              <Icon className="size-4 shrink-0 text-tier-quaternary transition-colors group-hover:text-tier-secondary" />
              <span className="min-w-0 truncate text-ui-base">
                <span className="text-foreground">{shortcut.verb}</span>{' '}
                <span className="text-tier-tertiary">{shortcut.line}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

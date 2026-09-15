/**
 * Chat / new-run prompt box: slash commands, plugin mentions, attachments, send.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ComposerModelControls } from '../ComposerControls'
import { PluginMentionMenu } from '../PluginMentionMenu'
import { SlashCommandMenu } from '../SlashCommandMenu'
import { useClickOutside } from '../../hooks/useClickOutside'
import {
  appCommandFor,
  applySlashCommand,
  matchSlashCommands,
  slashMenuQuery,
  type SlashCommand,
} from '../../lib/slashCommands'
import {
  applyPluginMention,
  matchPlugins,
  pluginMenuQuery,
  type AgentPlugin,
} from '../../lib/plugins'
import { promptWithAttachments } from '../../lib/attachments'
import { draftAfterRefusal } from '../../lib/composerDraft'
import type { ModelOption } from '../../lib/models'
import {
  AttachmentButton,
  AttachmentStrip,
  imageFilesFrom,
  usePendingAttachments,
  type AttachmentUploader,
} from './ComposerAttachments'

export function Composer({
  disabled,
  disabledReason,
  placeholder,
  leading,
  pending,
  running,
  canQueue = false,
  onSendNow,
  runningLabel,
  models,
  model,
  effort,
  onModelChange,
  onEffortChange,
  onSend,
  onStop,
  className,
  commands,
  commandNote,
  plugins,
  pluginNote,
  onAppCommand,
  uploadAttachment,
  restoredDraft,
}: {
  disabled: boolean
  disabledReason?: string
  /** Overrides the idle placeholder — e.g. the first message of a new chat. */
  placeholder?: string
  /** Extra pickers rendered left of the model controls (project/branch/runtime). */
  leading?: ReactNode
  pending: boolean
  running: boolean
  /**
   * Keep typing while the agent works — the message joins the run's queue
   * instead of being refused, the way every CLI we drive behaves.
   */
  canQueue?: boolean
  /**
   * Interrupt the working agent and deliver this message now (⌘/Ctrl + ↵).
   * Same contract as `onSend`: reject and the draft comes back.
   */
  onSendNow?: (text: string) => unknown
  /** Overrides the busy placeholder — e.g. which check is running. */
  runningLabel?: string
  models: ModelOption[]
  model: string
  effort: string
  onModelChange: (slug: string) => void
  onEffortChange: (effort: string) => void
  /**
   * Hand the prompt off. Returning a promise that rejects puts the text and
   * its attachments back in the box — a refused send must never eat what the
   * user typed, because the refusal (a missing workspace, a busy branch) is
   * usually something they fix and then retry with the same words.
   */
  onSend: (text: string) => unknown
  /** Cancel the active run with Escape while composing. */
  onStop?: () => void
  className?: string
  /** Slash commands to offer, app commands included. */
  commands?: SlashCommand[]
  /** Caveat shown under the menu (see `server/slashCommands.ts`). */
  commandNote?: string
  /** Plugins the runtime's CLI has installed, offered behind `$`. */
  plugins?: AgentPlugin[]
  /** Caveat shown under the `$` menu (see `server/plugins.ts`). */
  pluginNote?: string
  /**
   * Run an app command instead of prompting the agent. Returning a string
   * shows it as an error under the composer; `/help` never gets here.
   */
  onAppCommand?: (input: { command: SlashCommand; args: string }) => string | undefined
  /**
   * Store a dropped/pasted image in the workspace and return its path. Omitted
   * where no workspace is settled yet, which hides the attachment affordances.
   */
  uploadAttachment?: AttachmentUploader
  /**
   * A prompt handed back by a refused send, for the surfaces that unmount this
   * composer while the send is in flight (the start page swaps it for the
   * optimistic turn). Local state cannot survive that, so the owner holds the
   * refused text and seeds it here; a fresh value refills an empty box.
   */
  restoredDraft?: string
}) {
  const [value, setValue] = useState(restoredDraft ?? '')
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuDismissed, setMenuDismissed] = useState(false)
  const [sendMenuOpen, setSendMenuOpen] = useState(false)
  const [commandError, setCommandError] = useState('')
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const dragDepth = useRef(0)
  const sendMenuRef = useRef<HTMLDivElement>(null)
  const files = usePendingAttachments(uploadAttachment)
  // Queueing accepts everything a live send does, attachments included.
  const blocked = disabled || (running && !canQueue)
  const canAttach = Boolean(uploadAttachment) && !blocked

  useClickOutside(sendMenuOpen, () => setSendMenuOpen(false), [sendMenuRef])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  // Refill after a remount. Guarded on emptiness for the same reason the
  // in-place restore is: whatever the user has typed since outranks it.
  useEffect(() => {
    if (!restoredDraft) return
    setValue((current) => draftAfterRefusal(restoredDraft, current))
    ref.current?.focus()
  }, [restoredDraft])

  const query = slashMenuQuery(value)
  const matches = useMemo(
    () => (query === null || !commands ? [] : matchSlashCommands(commands, query)),
    [query, commands],
  )
  const menuOpen = !menuDismissed && !disabled && matches.length > 0
  const active = menuOpen ? matches[Math.min(activeIndex, matches.length - 1)] : undefined

  // A `$` mention can sit anywhere in the prompt, so its menu is driven by the
  // caret rather than the first character — the two never open together.
  const mentionQuery = menuOpen ? null : pluginMenuQuery(value)
  const pluginMatches = useMemo(
    () => (mentionQuery === null || !plugins ? [] : matchPlugins(plugins, mentionQuery)),
    [mentionQuery, plugins],
  )
  const pluginMenuOpen = !menuDismissed && !disabled && pluginMatches.length > 0
  const activePlugin = pluginMenuOpen
    ? pluginMatches[Math.min(activeIndex, pluginMatches.length - 1)]
    : undefined

  const setText = (next: string) => {
    setValue(next)
    setActiveIndex(0)
    setMenuDismissed(false)
    if (commandError) setCommandError('')
  }

  const pick = (command: SlashCommand) => {
    setText(applySlashCommand(command))
    ref.current?.focus()
  }

  const pickPlugin = (plugin: AgentPlugin) => {
    setText(applyPluginMention(value, plugin))
    ref.current?.focus()
  }

  const submit = (now = false) => {
    const text = value.trim()
    if ((!text && files.paths.length === 0) || disabled) return

    // App commands are answered here and never become a turn, so `/model`
    // still lands while a send is in flight.
    const app = commands ? appCommandFor(commands, text) : null
    if (app) {
      if (app.command.action === 'help') {
        setText('/')
        return
      }
      const failure = onAppCommand?.(app)
      if (failure) {
        setCommandError(failure)
        return
      }
      setValue('')
      setCommandError('')
      return
    }

    if (pending || (running && !canQueue) || files.uploading) return
    const prompt = promptWithAttachments(text, files.paths)
    const pendingAttachments = files.detach()
    setValue('')
    setCommandError('')
    const sent = now && onSendNow ? onSendNow(prompt) : onSend(prompt)
    // The box empties optimistically so the send feels immediate, and fills
    // itself back in if the handler refuses. The route renders the reason; all
    // this has to do is not throw away what the user typed.
    void Promise.resolve(sent).then(
      () => pendingAttachments.commit(),
      () => {
        setValue((current) => draftAfterRefusal(value, current))
        pendingAttachments.restore()
        ref.current?.focus()
      },
    )
  }

  const pickSendAction = (now: boolean) => {
    setSendMenuOpen(false)
    submit(now)
  }

  const canSend =
    !blocked && !pending && !files.uploading && (value.trim().length > 0 || files.paths.length > 0)

  return (
    <div className={`relative ${className ?? 'mx-auto w-full min-w-0 max-w-3xl pt-2 pl-2'}`}>
      {menuOpen ? (
        <SlashCommandMenu
          commands={matches}
          activeIndex={Math.min(activeIndex, matches.length - 1)}
          {...(commandNote ? { note: commandNote } : {})}
          onPick={pick}
        />
      ) : null}
      {pluginMenuOpen ? (
        <PluginMentionMenu
          plugins={pluginMatches}
          activeIndex={Math.min(activeIndex, pluginMatches.length - 1)}
          {...(pluginNote ? { note: pluginNote } : {})}
          onPick={pickPlugin}
        />
      ) : null}
      <div
        className="chat-composer-shell rounded-[22px] p-px"
        onDragEnter={(e) => {
          if (!canAttach || !e.dataTransfer.types.includes('Files')) return
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={(e) => {
          if (!canAttach || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={(e) => {
          if (!canAttach) return
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          files.addFiles(imageFilesFrom(e.dataTransfer))
        }}
      >
        <div
          className={`chat-composer-glass rounded-[20px] border transition-[background-color,border-color] duration-200 focus-within:border-ring/45 ${
            disabled ? 'border-border opacity-75' : 'border-border'
          }`}
        >
          <div aria-hidden="true" className="chat-glass-fill" />
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[20px] border-2 border-dashed border-ring/60 bg-background/80 text-ui-sm text-foreground">
              Drop images to attach
            </div>
          ) : null}
          <div className="relative px-3 pb-2 pt-3 sm:px-3.5 sm:pt-3.5">
            <AttachmentStrip attachments={files.attachments} onRemove={files.remove} />
            <textarea
              ref={ref}
              rows={1}
              value={value}
              disabled={blocked}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                if (!canAttach) return
                const images = imageFilesFrom(e.clipboardData)
                if (images.length === 0) return
                e.preventDefault()
                files.addFiles(images)
              }}
              onKeyDown={(e) => {
                // The composer used to expose a separate stop button. Escape
                // keeps that interruption close to where the user is typing,
                // including when a slash-command or plugin menu is open.
                if (e.key === 'Escape' && running && onStop) {
                  e.preventDefault()
                  onStop()
                  return
                }
                if (pluginMenuOpen && pluginMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveIndex((i) => (i + 1) % pluginMatches.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveIndex((i) => (i - 1 + pluginMatches.length) % pluginMatches.length)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setMenuDismissed(true)
                    return
                  }
                  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                    if (activePlugin) {
                      e.preventDefault()
                      pickPlugin(activePlugin)
                      return
                    }
                  }
                }
                if (menuOpen && matches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveIndex((i) => (i + 1) % matches.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveIndex((i) => (i - 1 + matches.length) % matches.length)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setMenuDismissed(true)
                    return
                  }
                  // Enter and Tab both complete the highlighted command; the
                  // next Enter sends it, so a command with arguments can be
                  // finished before it is submitted.
                  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                    if (active) {
                      e.preventDefault()
                      pick(active)
                      return
                    }
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  // ⌘/Ctrl + ↵ while the agent works: interrupt it rather than
                  // waiting in line behind the turn.
                  submit(running && (e.metaKey || e.ctrlKey))
                }
              }}
              placeholder={
                running && canQueue
                  ? 'Queue a follow-up…'
                  : running
                    ? (runningLabel ?? 'Agent is working…')
                    : disabled
                      ? (disabledReason ?? 'Follow-up unavailable')
                      : (placeholder ?? 'Ask for follow-up changes…')
              }
              className="block max-h-[200px] min-h-[3.25rem] w-full resize-none overflow-y-auto bg-transparent text-[16px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/35 disabled:cursor-not-allowed sm:text-[14px]"
            />
            {commandError || files.refusal ? (
              <div className="pt-1 text-ui-xs text-danger">{commandError || files.refusal}</div>
            ) : null}
          </div>

          <div className="relative flex min-w-0 flex-nowrap items-center gap-1 px-3 pb-2.5 sm:px-3.5 sm:pb-3">
            {leading}
            <ComposerModelControls
              models={models}
              model={model}
              effort={effort}
              disabled={pending || blocked}
              onModelChange={onModelChange}
              onEffortChange={onEffortChange}
            />

            <div className="flex shrink-0 items-center gap-1">
              {!running || canQueue ? (
                <div ref={sendMenuRef} className="relative">
                  {running && sendMenuOpen ? (
                    <div
                      role="menu"
                      aria-label="Send options"
                      className="absolute right-0 bottom-full z-30 mb-2 min-w-36 overflow-hidden rounded-lg border border-border bg-popover p-1 text-ui-sm text-popover-foreground shadow-xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => pickSendAction(true)}
                        className="flex w-full items-center rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                      >
                        Send now
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => pickSendAction(false)}
                        className="flex w-full items-center rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                      >
                        Send to queue
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    disabled={!canSend}
                    onClick={() => (running ? setSendMenuOpen((open) => !open) : submit())}
                    aria-label={pending ? 'Sending' : 'Send message'}
                    aria-haspopup={running ? 'menu' : undefined}
                    aria-expanded={running ? sendMenuOpen : undefined}
                    title={running ? 'Choose when to send' : undefined}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/90 text-primary-foreground transition-colors enabled:cursor-pointer enabled:hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:pointer-events-none disabled:opacity-30"
                  >
                    {pending ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              ) : null}
              {uploadAttachment ? (
                <AttachmentButton
                  disabled={!canAttach || files.full}
                  onFiles={(picked) => files.addFiles(picked)}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

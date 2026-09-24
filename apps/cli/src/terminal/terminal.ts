import type {
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  CliRenderer,
  KeyEvent,
  PasteEvent,
  SelectOption,
  ClipboardService,
  StyledText,
  TextChunk,
} from '@opentui/core'
import { format, stripVTControlCharacters } from 'node:util'
import {
  Back,
  CommandRequest,
  isCommandRequest,
  inputCompletion,
  Quit,
  RequestInput,
  type Choice,
} from './ui.ts'
import { RequestPreview } from '../commands/preview.ts'
import {
  CliSession,
  transcriptText,
  type ActivityItem,
  type StatusCard,
  type TimelineEntry,
} from '../session/session.ts'
import {
  activityCells,
  activityColumns,
  cardDetail,
  cellWidth,
  changeSummary,
  fitLine,
  overviewTable,
  splitAt,
  splitColumns,
  statusIcon,
  stepSplit,
} from './layout.ts'
import { scheduleTime } from './schedule.ts'
import { colors, statusColor } from './palette.ts'
import {
  diffRows,
  fitPath,
  statusMark,
  type ReviewAction,
  type ReviewFile,
  type ReviewView,
  type ReviewWrite,
} from './review.ts'

const navigationKeys = 'Esc back   Ctrl+C clear/quit'
const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const activityKeys = '↑↓ choose   Enter details   Shift+Tab chat   Esc input'
const dividerKeys = 'Drag to resize   Ctrl+Shift+←/→ resize'
const reviewKeys =
  '↑↓ file   PgUp/PgDn scroll   s pull request   c commit   p push   d discard   w whole file   r refresh   Esc back'
const reviewWriteKeys: Record<string, ReviewWrite> = {
  c: 'commit',
  p: 'push',
  s: 'ship',
  d: 'discard',
}

type ReviewState = {
  view: ReviewView
  loadDiff: (path: string, whole: boolean) => Promise<string>
  index: number
  whole: boolean
  diffs: Map<string, string>
  notice?: ReviewView['notice']
  resolve?: (action: ReviewAction) => void
}

/** One owner of terminal input/output for Home, menus, forms and results. */
export class TerminalSurface {
  private core: typeof import('@opentui/core')
  private renderer: CliRenderer
  private clipboard: ClipboardService
  private actions: BoxRenderable
  private promptTitle: TextRenderable
  private panels: BoxRenderable
  private chatPanel: BoxRenderable
  private activityPanel: BoxRenderable
  /** The user can fold Activity away; chat then takes the full width. */
  private activityShown = true
  /** Chat's share of a side-by-side row; the divider and Ctrl+Shift+←/→ move it. */
  private split = 0.5
  private divider: BoxRenderable
  private draggingDivider = false
  private activityToggle: TextRenderable
  /** Chat cards whose status follows Activity; see `renderCards`. */
  private cards: {
    card: StatusCard
    box: BoxRenderable
    icon: TextRenderable
    title: TextRenderable
    detail: TextRenderable
  }[] = []
  private cardTimer?: ReturnType<typeof setInterval>
  private lastBubble?: { box: BoxRenderable; role: TimelineEntry['role'] }
  private detailScroll: ScrollBoxRenderable
  private scheduledScroll: ScrollBoxRenderable
  private overview: TextRenderable
  private work: BoxRenderable
  private workSignature = ''
  private reviewPanel: BoxRenderable
  private reviewBody: BoxRenderable
  private reviewHeader: TextRenderable
  private reviewFiles: ScrollBoxRenderable
  private reviewDiff: ScrollBoxRenderable
  private reviewDiffText: TextRenderable
  private reviewState?: ReviewState
  /** Index into the reviewable Activity rows while Activity has keyboard focus. */
  private activityCursor?: number
  private progress: TextRenderable
  private ghost?: TextRenderable
  private suggestions: TextRenderable
  private preview: RequestPreview
  private notice: TextRenderable
  private footer: TextRenderable
  private status: TextRenderable
  private control?: SelectRenderable | InputRenderable
  private controlFrame?: BoxRenderable
  private promptKeys = `Enter send   ${navigationKeys}`
  private rejectPrompt?: (error: Error) => void
  private interruptedAt = 0
  private reading = false
  private closed = false
  private output = ''
  private unreadOutput = false
  private session: CliSession
  private unsubscribe: () => void
  private renderedEntries = 0
  private renderedGeneration = 0
  private completion?: string
  private history: readonly string[] = []
  private homeAction?: (command: string) => void
  private requesting = false
  private pendingRequestInput?: RequestInput
  private loadingTimer?: ReturnType<typeof setInterval>
  private loadingDelay?: ReturnType<typeof setTimeout>
  private originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  }

  static async create(session = new CliSession()): Promise<TerminalSurface> {
    const core = await import('@opentui/core')
    const renderer = await core.createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: [],
      screenMode: 'alternate-screen',
      consoleMode: 'disabled',
      backgroundColor: colors.background,
      useMouse: true,
      enableMouseMovement: true,
      // Only the prompt control should take focus on click, never a surrounding panel.
      autoFocus: false,
    })
    try {
      return new TerminalSurface(renderer, core, session)
    } catch (error) {
      renderer.destroy()
      throw error
    }
  }

  private constructor(
    renderer: CliRenderer,
    core: typeof import('@opentui/core'),
    session: CliSession,
  ) {
    this.core = core
    this.session = session
    const { BoxRenderable, TextRenderable, ScrollBoxRenderable } = core
    this.renderer = renderer
    renderer.setTerminalTitle('OpenRun')
    this.clipboard = core.createClipboard({
      host: core.createHostClipboard(),
      terminal: core.createRendererClipboardAdapter(renderer),
    })
    renderer.root.flexDirection = 'column'
    const root = new BoxRenderable(renderer, {
      width: '100%',
      height: '100%',
      paddingX: 1,
      flexDirection: 'column',
    })
    const header = new BoxRenderable(renderer, {
      width: '100%',
      flexDirection: 'row',
      height: 1,
      flexShrink: 0,
      marginBottom: 1,
    })
    header.add(
      new TextRenderable(renderer, {
        content: 'Open Run',
        fg: colors.info,
        attributes: core.TextAttributes.BOLD,
        flexGrow: 1,
        height: 1,
        selectable: false,
      }),
    )
    this.status = new TextRenderable(renderer, {
      content: '',
      fg: colors.muted,
      height: 1,
      selectable: false,
    })
    header.add(this.status)
    this.activityToggle = new TextRenderable(renderer, {
      id: 'activity-toggle',
      content: '',
      height: 1,
      flexShrink: 0,
      marginLeft: 2,
      selectable: false,
      onMouseDown: (event) => {
        if (event.button === this.core.MouseButton.LEFT) this.toggleActivity()
      },
      onMouseOver: () =>
        this.setFooter(`Click to ${this.activityShown ? 'hide' : 'show'} Activity`),
      onMouseOut: () =>
        this.setFooter(this.activityCursor === undefined ? this.promptKeys : activityKeys),
    })
    header.add(this.activityToggle)
    root.add(header)
    this.panels = new BoxRenderable(renderer, {
      id: 'session-panels',
      width: '100%',
      flexGrow: 1,
      flexBasis: 0,
      flexShrink: 1,
      minHeight: 0,
      flexDirection: 'row',
      marginBottom: 1,
      // A drag starts on the divider but is captured by whatever cell it first
      // crosses, so the row follows it: drag events bubble up to here.
      onMouseDrag: (event) => {
        if (!this.draggingDivider) return
        this.setSplit(splitAt(event.x, this.panels.screenX, this.panels.width))
      },
      onMouseDragEnd: () => this.releaseDivider(),
      onMouseUp: () => this.releaseDivider(),
    })
    this.chatPanel = new BoxRenderable(renderer, {
      id: 'chat-panel',
      width: '100%',
      height: '100%',
      minWidth: 0,
      minHeight: 0,
      flexDirection: 'column',
      paddingRight: 1,
    })
    this.detailScroll = new ScrollBoxRenderable(renderer, {
      id: 'session-timeline',
      width: '100%',
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 1,
      scrollX: false,
      scrollY: true,
      stickyScroll: true,
      stickyStart: 'bottom',
      contentOptions: { flexDirection: 'column', minHeight: 0, paddingRight: 1 },
      verticalScrollbarOptions: {
        width: 1,
        trackOptions: { backgroundColor: colors.background, foregroundColor: colors.border },
      },
    })
    this.chatPanel.add(this.detailScroll)
    this.panels.add(this.chatPanel)
    // The line between chat and Activity is the handle, so it is its own renderable.
    this.divider = new BoxRenderable(renderer, {
      id: 'split-divider',
      width: 1,
      height: '100%',
      flexShrink: 0,
      border: ['left'],
      borderColor: colors.border,
      onMouseDown: (event) => {
        if (event.button !== this.core.MouseButton.LEFT) return
        event.preventDefault()
        this.draggingDivider = true
        this.divider.borderColor = colors.info
      },
      onMouseOver: () => {
        this.divider.borderColor = colors.info
        this.setFooter(dividerKeys)
      },
      onMouseOut: () => {
        if (this.draggingDivider) return
        this.divider.borderColor = colors.border
        this.setFooter(this.activityCursor === undefined ? this.promptKeys : activityKeys)
      },
    })
    this.panels.add(this.divider)
    this.activityPanel = new BoxRenderable(renderer, {
      id: 'activity-panel',
      width: '100%',
      height: '100%',
      minWidth: 0,
      minHeight: 0,
      flexDirection: 'column',
      borderColor: colors.border,
      paddingLeft: 1,
    })
    this.activityPanel.add(
      new TextRenderable(renderer, {
        content: 'Activity',
        fg: colors.info,
        height: 1,
        flexShrink: 0,
        attributes: core.TextAttributes.BOLD,
        selectable: false,
      }),
    )
    this.scheduledScroll = new ScrollBoxRenderable(renderer, {
      id: 'pending-and-active',
      width: '100%',
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      scrollX: false,
      scrollY: true,
      contentOptions: { flexDirection: 'column', minHeight: 0, paddingRight: 1 },
      verticalScrollbarOptions: {
        width: 1,
        trackOptions: { backgroundColor: colors.background, foregroundColor: colors.border },
      },
    })
    this.work = new BoxRenderable(renderer, {
      id: 'live-work',
      width: '100%',
      flexDirection: 'column',
      flexShrink: 0,
    })
    this.scheduledScroll.add(this.work)
    this.activityPanel.add(this.scheduledScroll)
    this.panels.add(this.activityPanel)
    this.reviewPanel = new BoxRenderable(renderer, {
      id: 'review-panel',
      width: '100%',
      height: '100%',
      minHeight: 0,
      flexDirection: 'column',
      visible: false,
    })
    this.reviewHeader = new TextRenderable(renderer, {
      id: 'review-header',
      content: '',
      fg: colors.secondary,
      width: '100%',
      wrapMode: 'word',
      flexShrink: 0,
      marginBottom: 1,
    })
    this.reviewPanel.add(this.reviewHeader)
    this.reviewBody = new BoxRenderable(renderer, {
      id: 'review-body',
      width: '100%',
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      flexDirection: 'row',
    })
    this.reviewFiles = new ScrollBoxRenderable(renderer, {
      id: 'review-files',
      width: '30%',
      height: '100%',
      minWidth: 0,
      flexShrink: 0,
      scrollX: false,
      scrollY: true,
      border: ['right'],
      borderColor: colors.border,
      contentOptions: { flexDirection: 'column', minHeight: 0, paddingRight: 1 },
      verticalScrollbarOptions: {
        width: 1,
        trackOptions: { backgroundColor: colors.background, foregroundColor: colors.border },
      },
    })
    this.reviewDiff = new ScrollBoxRenderable(renderer, {
      id: 'review-diff',
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      minHeight: 0,
      scrollX: true,
      scrollY: true,
      contentOptions: { flexDirection: 'column', minHeight: 0, paddingLeft: 1 },
      verticalScrollbarOptions: {
        width: 1,
        trackOptions: { backgroundColor: colors.background, foregroundColor: colors.border },
      },
    })
    this.reviewDiffText = new TextRenderable(renderer, {
      id: 'review-diff-text',
      content: '',
      fg: colors.secondary,
      wrapMode: 'none',
      flexShrink: 0,
    })
    this.reviewDiff.add(this.reviewDiffText)
    this.reviewBody.add(this.reviewFiles)
    this.reviewBody.add(this.reviewDiff)
    this.reviewPanel.add(this.reviewBody)
    this.panels.add(this.reviewPanel)
    root.add(this.panels)
    this.notice = new TextRenderable(renderer, {
      content: '',
      fg: colors.warning,
      selectable: false,
      width: '100%',
      height: 1,
      flexShrink: 0,
      visible: false,
    })
    root.add(this.notice)
    this.actions = new BoxRenderable(renderer, {
      width: '100%',
      flexShrink: 0,
      flexDirection: 'column',
    })
    this.promptTitle = new TextRenderable(renderer, {
      content: 'What should Open Run do?',
      fg: colors.text,
      height: 1,
      attributes: core.TextAttributes.BOLD,
      selectable: false,
      width: '100%',
    })
    this.actions.add(this.promptTitle)
    this.suggestions = new TextRenderable(renderer, {
      content: '',
      fg: colors.muted,
      width: '100%',
      height: 1,
      visible: false,
      flexShrink: 0,
      selectable: false,
    })
    this.actions.add(this.suggestions)
    this.preview = new RequestPreview((message) => {
      // Completion belongs inside the input. Only a task interpretation needs a separate hint.
      this.suggestions.content = fitLine(message.split('\n')[0] || '', this.renderer.width - 2)
      this.suggestions.visible = Boolean(message) && !this.completion
    })
    this.progress = new TextRenderable(renderer, {
      content: '',
      fg: colors.keyword,
      width: '100%',
      height: 1,
      flexShrink: 0,
      visible: false,
      selectable: false,
    })
    this.actions.add(this.progress)
    root.add(this.actions)
    this.overview = new TextRenderable(renderer, {
      id: 'overview-counts',
      content: '',
      fg: colors.secondary,
      width: '100%',
      height: 1,
      flexShrink: 0,
      marginTop: 1,
      selectable: false,
    })
    root.add(this.overview)
    this.footer = new TextRenderable(renderer, {
      id: 'keyboard-help',
      content: '',
      fg: colors.muted,
      width: '100%',
      height: 1,
      minHeight: 1,
      maxHeight: 1,
      flexShrink: 0,
      selectable: false,
    })
    root.add(this.footer)
    renderer.root.add(root)
    renderer.keyInput.on('keypress', this.onKey)
    renderer.keyInput.on('paste', this.onPaste)
    renderer.on('resize', this.resize)
    this.unsubscribe = this.session.subscribe(() => this.renderSession())
    this.renderSession()
    this.resize()
    for (const method of ['log', 'error', 'warn', 'info'] as const)
      console[method] = (...values: unknown[]) => this.write(format(...values))
    process.on('SIGINT', this.exit)
    process.on('SIGTERM', this.exit)
    process.on('SIGHUP', this.exit)
  }

  private resize = (): void => {
    this.status.visible = this.renderer.width >= 65
    const stacked = this.renderer.width < 72
    const reviewing = Boolean(this.reviewState)
    const split = this.activityShown && !reviewing
    const columns = splitColumns(this.split, this.renderer.width - 2)
    this.chatPanel.visible = !reviewing
    this.activityPanel.visible = split
    this.divider.visible = split && !stacked
    this.reviewPanel.visible = reviewing
    this.renderActivityToggle()
    this.panels.flexDirection = stacked ? 'column' : 'row'
    this.chatPanel.width = stacked || !split ? '100%' : columns.chat
    this.chatPanel.height = stacked && split ? '60%' : '100%'
    this.chatPanel.paddingRight = stacked || !split ? 0 : 1
    this.activityPanel.width = stacked ? '100%' : columns.activity
    this.activityPanel.height = stacked ? '40%' : '100%'
    this.activityPanel.border = stacked ? ['top'] : false
    this.activityPanel.paddingLeft = stacked ? 0 : 1
    this.reviewBody.flexDirection = stacked ? 'column' : 'row'
    this.reviewFiles.width = stacked ? '100%' : '30%'
    this.reviewFiles.height = stacked
      ? Math.min(Math.max(1, this.reviewState?.view.files.length ?? 1), 6)
      : '100%'
    this.reviewFiles.border = stacked ? ['bottom'] : ['right']
    if (this.reviewState) this.renderReviewFiles()
    this.workSignature = ''
    if (this.control instanceof this.core.SelectRenderable)
      this.control.height = this.menuHeight(this.control.options.length)
    this.renderOverview()
    this.setFooter(this.promptKeys)
    this.renderCompletion()
  }

  private setSplit(ratio: number): void {
    if (ratio === this.split) return
    this.split = ratio
    this.resize()
    this.setFooter(dividerKeys)
  }

  private releaseDivider(): void {
    if (!this.draggingDivider) return
    this.draggingDivider = false
    this.divider.borderColor = colors.border
    this.setFooter(this.activityCursor === undefined ? this.promptKeys : activityKeys)
  }

  /** Ctrl+Shift+←/→ moves the divider; arrows alone and with Ctrl/Alt stay the input's. */
  private splitKey(key: KeyEvent): boolean {
    if (!key.ctrl || !key.shift || (key.name !== 'left' && key.name !== 'right')) return false
    key.preventDefault()
    key.stopPropagation()
    if (this.divider.visible)
      this.setSplit(stepSplit(this.split, this.renderer.width - 2, key.name === 'left' ? -1 : 1))
    return true
  }

  private renderActivityToggle(): void {
    const on = this.activityShown
    this.activityToggle.content = new this.core.StyledText([
      this.core.fg(on ? colors.info : colors.muted)(` ${on ? '◨' : '□'} Activity `),
    ])
    this.activityToggle.bg = on ? colors.input : colors.background
    this.activityToggle.visible = !this.reviewState
  }

  private toggleActivity(): void {
    this.activityShown = !this.activityShown
    if (!this.activityShown) {
      this.leaveActivity()
      if (this.control && !this.reading) this.control.focus()
    }
    this.resize()
    this.setFooter(`Click to ${this.activityShown ? 'hide' : 'show'} Activity`)
  }

  private setFooter(message: string): void {
    this.footer.content = fitLine(message, this.renderer.width - 2)
  }

  /** Small syntax accents for command results, without changing saved transcript text. */
  private styledText(text: string, base = colors.secondary): StyledText {
    const chunks: TextChunk[] = []
    const tokens =
      /\b(?:Claude(?: Code)?|Codex|Grok|Gemini|Antigravity|fx)\b|(?:https?:\/\/|(?:\.{0,2}|~)\/)[^\s]+|`[^`\n]+`|\b\d+(?:[.:]\d+)*\b|\b(?:running|queued|scheduled|preparing|completed|succeeded|success|failed|cancelled|paused)\b/gi
    let offset = 0
    for (const match of text.matchAll(tokens)) {
      chunks.push(this.core.fg(base)(text.slice(offset, match.index)))
      const token = match[0]
      const lower = token.toLowerCase()
      let color = statusColor(token)
      if (lower.startsWith('claude')) color = colors.claude
      else if (lower === 'gemini') color = colors.gemini
      else if (/^(codex|grok|antigravity|fx)$/.test(lower)) color = colors.text
      else if (/^\d/.test(token)) color = colors.number
      else if (token.startsWith('`')) color = colors.function
      else if (token.includes('/')) color = colors.link
      chunks.push(this.core.fg(color)(token))
      offset = match.index + token.length
    }
    chunks.push(this.core.fg(base)(text.slice(offset)))
    return new this.core.StyledText(chunks)
  }

  private renderSession(): void {
    const replaced = this.renderedGeneration !== this.session.generation
    if (replaced) {
      // /clear and /resume replace the timeline; redraw it from the first entry.
      for (const child of this.detailScroll.getChildren()) child.destroyRecursively()
      this.cards = []
      this.lastBubble = undefined
      this.renderedEntries = 0
      this.renderedGeneration = this.session.generation
    }
    for (const entry of this.session.entries.slice(this.renderedEntries)) {
      if (entry.card) {
        this.addCard(entry, entry.card)
        continue
      }
      const bubble = new this.core.BoxRenderable(this.renderer, {
        id: entry.id,
        width: '100%',
        flexDirection: 'column',
        flexShrink: 0,
        marginBottom: 1,
        backgroundColor: entry.role === 'user' ? colors.input : colors.background,
      })
      bubble.add(
        new this.core.TextRenderable(this.renderer, {
          content: entry.role === 'user' ? entry.text : this.styledText(entry.text),
          fg: entry.role === 'user' ? colors.text : colors.secondary,
          width: '100%',
          wrapMode: 'word',
          flexShrink: 0,
        }),
      )
      this.detailScroll.add(bubble)
      this.lastBubble = { box: bubble, role: entry.role }
    }
    this.renderedEntries = this.session.entries.length
    if (replaced) this.detailScroll.scrollTo(this.detailScroll.scrollHeight)
    this.renderOverview()
  }

  /**
   * What a request started, tucked under the prompt that asked for it:
   *
   *   ✓ Scheduled  testabc.txt                    10:24:08
   *     in 10 seconds · claude-sonnet-5 · low effort
   */
  private addCard(entry: TimelineEntry, card: StatusCard): void {
    const { BoxRenderable, TextRenderable } = this.core
    // No gap after the prompt, so the card reads as its answer rather than a new message.
    if (this.lastBubble?.role === 'user') this.lastBubble.box.marginBottom = 0
    const box = new BoxRenderable(this.renderer, {
      id: entry.id,
      width: '100%',
      flexDirection: 'row',
      flexShrink: 0,
      marginBottom: 1,
      paddingLeft: 1,
      onMouseDown: (event) => {
        const runId = this.session.activityFor(card)?.runId ?? card.runId
        if (runId && event.button === this.core.MouseButton.LEFT) this.openReview(runId)
      },
      onMouseOver: () => {
        if (this.session.activityFor(card)?.runId ?? card.runId)
          this.setFooter('Click to review this run’s changes')
      },
      onMouseOut: () =>
        this.setFooter(this.activityCursor === undefined ? this.promptKeys : activityKeys),
    })
    const icon = new TextRenderable(this.renderer, {
      content: '',
      width: 2,
      flexShrink: 0,
      selectable: false,
    })
    const body = new BoxRenderable(this.renderer, {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      flexDirection: 'column',
    })
    const head = new BoxRenderable(this.renderer, { width: '100%', flexDirection: 'row' })
    const title = new TextRenderable(this.renderer, {
      content: '',
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      wrapMode: 'word',
    })
    head.add(title)
    if (card.time)
      head.add(
        new TextRenderable(this.renderer, {
          content: card.time,
          fg: colors.muted,
          flexShrink: 0,
          marginLeft: 2,
          selectable: false,
        }),
      )
    const detail = new TextRenderable(this.renderer, {
      content: '',
      fg: colors.muted,
      width: '100%',
      wrapMode: 'word',
    })
    body.add(head)
    body.add(detail)
    box.add(icon)
    box.add(body)
    this.detailScroll.add(box)
    this.lastBubble = { box, role: entry.role }
    this.cards.push({ card, box, icon, title, detail })
    this.renderCards()
  }

  /** Cards take their status from Activity, and count down while a schedule waits. */
  private renderCards(): void {
    const now = Date.now()
    let waiting = false
    for (const { card, icon, title, detail } of this.cards) {
      const status = this.session.activityFor(card)?.status ?? card.status
      const color = statusColor(status)
      icon.content = new this.core.StyledText([this.core.fg(color)(statusIcon(status))])
      title.content = new this.core.StyledText([
        this.core.fg(color)(status),
        this.core.fg(colors.text)(`  ${transcriptText(card.title)}`),
      ])
      detail.content = cardDetail(card, status, now)
      if (card.at && card.at > now && /^scheduled$/i.test(status)) waiting = true
    }
    if (waiting && !this.cardTimer) {
      this.cardTimer = setInterval(() => this.renderCards(), 1000)
      this.cardTimer.unref()
    } else if (!waiting && this.cardTimer) {
      clearInterval(this.cardTimer)
      this.cardTimer = undefined
    }
  }

  private renderOverview(): void {
    const width = Math.max(1, this.renderer.width - 2)
    const overview = overviewTable(this.session.overview, width)
    this.overview.content = this.styledText(overview, colors.muted)
    this.overview.height = overview.split('\n').length
    this.notice.content = fitLine(this.session.overview.error || '', width)
    this.notice.visible = Boolean(this.session.overview.error)
    this.renderActivity()
    this.renderCards()
  }

  /** Requests the user can open in Review: runs that exist, newest last. */
  private get reviewableRuns(): string[] {
    return this.session.activity.flatMap((item) => (item.runId ? [item.runId] : []))
  }

  /** One row per item, so a click or the keyboard can open the run behind it. */
  private renderActivity(): void {
    // Silent requests are clicks; they belong to Review, not the Activity list.
    const pending = [
      ...(this.session.current && !this.session.current.silent ? [this.session.current] : []),
      ...this.session.pending.filter((request) => !request.silent),
    ].map(
      (request): ActivityItem => ({
        prompt: transcriptText(request.text),
        status: request.detail,
        time: scheduleTime(request.at),
      }),
    )
    const rows = [...pending, ...this.session.activity]
    const runs = this.reviewableRuns
    if (this.activityCursor !== undefined) {
      if (!runs.length) this.leaveActivity()
      else this.activityCursor = Math.min(this.activityCursor, runs.length - 1)
    }
    const chosen = this.activityCursor === undefined ? undefined : runs[this.activityCursor]
    // Root padding, the panel's padding, the scrollbar and its gutter.
    const width =
      this.renderer.width < 72
        ? this.renderer.width - 4
        : splitColumns(this.split, this.renderer.width - 2).activity - 3
    const columns = activityColumns(rows)
    const cells = rows.map((row) =>
      activityCells({ ...row, prompt: transcriptText(row.prompt) }, columns, width),
    )
    const signature = JSON.stringify([cells, chosen, rows.map((row) => row.runId)])
    if (signature === this.workSignature) return
    this.workSignature = signature
    for (const child of this.work.getChildren()) child.destroyRecursively()
    rows.forEach((row, index) => {
      const selected = Boolean(row.runId) && row.runId === chosen
      const cell = cells[index]!
      const box = new this.core.BoxRenderable(this.renderer, {
        id: `activity-row-${index}`,
        width: '100%',
        flexDirection: 'column',
        flexShrink: 0,
        backgroundColor: selected ? colors.input : colors.background,
        onMouseDown: row.runId
          ? (event) => {
              if (event.button !== this.core.MouseButton.LEFT) return
              this.openReview(row.runId!)
            }
          : undefined,
        onMouseOver: row.runId
          ? () => {
              box.backgroundColor = colors.input
              this.setFooter('Click for details: changes, model and effort')
            }
          : undefined,
        onMouseOut: row.runId
          ? () => {
              box.backgroundColor = selected ? colors.input : colors.background
              this.setFooter(this.activityCursor === undefined ? this.promptKeys : activityKeys)
            }
          : undefined,
      })
      const fg = this.core.fg
      box.add(
        new this.core.TextRenderable(this.renderer, {
          content: new this.core.StyledText([
            fg(statusColor(row.status))(cell.status),
            fg(colors.muted)(cell.time ? `  ${cell.time}  ` : '  '),
            fg(row.runId ? colors.secondary : colors.muted)(cell.prompt),
            fg(colors.muted)(cell.changes ? `  ${cell.changes}` : ''),
          ]),
          width: '100%',
          wrapMode: 'none',
          flexShrink: 0,
          selectable: false,
        }),
      )
      this.work.add(box)
    })
    if (chosen) {
      const index = rows.findIndex((row) => row.runId === chosen)
      if (index >= 0) this.scheduledScroll.scrollChildIntoView(`activity-row-${index}`)
    }
  }

  private focusActivity(): boolean {
    const runs = this.reviewableRuns
    if (!runs.length || !this.activityShown) return false
    this.reading = false
    this.activityCursor = runs.length - 1
    this.control?.blur()
    this.setFooter(activityKeys)
    this.renderActivity()
    return true
  }

  private leaveActivity(): void {
    if (this.activityCursor === undefined) return
    this.activityCursor = undefined
    this.workSignature = ''
    this.control?.focus()
    this.setFooter(this.promptKeys)
  }

  private activityKey(key: KeyEvent): boolean {
    const runs = this.reviewableRuns
    const cursor = this.activityCursor ?? 0
    if (key.name === 'up' || key.name === 'down') {
      this.activityCursor = Math.max(
        0,
        Math.min(runs.length - 1, cursor + (key.name === 'up' ? -1 : 1)),
      )
      this.renderActivity()
    } else if (['return', 'kpenter', 'linefeed'].includes(key.name)) {
      const runId = runs[cursor]
      if (runId) this.openReview(runId)
    } else if (key.name === 'escape') {
      this.leaveActivity()
      this.renderActivity()
    } else return false
    key.preventDefault()
    key.stopPropagation()
    return true
  }

  /** A click or Enter on an Activity row becomes a `review` request, without a chat echo. */
  private openReview(runId: string): void {
    if (this.reviewState || this.closed) return
    this.leaveActivity()
    const request = `review ${runId}`
    this.session.enqueue(request, true)
    if (this.requesting) this.homeAction?.(request)
    else this.rejectPrompt?.(new CommandRequest(request, true))
  }

  private renderCompletion(): void {
    const input = this.control instanceof this.core.InputRenderable ? this.control : undefined
    if (!input || !this.ghost) return
    this.completion =
      this.requesting && input.cursorOffset === input.value.length
        ? inputCompletion(input.value, this.history)
        : undefined
    const used = cellWidth(input.value)
    const suffix = this.completion?.startsWith(input.value)
      ? this.completion.slice(input.value.length)
      : this.completion
        ? ` → ${this.completion}`
        : ''
    this.ghost.left = used + 1
    this.ghost.content = fitLine(suffix, this.renderer.width - used - 7)
    this.ghost.visible = Boolean(suffix) && used < this.renderer.width - 8
    if (this.completion) this.suggestions.visible = false
    if (this.requesting && !this.reading && this.activityCursor === undefined)
      this.setFooter(this.completion ? `Tab/Enter accept   ${navigationKeys}` : this.promptKeys)
  }

  private acceptCompletion(): boolean {
    this.renderCompletion()
    if (!this.completion || !(this.control instanceof this.core.InputRenderable)) return false
    this.control.value = this.completion
    this.control.gotoBufferEnd()
    this.control.clearSelection()
    this.renderCompletion()
    return true
  }

  private menuHeight(count: number): number {
    return Math.min(8, count, Math.max(1, this.renderer.height - 15))
  }

  private exit = (): void => {
    this.close()
    process.exit(0)
  }

  private requestInput(initial = ''): void {
    // Several keys may arrive in one read before the prompt promise unwinds.
    if (this.pendingRequestInput) {
      this.pendingRequestInput.initial += initial
      return
    }
    const previous =
      this.control instanceof this.core.InputRenderable
        ? this.control.value
        : String(this.control?.getSelectedOption()?.value ?? '')
    if (this.rejectPrompt) {
      this.pendingRequestInput = new RequestInput(initial, previous)
      this.rejectPrompt(this.pendingRequestInput)
    }
  }

  private onPaste = (event: PasteEvent): void => {
    if (!this.control || (!this.rejectPrompt && !this.requesting)) return
    event.preventDefault()
    event.stopPropagation()
    this.insertPaste(event.bytes)
  }

  private insertPaste(bytes: Uint8Array): void {
    const text = stripVTControlCharacters(new TextDecoder().decode(bytes)).replace(
      /\r\n|[\r\n\t]/g,
      ' ',
    )
    if (!text) return
    this.interruptedAt = 0
    this.leaveActivity()
    this.setFooter(this.promptKeys)
    if (this.control instanceof this.core.InputRenderable) {
      this.reading = false
      this.control.focus()
      this.control.deleteSelection()
      this.control.insertText(text)
    } else this.requestInput(text)
  }

  private async copyInput(text: string): Promise<void> {
    if (!text) return
    try {
      const result = await this.clipboard.writeText(text, { destination: 'best-available' })
      if (this.closed) return
      if (result.host.status === 'written' || result.terminal.status === 'attempted')
        this.setFooter('Copied to clipboard')
      else
        this.info(
          'Clipboard unavailable. Hold Shift while selecting text, then use your terminal’s Copy command.',
        )
    } catch {
      if (!this.closed) this.info('Could not copy. Use your terminal’s Copy command.')
    }
  }

  private async pasteClipboard(): Promise<void> {
    const control = this.control
    const unavailable = () =>
      this.info('Use your terminal’s Paste command (Ctrl+Shift+V or Cmd+V).')
    if (this.renderer.capabilities?.remote) {
      unavailable()
      return
    }
    try {
      const result = await this.clipboard.read({ preferredTypes: ['text/plain'] })
      if (this.closed || this.control !== control) return
      if (result.status === 'read') this.insertPaste(result.representation.bytes)
      else if (result.status !== 'empty') unavailable()
    } catch {
      if (!this.closed && this.control === control) unavailable()
    }
  }

  private clearInput(): boolean {
    if (this.pendingRequestInput) {
      if (!this.pendingRequestInput.initial) return false
      this.pendingRequestInput.initial = ''
      this.pendingRequestInput.submitted = false
      return true
    }
    if (!(this.control instanceof this.core.InputRenderable) || !this.control.value) return false
    this.control.value = ''
    this.control.clearSelection()
    this.reading = false
    this.control.focus()
    return true
  }

  private onKey = (key: KeyEvent): void => {
    const input = this.control instanceof this.core.InputRenderable ? this.control : undefined
    const shortcut = key.ctrl || key.meta || key.super
    const copy = (shortcut && key.name === 'c') || (key.ctrl && key.name === 'insert')
    if (
      input &&
      copy &&
      (input.hasSelection() || key.shift || key.meta || key.super || key.name === 'insert')
    ) {
      key.preventDefault()
      key.stopPropagation()
      this.interruptedAt = 0
      void this.copyInput(input.getSelectedText() || input.value)
      return
    }
    if (input && shortcut && key.name === 'a') {
      key.preventDefault()
      key.stopPropagation()
      this.interruptedAt = 0
      this.reading = false
      input.focus()
      input.selectAll()
      return
    }
    if (
      (this.rejectPrompt || this.requesting) &&
      ((shortcut && key.name === 'v') || (key.shift && key.name === 'insert'))
    ) {
      key.preventDefault()
      key.stopPropagation()
      this.interruptedAt = 0
      void this.pasteClipboard()
      return
    }
    if (key.ctrl && key.name === 'c') {
      key.preventDefault()
      key.stopPropagation()
      if (Date.now() - this.interruptedAt < 2000) {
        if (this.rejectPrompt) this.rejectPrompt(new Quit())
        else this.exit()
      } else {
        this.interruptedAt = Date.now()
        this.clearInput()
        this.setFooter('Ctrl+C again to quit. Running work continues.')
      }
      return
    }
    this.interruptedAt = 0
    if (this.splitKey(key)) return
    if (this.reviewState?.resolve && this.reviewKey(key)) return
    if (this.activityCursor !== undefined && this.activityKey(key)) return
    this.setFooter(this.promptKeys)
    if (
      this.pendingRequestInput &&
      ['return', 'kpenter', 'linefeed', 'escape', 'backspace'].includes(key.name)
    ) {
      key.preventDefault()
      key.stopPropagation()
      if (key.name === 'escape') {
        if (!this.clearInput()) this.pendingRequestInput.cancelled = true
      } else if (key.name === 'backspace')
        this.pendingRequestInput.initial = [...this.pendingRequestInput.initial]
          .slice(0, -1)
          .join('')
      else this.pendingRequestInput.submitted = true
      return
    }
    if (
      this.control instanceof this.core.SelectRenderable &&
      this.rejectPrompt &&
      !key.ctrl &&
      !key.meta &&
      !key.option &&
      !key.super &&
      !key.hyper &&
      key.sequence &&
      Array.from(key.sequence).every((char) => {
        const code = char.charCodeAt(0)
        return code > 31 && code !== 127
      })
    ) {
      key.preventDefault()
      key.stopPropagation()
      this.requestInput(key.sequence)
    } else if (key.name === 'escape') {
      key.preventDefault()
      key.stopPropagation()
      if (!this.clearInput()) this.rejectPrompt?.(new Back())
    } else if (key.name === 'tab' && !key.shift) {
      key.preventDefault()
      key.stopPropagation()
      this.acceptCompletion()
    } else if (key.name === 'tab' && key.shift) {
      // Focus cycles input → Activity → chat → input; Activity is skipped until a run exists.
      key.preventDefault()
      key.stopPropagation()
      if (this.activityCursor !== undefined) {
        this.leaveActivity()
        this.renderActivity()
        this.reading = true
      } else if (this.reading) this.reading = false
      else if (!this.focusActivity()) this.reading = true
      if (this.activityCursor !== undefined) return
      if (this.reading) this.detailScroll.focus()
      else this.control?.focus()
      this.setFooter(this.reading ? '↑↓ scroll   Shift+Tab input   Esc back' : this.promptKeys)
    } else if (['pageup', 'pagedown'].includes(key.name)) {
      key.preventDefault()
      key.stopPropagation()
      const scroll = key.shift ? this.scheduledScroll : this.detailScroll
      scroll.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport')
    }
    // Reposition ghost text after the control has applied cursor movement.
    queueMicrotask(() => {
      if (!this.closed) this.renderCompletion()
    })
  }

  setStatus(message: string): void {
    this.status.content = message
  }

  info(message: string): void {
    if (message.trim()) this.session.log('assistant', message)
  }

  note(message: string, title: string): void {
    this.session.log('assistant', `${title}\n${message}`)
  }

  beginAction(): void {
    this.unreadOutput = false
    this.startLoading()
  }

  endAction(): void {
    this.stopLoading()
  }

  write(message: string): void {
    this.unreadOutput = true
    this.output = `${this.output}${stripVTControlCharacters(message)}\n`.slice(-100_000)
    this.session.log('assistant', message)
  }

  get hasUnreadOutput(): boolean {
    return this.unreadOutput
  }

  /** Small, delayed progress beside the action; never replaces the input or overview. */
  private startLoading(): void {
    if (this.closed || this.loadingTimer || this.loadingDelay) return
    this.loadingDelay = setTimeout(() => {
      this.loadingDelay = undefined
      const started = Date.now()
      const render = () => {
        const frame = loadingFrames[Math.floor((Date.now() - started) / 80) % loadingFrames.length]
        this.progress.content = fitLine(
          `${frame} ${this.session.current?.detail || 'Working'}…`,
          this.renderer.width - 2,
        )
        this.progress.visible = true
      }
      render()
      this.loadingTimer = setInterval(render, 80)
      this.loadingTimer.unref()
    }, 180)
    this.loadingDelay.unref()
  }

  private stopLoading(): void {
    clearTimeout(this.loadingDelay)
    clearInterval(this.loadingTimer)
    this.loadingDelay = undefined
    this.loadingTimer = undefined
    this.progress.visible = false
  }

  private clearControl(): void {
    this.leaveActivity()
    this.stopLoading()
    this.preview.cancel()
    if (this.requesting && this.control instanceof this.core.InputRenderable)
      this.session.draft = this.control.value
    this.controlFrame?.destroyRecursively()
    this.ghost = undefined
    this.completion = undefined
    this.controlFrame = undefined
    this.control = undefined
    this.suggestions.content = ''
    this.suggestions.visible = false
    this.reading = false
    this.requesting = false
    this.pendingRequestInput = undefined
    this.rejectPrompt = undefined
  }

  private frameControl(maxWidth?: number): BoxRenderable {
    const isInput = this.control instanceof this.core.InputRenderable
    const frame = new this.core.BoxRenderable(this.renderer, {
      width: '100%',
      maxWidth,
      flexShrink: 0,
      border: true,
      borderStyle: 'rounded',
      borderColor: isInput ? colors.info : colors.border,
      focusedBorderColor: colors.info,
      backgroundColor: isInput ? colors.input : colors.background,
      paddingX: 1,
      paddingY: 0,
      marginTop: 0,
      onMouseDown: (event) => {
        if (event.button !== this.core.MouseButton.LEFT) return
        this.reading = false
        this.leaveActivity()
        this.control?.focus()
        this.setFooter(this.promptKeys)
      },
    })
    this.controlFrame = frame
    this.actions.insertBefore(frame, this.suggestions)
    return frame
  }

  async select(message: string, choices: Choice[], initial?: string): Promise<string> {
    if (this.closed) throw new Quit()
    this.clearControl()
    this.unreadOutput = false
    this.promptTitle.content = fitLine(message, this.renderer.width - 2)
    this.promptTitle.visible = true
    this.session.log('assistant', message)
    this.promptKeys = `↑↓ move   Enter select   Type to ask   ${navigationKeys}`
    this.setFooter(this.promptKeys)
    const menu = new this.core.SelectRenderable(this.renderer, {
      width: '100%',
      height: this.menuHeight(choices.length),
      options: choices.map((choice) => ({
        name: choice.label,
        description: choice.hint ?? '',
        value: choice.value,
      })),
      selectedIndex: Math.max(
        0,
        choices.findIndex((choice) => choice.value === initial),
      ),
      showDescription: false,
      showScrollIndicator: true,
      showSelectionIndicator: true,
      wrapSelection: true,
      backgroundColor: colors.background,
      focusedBackgroundColor: colors.background,
      textColor: colors.secondary,
      focusedTextColor: colors.secondary,
      selectedBackgroundColor: colors.background,
      selectedTextColor: colors.info,
      descriptionColor: colors.muted,
      selectedDescriptionColor: colors.muted,
    })
    this.control = menu
    this.frameControl(72).add(menu)
    menu.focus()
    const hint = () => {
      const description = menu.getSelectedOption()?.description ?? ''
      this.suggestions.content = fitLine(description, this.renderer.width - 2)
      this.suggestions.visible = Boolean(description)
    }
    menu.on(this.core.SelectRenderableEvents.SELECTION_CHANGED, hint)
    hint()
    try {
      return await new Promise<string>((resolve, reject) => {
        this.rejectPrompt = reject
        menu.on(
          this.core.SelectRenderableEvents.ITEM_SELECTED,
          (_index: number, option: SelectOption) => {
            this.session.answer(option.name)
            resolve(String(option.value))
          },
        )
      })
    } finally {
      this.clearControl()
      this.startLoading()
    }
  }

  async text(
    message: string,
    initial: string,
    validate?: (value: string) => string | undefined,
    optional = false,
  ): Promise<string> {
    if (this.closed) throw new Quit()
    this.clearControl()
    this.unreadOutput = false
    this.promptTitle.content = fitLine(message, this.renderer.width - 2)
    this.promptTitle.visible = true
    this.session.log('assistant', message)
    this.promptKeys = `Enter continue   Ctrl+Enter use as value   ${navigationKeys}`
    this.setFooter(this.promptKeys)
    const input = new this.core.InputRenderable(this.renderer, {
      width: '100%',
      value: initial,
      maxLength: 100_000,
      backgroundColor: colors.background,
      focusedBackgroundColor: colors.background,
      textColor: colors.text,
      focusedTextColor: colors.text,
      cursorColor: colors.info,
      selectionBg: colors.button,
      selectionFg: colors.buttonText,
    })
    this.control = input
    this.frameControl().add(input)
    input.on(this.core.InputRenderableEvents.INPUT, (value: string) => {
      this.preview.update(value.trim() !== initial.trim() && isCommandRequest(value) ? value : '')
    })
    input.focus()
    try {
      return await new Promise<string>((resolve, reject) => {
        this.rejectPrompt = reject
        const submit = (raw: string, literal = false) => {
          const value = raw.trim()
          if (!literal && value !== initial.trim() && isCommandRequest(value)) {
            reject(new CommandRequest(value))
            return
          }
          const error =
            !value && !optional ? 'Enter a value, or press Esc to go back.' : validate?.(value)
          if (error) this.info(error)
          else {
            this.session.answer(
              /token|secret|password|api.?key/i.test(message) ? '[hidden]' : value,
            )
            resolve(value)
          }
        }
        input.on(this.core.InputRenderableEvents.ENTER, submit)
        input.onKeyDown = (key) => {
          if (key.ctrl && ['return', 'kpenter', 'linefeed'].includes(key.name)) {
            key.preventDefault()
            key.stopPropagation()
            submit(input.value, true)
          }
        }
      })
    } finally {
      this.clearControl()
      this.startLoading()
    }
  }

  /**
   * The run's changes take the place of both panels, like the web's diff panel:
   * where it worked, what it touched, each file's diff, and the git writes.
   * Resolves with the chosen action; the pane stays up until `endReview`.
   */
  async review(
    view: ReviewView,
    loadDiff: (path: string, whole: boolean) => Promise<string>,
  ): Promise<ReviewAction> {
    if (this.closed) throw new Quit()
    this.clearControl()
    this.unreadOutput = false
    const previous = this.reviewState?.view.runId === view.runId ? this.reviewState : undefined
    const previousPath = previous?.view.files[previous.index]?.path
    const kept = view.files.findIndex((file) => file.path === previousPath)
    this.reviewState = {
      view,
      loadDiff,
      index: kept >= 0 ? kept : Math.min(previous?.index ?? 0, Math.max(0, view.files.length - 1)),
      whole: previous?.whole ?? false,
      diffs: new Map(),
      notice: view.notice,
    }
    this.promptTitle.visible = false
    this.promptKeys = reviewKeys
    this.setFooter(this.promptKeys)
    this.resize()
    this.renderReviewHeader()
    this.renderReviewFiles()
    this.loadReviewDiff()
    try {
      return await new Promise<ReviewAction>((resolve, reject) => {
        this.rejectPrompt = reject
        this.reviewState!.resolve = resolve
      })
    } finally {
      if (this.reviewState) this.reviewState.resolve = undefined
      this.rejectPrompt = undefined
      this.startLoading()
    }
  }

  endReview(): void {
    if (!this.reviewState) return
    this.reviewState = undefined
    this.promptTitle.visible = true
    for (const child of this.reviewFiles.getChildren()) child.destroyRecursively()
    this.reviewDiffText.content = ''
    this.workSignature = ''
    this.resize()
    this.renderActivity()
  }

  private reviewKey(key: KeyEvent): boolean {
    const state = this.reviewState!
    const letter = key.ctrl || key.meta || key.super ? '' : key.name
    const write = reviewWriteKeys[letter]
    if (key.name === 'up' || key.name === 'down' || letter === 'k' || letter === 'j') {
      const step = key.name === 'up' || letter === 'k' ? -1 : 1
      const next = Math.max(0, Math.min(state.view.files.length - 1, state.index + step))
      if (next !== state.index) this.selectReviewFile(next)
    } else if (key.name === 'pageup' || key.name === 'pagedown' || key.name === 'space') {
      this.reviewDiff.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport')
    } else if (key.name === 'home' || key.name === 'end') {
      this.reviewDiff.scrollTo(key.name === 'home' ? 0 : this.reviewDiff.scrollHeight)
    } else if (letter === 'w') {
      state.whole = !state.whole
      this.loadReviewDiff()
    } else if (write) {
      const blocked = state.view.blocked[write]
      if (blocked) {
        state.notice = { text: blocked, tone: 'error' }
        this.renderReviewHeader()
      } else state.resolve?.(write)
    } else if (letter === 'r') state.resolve?.('refresh')
    else if (key.name === 'escape' || letter === 'q') state.resolve?.('back')
    else return false
    key.preventDefault()
    key.stopPropagation()
    return true
  }

  private selectReviewFile(index: number): void {
    const state = this.reviewState
    if (!state) return
    state.index = index
    this.renderReviewFiles()
    this.loadReviewDiff()
  }

  private renderReviewHeader(): void {
    const state = this.reviewState
    if (!state) return
    const { view } = state
    const fg = this.core.fg
    const chunks: TextChunk[] = [
      this.core.bold(fg(colors.text)(transcriptText(view.title).replace(/\s+/g, ' '))),
      fg(colors.muted)('\n'),
      fg(statusColor(view.status))(view.status),
      fg(colors.muted)(` · ${view.details} · `),
      fg(colors.link)(view.directory),
      fg(colors.muted)(' · '),
      fg(colors.keyword)(view.branch),
      fg(colors.muted)('\n'),
      fg(colors.secondary)(view.summary),
    ]
    if (view.pullRequest)
      chunks.push(
        fg(colors.muted)(' · '),
        fg(statusColor(view.pullRequest.state))(
          `PR #${view.pullRequest.number} ${view.pullRequest.state}`,
        ),
        fg(colors.muted)(' '),
        fg(colors.link)(view.pullRequest.url),
      )
    if (state.notice)
      chunks.push(
        fg(colors.muted)('\n'),
        fg(
          state.notice.tone === 'error'
            ? colors.failure
            : state.notice.tone === 'ok'
              ? colors.healthy
              : colors.info,
        )(transcriptText(state.notice.text)),
      )
    this.reviewHeader.content = new this.core.StyledText(chunks)
  }

  private renderReviewFiles(): void {
    const state = this.reviewState
    if (!state) return
    for (const child of this.reviewFiles.getChildren()) child.destroyRecursively()
    if (!state.view.files.length) {
      this.reviewFiles.add(
        new this.core.TextRenderable(this.renderer, {
          content: 'No file changes',
          fg: colors.muted,
          width: '100%',
          selectable: false,
        }),
      )
      return
    }
    // The files pane is 30% wide beside the diff, less its border and padding.
    const stacked = this.renderer.width < 72
    const width = Math.floor((this.renderer.width - 2) * (stacked ? 1 : 0.3)) - 3
    const markColor = (file: ReviewFile) =>
      ({ A: colors.healthy, D: colors.failure, R: colors.info })[statusMark(file.status)] ??
      colors.warning
    state.view.files.forEach((file, index) => {
      const selected = index === state.index
      const stats = file.binary ? 'binary' : `+${file.additions} −${file.deletions}`
      const name = fitPath(
        transcriptText(file.oldPath ? `${file.oldPath} → ${file.path}` : file.path),
        width - stats.length - 3,
      )
      this.reviewFiles.add(
        new this.core.TextRenderable(this.renderer, {
          id: `review-file-${index}`,
          content: new this.core.StyledText([
            this.core.fg(markColor(file))(`${statusMark(file.status)} `),
            this.core.fg(selected ? colors.text : colors.secondary)(name),
            this.core.fg(colors.muted)(` ${stats}`),
          ]),
          width: '100%',
          wrapMode: 'none',
          flexShrink: 0,
          selectable: false,
          bg: selected ? colors.input : colors.background,
          onMouseDown: (event) => {
            if (event.button === this.core.MouseButton.LEFT) this.selectReviewFile(index)
          },
        }),
      )
    })
    this.reviewFiles.scrollChildIntoView(`review-file-${state.index}`)
  }

  private loadReviewDiff(): void {
    const state = this.reviewState
    const file = state?.view.files[state.index]
    this.reviewDiff.scrollTo(0)
    if (!state || !file) {
      this.reviewDiffText.content = new this.core.StyledText([
        this.core.fg(colors.muted)(
          state?.view.blocked.commit && !state.view.files.length
            ? 'The agent left no changes in this directory.'
            : '',
        ),
      ])
      return
    }
    const key = `${state.whole ? 'whole' : 'hunks'}:${file.path}`
    const cached = state.diffs.get(key)
    if (cached !== undefined) {
      this.renderDiff(file, cached, state.whole)
      return
    }
    this.renderDiff(file, undefined, state.whole)
    state
      .loadDiff(file.path, state.whole)
      .then((raw) => {
        state.diffs.set(key, raw)
        if (this.reviewState === state && state.view.files[state.index] === file)
          this.renderDiff(file, raw, state.whole)
      })
      .catch((error: unknown) => {
        if (this.reviewState !== state || state.view.files[state.index] !== file) return
        this.reviewDiffText.content = new this.core.StyledText([
          this.core.fg(colors.failure)(
            `Could not load this diff: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ])
      })
  }

  private renderDiff(file: ReviewFile, raw: string | undefined, whole: boolean): void {
    const fg = this.core.fg
    const chunks: TextChunk[] = [
      this.core.bold(fg(colors.text)(transcriptText(file.path))),
      fg(colors.muted)(
        ` · ${file.status} · ${changeSummary({ files: 1, additions: file.additions, deletions: file.deletions }).replace(/^1 file /, '')}${whole ? ' · whole file' : ''}\n\n`,
      ),
    ]
    if (raw === undefined) chunks.push(fg(colors.muted)('Loading diff…'))
    else {
      const color = {
        hunk: colors.info,
        add: colors.healthy,
        delete: colors.failure,
        context: colors.secondary,
        note: colors.muted,
      }
      const sign = { hunk: '', add: '+', delete: '−', context: ' ', note: '' }
      for (const row of diffRows(raw)) {
        if (row.number) chunks.push(fg(colors.muted)(`${row.number} `))
        chunks.push(
          fg(color[row.kind])(`${sign[row.kind]}${sign[row.kind] ? ' ' : ''}${row.text}\n`),
        )
      }
    }
    this.reviewDiffText.content = new this.core.StyledText(chunks)
  }

  /** The composer remains editable while the dispatcher processes previous requests. */
  async homeRequest(history: readonly string[], initial = ''): Promise<string> {
    if (this.closed) throw new Quit()
    this.history = history
    if (!this.requesting || !(this.control instanceof this.core.InputRenderable)) {
      this.clearControl()
      this.requesting = true
      this.promptTitle.content = 'What should Open Run do?'
      this.promptKeys = `Enter send   Tab complete   ↑↓ history   ${navigationKeys}`
      this.setFooter(this.promptKeys)
      const input = new this.core.InputRenderable(this.renderer, {
        width: '100%',
        value: initial || this.session.draft,
        maxLength: 4000,
        backgroundColor: colors.background,
        focusedBackgroundColor: colors.background,
        textColor: colors.text,
        focusedTextColor: colors.text,
        cursorColor: colors.info,
        selectionBg: colors.button,
        selectionFg: colors.buttonText,
        placeholder: 'Ask for a task, or type a command…',
      })
      this.control = input
      const frame = this.frameControl()
      frame.add(input)
      this.ghost = new this.core.TextRenderable(this.renderer, {
        id: 'input-completion',
        content: '',
        fg: colors.muted,
        position: 'absolute',
        top: 0,
        left: 1,
        height: 1,
        selectable: false,
        visible: false,
      })
      frame.add(this.ghost)
      let historyIndex = history.length
      let historyLength = history.length
      let draft = ''
      let navigatingHistory = false
      input.on(this.core.InputRenderableEvents.INPUT, (value: string) => {
        if (!navigatingHistory) historyIndex = this.history.length
        this.session.draft = value
        this.renderCompletion()
        this.preview.update(value)
      })
      input.onKeyDown = (key) => {
        if (key.name !== 'up' && key.name !== 'down') return
        if (key.ctrl || key.meta || key.shift || key.option || key.super || key.hyper) return
        key.preventDefault()
        key.stopPropagation()
        if (historyLength !== this.history.length) {
          historyLength = this.history.length
          historyIndex = historyLength
        }
        const nextIndex = Math.max(
          0,
          Math.min(this.history.length, historyIndex + (key.name === 'up' ? -1 : 1)),
        )
        if (nextIndex === historyIndex) return
        if (historyIndex === this.history.length) draft = input.value
        historyIndex = nextIndex
        navigatingHistory = true
        input.value = this.history[historyIndex] ?? draft
        navigatingHistory = false
        input.clearSelection()
        input.gotoBufferEnd()
        this.renderCompletion()
      }
      input.on(this.core.InputRenderableEvents.ENTER, (raw: string) => {
        if (this.acceptCompletion()) return
        const value = raw.trim()
        if (!value) return
        this.session.enqueue(value)
        input.value = ''
        this.session.draft = ''
        historyIndex = this.history.length
        this.preview.cancel()
        this.suggestions.visible = false
        this.homeAction?.(value)
      })
      input.focus()
      input.gotoBufferEnd()
      this.renderCompletion()
    }
    const queued = this.session.take()
    if (queued !== undefined) return queued
    try {
      return await new Promise<string>((resolve, reject) => {
        this.rejectPrompt = reject
        this.homeAction = () => {
          this.homeAction = undefined
          const next = this.session.take()
          if (next !== undefined) resolve(next)
        }
      })
    } finally {
      this.homeAction = undefined
      this.rejectPrompt = undefined
      // Leave the input, timeline, and live overview in place during asynchronous work.
    }
  }

  close(message?: string, printOutput = true): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    if (this.requesting && this.control instanceof this.core.InputRenderable)
      this.session.draft = this.control.value
    this.stopLoading()
    clearInterval(this.cardTimer)
    this.preview.cancel()
    void this.clipboard.dispose().catch(() => {})
    this.rejectPrompt?.(new Quit())
    process.removeListener('SIGINT', this.exit)
    process.removeListener('SIGTERM', this.exit)
    process.removeListener('SIGHUP', this.exit)
    this.renderer.destroy()
    Object.assign(console, this.originalConsole)
    if (printOutput && (message || this.output.trim()))
      this.originalConsole.log(message || this.output.trim())
  }
}

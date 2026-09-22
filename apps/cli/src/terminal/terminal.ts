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
import { CliSession, transcriptText } from '../session/session.ts'
import { activityTable, cellWidth, fitLine, overviewTable } from './layout.ts'

const colors =
  process.env.NO_COLOR === undefined
    ? {
        background: 'transparent',
        input: '#171717',
        text: '#ededed',
        secondary: '#c2c2c2',
        muted: '#a1a1a1',
        border: '#333333',
        button: '#ededed',
        buttonText: '#0a0a0a',
        notice: '#ededed',
        healthy: '#50e3c2',
        warning: '#f5a623',
        failure: '#ff6369',
      }
    : {
        background: 'transparent',
        input: '#171717',
        text: '#ffffff',
        secondary: '#ffffff',
        muted: '#ffffff',
        border: '#ffffff',
        button: '#ffffff',
        buttonText: '#000000',
        notice: '#ffffff',
        healthy: '#ffffff',
        warning: '#ffffff',
        failure: '#ffffff',
      }

const navigationKeys = 'Ctrl+A select   Ctrl+C copy/clear   Ctrl+V paste   Esc back'
const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** One owner of terminal input/output for Home, menus, forms and results. */
export class TerminalSurface {
  private core: typeof import('@opentui/core')
  private renderer: CliRenderer
  private clipboard: ClipboardService
  private actions: BoxRenderable
  private promptTitle: TextRenderable
  private detailScroll: ScrollBoxRenderable
  private scheduledScroll: ScrollBoxRenderable
  private overview: TextRenderable
  private work: TextRenderable
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
        fg: colors.text,
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
    root.add(header)
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
    root.add(this.detailScroll)
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
      fg: colors.muted,
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
      height: 2,
      flexShrink: 0,
      marginTop: 1,
      selectable: false,
    })
    root.add(this.overview)
    this.scheduledScroll = new ScrollBoxRenderable(renderer, {
      id: 'pending-and-active',
      width: '100%',
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
    this.work = new TextRenderable(renderer, {
      content: '',
      fg: colors.muted,
      width: '100%',
      flexShrink: 0,
      selectable: false,
    })
    this.scheduledScroll.add(this.work)
    root.add(this.scheduledScroll)
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
    this.scheduledScroll.maxHeight = Math.max(1, Math.min(7, Math.floor(this.renderer.height / 5)))
    if (this.control instanceof this.core.SelectRenderable)
      this.control.height = this.menuHeight(this.control.options.length)
    this.renderOverview()
    this.renderCompletion()
    this.setFooter(this.promptKeys)
  }

  private setFooter(message: string): void {
    this.footer.content = fitLine(message, this.renderer.width - 2)
  }

  private renderSession(): void {
    for (const entry of this.session.entries.slice(this.renderedEntries)) {
      const who =
        entry.role === 'user' ? 'You' : entry.role === 'assistant' ? 'Open Run' : 'Activity'
      const at = new Date(entry.at).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      const bubble = new this.core.BoxRenderable(this.renderer, {
        id: entry.id,
        width: '100%',
        flexDirection: 'column',
        flexShrink: 0,
        marginBottom: 1,
        paddingLeft: entry.role === 'user' ? 2 : 0,
      })
      bubble.add(
        new this.core.TextRenderable(this.renderer, {
          content: `${at}  ${who}`,
          fg: entry.role === 'user' ? colors.text : colors.muted,
          width: '100%',
          flexShrink: 0,
          attributes: this.core.TextAttributes.BOLD,
        }),
      )
      bubble.add(
        new this.core.TextRenderable(this.renderer, {
          content: entry.text,
          fg: entry.role === 'user' ? colors.text : colors.secondary,
          width: '100%',
          flexShrink: 0,
        }),
      )
      this.detailScroll.add(bubble)
    }
    this.renderedEntries = this.session.entries.length
    this.renderOverview()
  }

  private renderOverview(): void {
    const width = Math.max(1, this.renderer.width - 2)
    this.overview.content = overviewTable(this.session.overview, width)
    this.notice.content = fitLine(this.session.overview.error || '', width)
    this.notice.visible = Boolean(this.session.overview.error)
    const pending = [
      ...(this.session.current ? [this.session.current] : []),
      ...this.session.pending,
    ].map((request) => ({
      id: request.id,
      prompt: transcriptText(request.text),
      when: request.detail,
    }))
    const rows = [
      ...pending,
      ...(this.session.overview.activeRuns || []),
      ...(this.session.overview.tasks || []),
    ]
    this.work.content = rows.length
      ? activityTable(rows, width - 1)
      : 'No pending schedules or active runs.'
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
      key.preventDefault()
      key.stopPropagation()
      this.reading = !this.reading
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
      borderColor: colors.border,
      focusedBorderColor: colors.border,
      backgroundColor: isInput ? colors.input : colors.background,
      paddingX: 1,
      paddingY: 0,
      marginTop: 0,
      onMouseDown: (event) => {
        if (event.button !== this.core.MouseButton.LEFT) return
        this.reading = false
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
      selectedTextColor: colors.secondary,
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
            this.session.log('user', option.name)
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
      cursorColor: colors.text,
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
            this.session.log(
              'user',
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

  /** The composer remains editable while the dispatcher processes previous requests. */
  async homeRequest(history: readonly string[], initial = ''): Promise<string> {
    if (this.closed) throw new Quit()
    this.history = history
    if (!this.requesting || !(this.control instanceof this.core.InputRenderable)) {
      this.clearControl()
      this.requesting = true
      this.promptTitle.content = 'What should Open Run do?'
      this.promptKeys = `Tab/Enter accept   Enter send   ↑↓ history   Shift+Tab timeline   ${navigationKeys}`
      this.setFooter(this.promptKeys)
      const input = new this.core.InputRenderable(this.renderer, {
        width: '100%',
        value: initial || this.session.draft,
        maxLength: 4000,
        backgroundColor: colors.background,
        focusedBackgroundColor: colors.background,
        textColor: colors.text,
        focusedTextColor: colors.text,
        cursorColor: colors.text,
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

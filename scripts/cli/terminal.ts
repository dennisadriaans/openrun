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
} from '@opentui/core'
import { format, stripVTControlCharacters } from 'node:util'
import {
  Back,
  CommandRequest,
  isCommandRequest,
  Quit,
  RequestInput,
  type Choice,
  type ScheduledTaskView,
} from './ui.ts'
import { RequestPreview } from './preview.ts'

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

const navigationKeys = 'Ctrl+K ask   Esc back   Ctrl+C twice quit'
const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const loadingLines = [
  'Consulting the rubber duck…',
  'Herding a few stray bits…',
  'Untangling the tiny cables…',
  'Teaching the pixels patience…',
  'Counting backwards from soon…',
  'Adding a little secret sauce…',
]

/** One owner of terminal input/output for Home, menus, forms and results. */
export class TerminalSurface {
  private core: typeof import('@opentui/core')
  private renderer: CliRenderer
  private actions: BoxRenderable
  private promptTitle: TextRenderable
  private detailTitle: TextRenderable
  private detail: TextRenderable
  private detailScroll: ScrollBoxRenderable
  private scheduledScroll: ScrollBoxRenderable
  private overview: BoxRenderable
  private homeActions: BoxRenderable
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
  private homeMessage = ''
  private homeAction?: (command: string) => void
  private requesting = false
  private pendingRequestInput?: RequestInput
  private loadingTimer?: ReturnType<typeof setInterval>
  private originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  }

  static async create(): Promise<TerminalSurface> {
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
      return new TerminalSurface(renderer, core)
    } catch (error) {
      renderer.destroy()
      throw error
    }
  }

  private constructor(renderer: CliRenderer, core: typeof import('@opentui/core')) {
    this.core = core
    const { BoxRenderable, TextRenderable, ScrollBoxRenderable } = core
    this.renderer = renderer
    renderer.root.flexDirection = 'column'
    renderer.root.justifyContent = 'flex-end'
    const root = new BoxRenderable(renderer, {
      width: '100%',
      maxHeight: '100%',
      padding: 1,
      flexDirection: 'column',
      gap: 1,
    })
    const header = new BoxRenderable(renderer, {
      width: '100%',
      flexDirection: 'row',
      height: 1,
      flexShrink: 0,
    })
    header.add(
      new TextRenderable(renderer, {
        content: 'Open Run',
        fg: colors.text,
        attributes: core.TextAttributes.BOLD,
        flexGrow: 1,
        selectable: false,
      }),
    )
    this.status = new TextRenderable(renderer, {
      content: 'runs / schedules / automations',
      fg: colors.muted,
      selectable: false,
    })
    header.add(this.status)
    root.add(header)
    this.notice = new TextRenderable(renderer, {
      content: '',
      fg: colors.notice,
      selectable: false,
      width: '100%',
      maxHeight: 4,
      flexShrink: 0,
      visible: false,
    })
    this.actions = new BoxRenderable(renderer, {
      width: '100%',
      flexShrink: 0,
      flexDirection: 'column',
    })
    this.promptTitle = new TextRenderable(renderer, {
      content: 'Loading…',
      fg: colors.text,
      attributes: core.TextAttributes.BOLD,
      selectable: false,
      width: '100%',
    })
    this.actions.add(this.promptTitle)
    this.suggestions = new TextRenderable(renderer, {
      content: '',
      fg: colors.muted,
      width: '100%',
      height: 2,
      flexShrink: 0,
      selectable: false,
    })
    this.actions.add(this.suggestions)
    this.preview = new RequestPreview((message) => {
      const width = Math.max(10, this.renderer.width - 4)
      this.suggestions.content = stripVTControlCharacters(message)
        .split('\n')
        .slice(0, 2)
        .map((line) => (line.length > width ? `${line.slice(0, width - 1)}…` : line))
        .join('\n')
    })
    this.detailScroll = new ScrollBoxRenderable(renderer, {
      width: '100%',
      flexShrink: 1,
      visible: false,
      scrollX: false,
      scrollY: true,
      // Override ScrollBox's viewport minimum so short content keeps its natural height.
      contentOptions: { flexDirection: 'column', minHeight: 0, paddingRight: 1 },
      verticalScrollbarOptions: {
        width: 1,
        trackOptions: { backgroundColor: colors.background, foregroundColor: colors.border },
      },
    })
    this.detailTitle = new TextRenderable(renderer, {
      content: '',
      fg: colors.text,
      attributes: core.TextAttributes.BOLD,
      selectable: false,
      width: '100%',
      flexShrink: 0,
      marginBottom: 1,
      visible: false,
    })
    this.detailScroll.add(this.detailTitle)
    this.detail = new TextRenderable(renderer, {
      content: '',
      fg: colors.secondary,
      selectable: false,
      width: '100%',
      flexShrink: 0,
    })
    this.detailScroll.add(this.detail)
    this.overview = new BoxRenderable(renderer, {
      width: '100%',
      flexDirection: 'column',
      flexShrink: 0,
      visible: false,
    })
    root.add(this.detailScroll)
    root.add(this.notice)
    this.homeActions = new BoxRenderable(renderer, {
      width: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 1,
      flexShrink: 0,
      visible: false,
    })
    for (const [label, command] of [
      ['Schedule task', 'schedule'],
      ['View runs', 'runs'],
      ['View integrations', 'integrations'],
    ] as const) {
      const button = new BoxRenderable(renderer, {
        flexShrink: 0,
        justifyContent: 'center',
        alignItems: 'center',
        paddingX: 1,
        border: true,
        borderStyle: 'rounded',
        borderColor: colors.button,
        focusedBorderColor: colors.button,
        backgroundColor: colors.button,
        onMouseDown: (event) => event.preventDefault(),
        onMouseUp: (event) => {
          if (event.button !== core.MouseButton.LEFT || event.isDragging) return
          event.stopPropagation()
          this.homeAction?.(command)
        },
      })
      button.add(
        new TextRenderable(renderer, {
          content: label,
          fg: colors.buttonText,
          width: '100%',
          height: 1,
          textAlign: 'center',
          selectable: false,
        }),
      )
      this.homeActions.add(button)
    }
    root.add(this.homeActions)
    this.scheduledScroll = new ScrollBoxRenderable(renderer, {
      width: '100%',
      flexShrink: 1,
      visible: false,
      scrollX: false,
      scrollY: true,
      contentOptions: { flexDirection: 'column', minHeight: 0, gap: 1, paddingRight: 1 },
      verticalScrollbarOptions: {
        width: 1,
        trackOptions: { backgroundColor: colors.background, foregroundColor: colors.border },
      },
    })
    root.add(this.scheduledScroll)
    this.footer = new TextRenderable(renderer, {
      content: this.promptKeys,
      fg: colors.muted,
      width: '100%',
      selectable: false,
    })
    this.actions.add(this.overview)
    this.actions.add(this.footer)
    root.add(this.actions)
    renderer.root.add(root)
    renderer.keyInput.on('keypress', this.onKey)
    renderer.keyInput.on('paste', this.onPaste)
    renderer.on('resize', this.resize)
    this.resize()
    for (const method of ['log', 'error', 'warn', 'info'] as const)
      console[method] = (...values: unknown[]) => this.write(format(...values))
    process.on('SIGINT', this.exit)
    process.on('SIGTERM', this.exit)
    process.on('SIGHUP', this.exit)
    this.startLoading()
  }

  private resize = (): void => {
    this.status.visible = this.renderer.width >= 65
    this.scheduledScroll.maxHeight = Math.max(4, Math.floor(this.renderer.height * 0.45))
    if (this.control instanceof this.core.SelectRenderable)
      this.control.height = this.menuHeight(this.control.options.length)
  }

  private menuHeight(count: number): number {
    return Math.min(8, count, Math.max(1, this.renderer.height - 12))
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
    if (!(this.control instanceof this.core.SelectRenderable) || !this.rejectPrompt) return
    event.preventDefault()
    event.stopPropagation()
    this.requestInput(
      stripVTControlCharacters(new TextDecoder().decode(event.bytes)).replace(/[\r\n]/g, ' '),
    )
  }

  private onKey = (key: KeyEvent): void => {
    if (key.ctrl && key.name === 'c') {
      key.preventDefault()
      key.stopPropagation()
      if (Date.now() - this.interruptedAt < 2000) {
        if (this.rejectPrompt) this.rejectPrompt(new Quit())
        else this.exit()
      } else {
        this.interruptedAt = Date.now()
        this.footer.content = 'Press Ctrl+C again within 2 seconds to quit. Running work continues.'
      }
      return
    }
    this.interruptedAt = 0
    this.footer.content = this.promptKeys
    if (
      this.pendingRequestInput &&
      ['return', 'kpenter', 'linefeed', 'escape', 'backspace'].includes(key.name)
    ) {
      key.preventDefault()
      key.stopPropagation()
      if (key.name === 'escape') this.pendingRequestInput.cancelled = true
      else if (key.name === 'backspace')
        this.pendingRequestInput.initial = [...this.pendingRequestInput.initial]
          .slice(0, -1)
          .join('')
      else this.pendingRequestInput.submitted = true
      return
    }
    if (key.ctrl && key.name === 'k') {
      key.preventDefault()
      key.stopPropagation()
      if (this.requesting) {
        this.reading = false
        this.control?.focus()
      } else this.requestInput()
    } else if (
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
      this.rejectPrompt?.(new Back())
    } else if (key.name === 'tab' && (this.detailScroll.visible || this.scheduledScroll.visible)) {
      key.preventDefault()
      key.stopPropagation()
      this.reading = !this.reading
      if (this.reading)
        (this.scheduledScroll.visible ? this.scheduledScroll : this.detailScroll).focus()
      else this.control?.focus()
      this.footer.content = this.reading
        ? '↑↓ scroll   Tab return to input   Esc back'
        : this.promptKeys
    }
  }

  setStatus(message: string): void {
    this.status.content = message
  }

  info(message: string): void {
    this.notice.content = message
    this.notice.visible = Boolean(message)
  }

  note(message: string, title: string): void {
    this.detailScroll.visible = title !== 'Home'
    this.overview.visible = title === 'Home'
    this.homeActions.visible = title === 'Home'
    this.scheduledScroll.visible = title === 'Home' && this.scheduledScroll.getChildren().length > 0
    this.detailTitle.visible = title !== 'Home'
    this.detail.visible = title !== 'Home'
    if (title === 'Home') {
      this.homeMessage = message
      this.renderHome()
      return
    }
    if (title === 'Let’s get you unstuck') this.info(message)
    this.detailTitle.content = title
    this.detail.content = message
  }

  scheduledTasks(tasks: ScheduledTaskView[]): void {
    const scrollTop = this.scheduledScroll.scrollTop
    for (const child of [...this.scheduledScroll.getChildren()]) child.destroyRecursively()
    for (const task of tasks) {
      const bubble = new this.core.BoxRenderable(this.renderer, {
        id: `scheduled-task-${task.id}`,
        width: '100%',
        maxWidth: 100,
        alignSelf: 'flex-end',
        flexShrink: 0,
        flexDirection: 'column',
        paddingX: 1,
        border: true,
        borderStyle: 'rounded',
        borderColor: colors.border,
        backgroundColor: colors.input,
      })
      bubble.add(
        new this.core.TextRenderable(this.renderer, {
          content: stripVTControlCharacters(task.prompt),
          fg: colors.text,
          width: '100%',
          flexShrink: 0,
        }),
      )
      const timing = new this.core.BoxRenderable(this.renderer, {
        width: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 1,
        flexShrink: 0,
      })
      timing.add(
        new this.core.TextRenderable(this.renderer, {
          content: '◷ Pending',
          fg: colors.warning,
          selectable: false,
          flexShrink: 0,
        }),
      )
      timing.add(
        new this.core.TextRenderable(this.renderer, {
          content: `· ${stripVTControlCharacters(task.when)}`,
          fg: colors.muted,
          selectable: false,
        }),
      )
      bubble.add(timing)
      this.scheduledScroll.add(bubble)
    }
    this.scheduledScroll.scrollTo(scrollTop)
    this.scheduledScroll.visible = this.overview.visible && tasks.length > 0
    if (this.requesting) {
      this.promptKeys = `↑↓ history   ${tasks.length ? 'Tab scroll tasks   ' : ''}Enter send   ${navigationKeys}`
      if (!tasks.length && this.reading) {
        this.reading = false
        this.control?.focus()
      }
      if (!this.reading) this.footer.content = this.promptKeys
    }
  }

  private renderHome(): void {
    for (const child of [...this.overview.getChildren()]) child.destroyRecursively()
    this.overview.add(
      new this.core.TextRenderable(this.renderer, {
        content: this.homeMessage,
        fg: colors.muted,
        selectable: false,
        width: '100%',
      }),
    )
  }

  beginAction(): void {
    this.info('')
    this.homeActions.visible = false
    this.scheduledScroll.visible = false
    this.output = ''
    this.unreadOutput = false
    this.detailTitle.visible = false
    this.detail.content = ''
    this.detail.visible = true
    this.detailScroll.visible = false
    this.overview.visible = false
    this.detailScroll.scrollTo(0)
    this.startLoading()
  }

  write(message: string): void {
    this.unreadOutput = true
    this.output = `${this.output}${stripVTControlCharacters(message)}\n`.slice(-100_000)
    this.detailTitle.visible = false
    this.detail.content = this.output
    this.detail.visible = true
    this.detailScroll.visible = true
    this.overview.visible = false
    this.scheduledScroll.visible = false
  }

  get hasUnreadOutput(): boolean {
    return this.unreadOutput
  }

  /** Fill the gap between submitting a value and the next interactive step. */
  private startLoading(): void {
    if (this.closed || this.loadingTimer) return
    this.promptKeys = 'Ctrl+C twice quit'
    this.footer.content = this.promptKeys
    this.homeActions.visible = false
    const started = Date.now()
    const render = () => {
      const elapsed = Date.now() - started
      const frame = loadingFrames[Math.floor(elapsed / 80) % loadingFrames.length]
      const line = loadingLines[Math.floor(elapsed / 3000) % loadingLines.length]
      this.promptTitle.content = `${frame} ${line}`
    }
    render()
    this.loadingTimer = setInterval(render, 80)
    this.loadingTimer.unref()
  }

  private stopLoading(): void {
    clearInterval(this.loadingTimer)
    this.loadingTimer = undefined
  }

  private clearControl(): void {
    this.stopLoading()
    this.preview.cancel()
    this.controlFrame?.destroyRecursively()
    this.controlFrame = undefined
    this.control = undefined
    this.suggestions.content = ''
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
      paddingY: isInput ? 0.5 : 0,
      marginTop: isInput ? 0.5 : 0,
      onMouseDown: (event) => {
        if (event.button !== this.core.MouseButton.LEFT) return
        this.reading = false
        this.control?.focus()
        this.footer.content = this.promptKeys
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
    this.promptTitle.content = message
    this.promptKeys = `↑↓ move   Enter select   Type to ask   ${navigationKeys}`
    this.footer.content = this.promptKeys
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
      this.suggestions.content = description
    }
    menu.on(this.core.SelectRenderableEvents.SELECTION_CHANGED, hint)
    hint()
    try {
      return await new Promise<string>((resolve, reject) => {
        this.rejectPrompt = reject
        menu.on(
          this.core.SelectRenderableEvents.ITEM_SELECTED,
          (_index: number, option: SelectOption) => resolve(String(option.value)),
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
    this.promptTitle.content = message
    this.promptKeys = `Enter continue   Ctrl+Enter use as value   ${navigationKeys}`
    this.footer.content = this.promptKeys
    const input = new this.core.InputRenderable(this.renderer, {
      width: '100%',
      value: initial,
      maxLength: 100_000,
      backgroundColor: colors.background,
      focusedBackgroundColor: colors.background,
      textColor: colors.text,
      focusedTextColor: colors.text,
      cursorColor: colors.text,
      selectionBg: colors.input,
      selectionFg: colors.text,
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
          else resolve(value)
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

  /** Content grows upward from the command line at the bottom. */
  async homeRequest(history: readonly string[], initial = ''): Promise<string> {
    if (this.closed) throw new Quit()
    this.clearControl()
    this.requesting = true
    this.scheduledScroll.visible =
      this.overview.visible && this.scheduledScroll.getChildren().length > 0
    this.promptTitle.content = 'What should Open Run do?'
    this.promptKeys = `↑↓ history   ${this.scheduledScroll.visible ? 'Tab scroll tasks   ' : ''}Enter send   ${navigationKeys}`
    this.footer.content = this.promptKeys
    const input = new this.core.InputRenderable(this.renderer, {
      width: '100%',
      value: initial,
      maxLength: 4000,
      backgroundColor: colors.background,
      focusedBackgroundColor: colors.background,
      textColor: colors.text,
      focusedTextColor: colors.text,
      cursorColor: colors.text,
      selectionBg: colors.input,
      selectionFg: colors.text,
      placeholder: 'Ask for a task, or type a command…',
    })
    this.control = input
    this.frameControl().add(input)
    const showSuggestion = (value: string) => {
      this.preview.update(value)
    }
    input.on(this.core.InputRenderableEvents.INPUT, showSuggestion)
    let historyIndex = history.length
    let draft = ''
    input.onKeyDown = (key) => {
      if (key.name !== 'up' && key.name !== 'down') return
      if (key.ctrl || key.meta || key.shift || key.option || key.super || key.hyper) return
      key.preventDefault()
      key.stopPropagation()
      const nextIndex = Math.max(
        0,
        Math.min(history.length, historyIndex + (key.name === 'up' ? -1 : 1)),
      )
      if (nextIndex === historyIndex) return
      if (historyIndex === history.length) draft = input.value
      historyIndex = nextIndex
      input.value = history[historyIndex] ?? draft
      input.clearSelection()
      input.gotoBufferEnd()
    }
    showSuggestion(initial)
    input.focus()
    try {
      return await new Promise<string>((resolve, reject) => {
        this.rejectPrompt = reject
        this.homeAction = resolve
        input.on(this.core.InputRenderableEvents.ENTER, (raw: string) => {
          if (raw.trim()) resolve(raw.trim())
          else this.info('Type a request, or press Esc to leave Open Run.')
        })
      })
    } finally {
      this.homeAction = undefined
      this.homeActions.visible = false
      this.scheduledScroll.visible = false
      this.clearControl()
      this.startLoading()
    }
  }

  close(message?: string, printOutput = true): void {
    if (this.closed) return
    this.closed = true
    this.stopLoading()
    this.preview.cancel()
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

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PREVIEW_PROMPT,
  alignArgs,
  buildCommandPreview,
  commandPreviewWarnings,
  formatCommandLine,
  promptChannels,
  promptDeliveryLabel,
  type PromptChannel,
} from './commandPreview.ts'

const CLAUDE_TEMPLATE = ['-p', '--output-format', 'stream-json', '--verbose']

describe('alignArgs', () => {
  it('marks untouched template tokens as template-owned', () => {
    const { args, droppedTemplateArgs } = alignArgs(CLAUDE_TEMPLATE, CLAUDE_TEMPLATE)
    assert.deepEqual(
      args.map((a) => a.origin),
      ['template', 'template', 'template', 'template'],
    )
    assert.deepEqual(droppedTemplateArgs, [])
  })

  it('tags flags Open Run splices in, wherever they land', () => {
    const final = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--session-id',
      '<session-id>',
      '--model',
      'sonnet',
    ]
    const { args, droppedTemplateArgs } = alignArgs(CLAUDE_TEMPLATE, final)
    assert.deepEqual(
      args.filter((a) => a.origin === 'agentops').map((a) => a.value),
      ['--session-id', '<session-id>', '--model', 'sonnet'],
    )
    assert.deepEqual(droppedTemplateArgs, [])
  })

  it('keeps mid-template injections aligned instead of shifting every token', () => {
    const template = ['exec', '--skip-git-repo-check', '-']
    const final = ['exec', '--json', '--skip-git-repo-check', '-']
    const { args } = alignArgs(template, final)
    assert.deepEqual(
      args.map((a) => a.origin),
      ['template', 'agentops', 'template', 'template'],
    )
  })

  it('reports template tokens the adapter dropped', () => {
    const template = ['-p', '--dangerously-skip-permissions', '--verbose']
    const final = ['-p', '--verbose', '--permission-mode', 'acceptEdits']
    const { args, droppedTemplateArgs } = alignArgs(template, final)
    assert.deepEqual(droppedTemplateArgs, ['--dangerously-skip-permissions'])
    assert.deepEqual(
      args.map((a) => a.origin),
      ['template', 'template', 'agentops', 'agentops'],
    )
  })

  it('treats an empty template as fully injected', () => {
    const { args, droppedTemplateArgs } = alignArgs([], ['--json'])
    assert.deepEqual(args, [{ value: '--json', origin: 'agentops' }])
    assert.deepEqual(droppedTemplateArgs, [])
  })
})

describe('formatCommandLine', () => {
  it('quotes only tokens containing whitespace', () => {
    assert.equal(
      formatCommandLine('claude', ['-p', '--append-system-prompt', 'be brief']),
      'claude -p --append-system-prompt "be brief"',
    )
  })

  it('renders a bare binary when there are no args', () => {
    assert.equal(formatCommandLine('claude', []), 'claude')
  })
})

describe('promptChannels', () => {
  it('detects stdin', () => {
    assert.deepEqual(
      promptChannels({ args: ['-p'], stdinText: 'hi', promptFileContents: null }),
      ['stdin'],
    )
  })

  it('detects a prompt file from the unresolved token', () => {
    assert.deepEqual(
      promptChannels({
        args: ['--prompt-file', '{promptFile}'],
        stdinText: null,
        promptFileContents: null,
      }),
      ['promptFile'],
    )
  })

  it('detects a prompt embedded inside a larger argv token', () => {
    assert.deepEqual(
      promptChannels({
        args: [`--message=${PREVIEW_PROMPT}`],
        stdinText: null,
        promptFileContents: null,
      }),
      ['argv'],
    )
  })

  it('returns nothing when the prompt has no way to reach the CLI', () => {
    assert.deepEqual(
      promptChannels({ args: ['--yes'], stdinText: null, promptFileContents: null }),
      [],
    )
  })
})

describe('promptDeliveryLabel', () => {
  it('names the channel', () => {
    assert.equal(promptDeliveryLabel(['stdin']), 'Prompt is sent on stdin')
  })

  it('calls out a prompt that never leaves Open Run', () => {
    assert.equal(promptDeliveryLabel([]), 'Prompt is never sent to the CLI')
  })
})

describe('commandPreviewWarnings', () => {
  const clean: {
    bin: string
    channels: PromptChannel[]
    droppedTemplateArgs: string[]
    installed: boolean
  } = {
    bin: 'claude',
    channels: ['stdin'],
    droppedTemplateArgs: [],
    installed: true,
  }

  it('stays quiet on a healthy command', () => {
    assert.deepEqual(commandPreviewWarnings({ ...clean, channels: ['stdin'] }), [])
  })

  it('flags a command that never receives the prompt', () => {
    const codes = commandPreviewWarnings({ ...clean, channels: [] }).map((w) => w.code)
    assert.deepEqual(codes, ['prompt-not-delivered'])
  })

  it('flags a prompt delivered on two channels', () => {
    const codes = commandPreviewWarnings({
      ...clean,
      channels: ['stdin', 'promptFile'],
    }).map((w) => w.code)
    assert.deepEqual(codes, ['prompt-duplicated'])
  })

  it('flags argv prompts for the argv length limit', () => {
    const codes = commandPreviewWarnings({ ...clean, channels: ['argv'] }).map((w) => w.code)
    assert.deepEqual(codes, ['prompt-in-argv'])
  })

  it('names the template flags the adapter took over', () => {
    const warnings = commandPreviewWarnings({
      ...clean,
      droppedTemplateArgs: ['--dangerously-skip-permissions'],
    })
    assert.equal(warnings[0]?.code, 'template-args-dropped')
    assert.match(warnings[0]!.message, /--dangerously-skip-permissions/)
  })

  it('reports a binary that is not on PATH first', () => {
    const warnings = commandPreviewWarnings({ ...clean, installed: false })
    assert.equal(warnings[0]?.code, 'binary-missing')
    assert.match(warnings[0]!.message, /not found on PATH/)
  })
})

describe('buildCommandPreview', () => {
  it('assembles a claude-style preview', () => {
    const preview = buildCommandPreview({
      bin: 'claude',
      templateArgs: CLAUDE_TEMPLATE,
      finalArgs: [...CLAUDE_TEMPLATE, '--session-id', '<session-id>'],
      stdinText: PREVIEW_PROMPT,
      promptFileContents: null,
      canResume: true,
      installed: true,
      binaryPath: '/usr/local/bin/claude',
    })

    assert.equal(
      preview.commandLine,
      'claude -p --output-format stream-json --verbose --session-id <session-id>',
    )
    assert.deepEqual(preview.channels, ['stdin'])
    assert.deepEqual(preview.warnings, [])
    assert.equal(preview.binaryPath, '/usr/local/bin/claude')
    assert.deepEqual(
      preview.args.filter((a) => a.origin === 'agentops').map((a) => a.value),
      ['--session-id', '<session-id>'],
    )
  })

  it('catches the silent misconfiguration: no stdin and no prompt token', () => {
    const preview = buildCommandPreview({
      bin: 'gemini',
      templateArgs: ['-y'],
      finalArgs: ['-y'],
      stdinText: null,
      promptFileContents: null,
      canResume: false,
      installed: true,
    })

    assert.deepEqual(preview.channels, [])
    assert.deepEqual(
      preview.warnings.map((w) => w.code),
      ['prompt-not-delivered'],
    )
  })

  it('trims the binary so the copyable line has no stray whitespace', () => {
    const preview = buildCommandPreview({
      bin: '  codex ',
      templateArgs: ['exec'],
      finalArgs: ['exec', '--json'],
      stdinText: PREVIEW_PROMPT,
      promptFileContents: null,
      canResume: true,
      installed: true,
    })
    assert.equal(preview.bin, 'codex')
    assert.equal(preview.commandLine, 'codex exec --json')
  })
})

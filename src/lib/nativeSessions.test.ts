import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  agyCliRoot,
  agyWorkspaceUrisMatch,
  claudeProjectDir,
  codexSessionIdFromFilename,
  encodeClaudeProjectDir,
  encodeGrokProjectDir,
  filterSessionsForCwd,
  grokProjectDir,
  mergeNativeSessions,
  missingNativeSessionMessage,
  nativeResumeKindFor,
  nativeResumeNotSupportedMessage,
  paginateNativeSessions,
  parseAgyHistoryJsonl,
  parseAgySummaryRow,
  parseClaudeJsonlPrefix,
  parseClaudeSessionsIndex,
  parseCodexJsonlPrefix,
  parseCodexThreadRow,
  parseGrokSummary,
  resumedClaudeChatStub,
  resumedNativeChatStub,
  sqliteTimestampMs,
  truncateSessionTitle,
} from './nativeSessions.ts'

describe('encodeClaudeProjectDir', () => {
  it('encodes an absolute unix cwd the way Claude Code does', () => {
    assert.equal(
      encodeClaudeProjectDir('/Users/dennisadriaansen/Dev/agent-automation'),
      '-Users-dennisadriaansen-Dev-agent-automation',
    )
  })

  it('strips a trailing slash and empty input', () => {
    assert.equal(encodeClaudeProjectDir('/tmp/repo/'), '-tmp-repo')
    assert.equal(encodeClaudeProjectDir('   '), '')
  })
})

describe('claudeProjectDir', () => {
  it('nests under ~/.claude/projects', () => {
    assert.equal(
      claudeProjectDir('/Users/ada', '/Users/ada/src/app'),
      '/Users/ada/.claude/projects/-Users-ada-src-app',
    )
  })
})

describe('grok paths', () => {
  it('URL-encodes the cwd under ~/.grok/sessions', () => {
    assert.equal(encodeGrokProjectDir('/Users/ada/src/app'), '%2FUsers%2Fada%2Fsrc%2Fapp')
    assert.equal(
      grokProjectDir('/Users/ada/.grok', '/Users/ada/src/app/'),
      '/Users/ada/.grok/sessions/%2FUsers%2Fada%2Fsrc%2Fapp',
    )
  })
})

describe('agyCliRoot', () => {
  it('nests under ~/.gemini/antigravity-cli', () => {
    assert.equal(agyCliRoot('/Users/ada'), '/Users/ada/.gemini/antigravity-cli')
  })
})

describe('parseClaudeSessionsIndex', () => {
  it('reads entries and skips sidechains', () => {
    const rows = parseClaudeSessionsIndex({
      version: 1,
      entries: [
        {
          sessionId: 'aaa-111',
          firstPrompt: 'Fix the login bug',
          summary: 'Auth token expiry',
          messageCount: 12,
          created: '2026-08-14T10:00:00.000Z',
          modified: '2026-08-14T12:00:00.000Z',
          isSidechain: false,
        },
        {
          sessionId: 'side-1',
          summary: 'subagent',
          isSidechain: true,
          modified: '2026-08-14T13:00:00.000Z',
        },
        { firstPrompt: 'no id' },
      ],
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.sessionId, 'aaa-111')
    assert.equal(rows[0]?.title, 'Auth token expiry')
    assert.equal(rows[0]?.messageCount, 12)
    assert.equal(rows[0]?.modifiedAt, Date.parse('2026-08-14T12:00:00.000Z'))
  })

  it('falls back to firstPrompt then a short id', () => {
    const rows = parseClaudeSessionsIndex({
      entries: [{ sessionId: '01234567-abcd', firstPrompt: '  hello world  ', fileMtime: 99 }],
    })
    assert.equal(rows[0]?.title, 'hello world')
    assert.equal(rows[0]?.modifiedAt, 99)

    const idOnly = parseClaudeSessionsIndex({
      entries: [{ sessionId: '01234567-abcd' }],
    })
    assert.equal(idOnly[0]?.title, '01234567')
  })

  it('returns empty for junk', () => {
    assert.deepEqual(parseClaudeSessionsIndex(null), [])
    assert.deepEqual(parseClaudeSessionsIndex({ entries: 'nope' }), [])
  })
})

describe('parseClaudeJsonlPrefix', () => {
  it('picks sessionId, ai-title, first real user prompt, and file mtime', () => {
    const prefix = [
      '{"type":"last-prompt","sessionId":"sess-1"}',
      '{"type":"user","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>skip</local-command-caveat>"},"sessionId":"sess-1"}',
      '{"type":"user","message":{"role":"user","content":"<command-name>/effort</command-name>"},"sessionId":"sess-1"}',
      '{"type":"user","timestamp":"2026-08-14T22:27:20.036Z","message":{"role":"user","content":"remove all slack integration"},"sessionId":"sess-1"}',
      '{"type":"ai-title","aiTitle":"Remove all Slack integration code","sessionId":"sess-1"}',
      '{"incomplete',
    ].join('\n')

    const row = parseClaudeJsonlPrefix(prefix, { fileMtime: 1_700_000_000_000 })
    assert.ok(row)
    assert.equal(row?.sessionId, 'sess-1')
    assert.equal(row?.title, 'Remove all Slack integration code')
    assert.equal(row?.modifiedAt, 1_700_000_000_000)
    assert.equal(row?.createdAt, Date.parse('2026-08-14T22:27:20.036Z'))
  })

  it('uses the filename id when lines omit sessionId', () => {
    const row = parseClaudeJsonlPrefix(
      '{"type":"user","message":{"role":"user","content":"hi"}}\n',
      {
        sessionIdFromFilename: 'file-id',
        fileMtime: 1,
      },
    )
    assert.equal(row?.sessionId, 'file-id')
    assert.equal(row?.title, 'hi')
  })

  it('skips a sidechain-only prefix', () => {
    const prefix =
      '{"type":"user","parentUuid":null,"isSidechain":true,"message":{"role":"user","content":"subagent"}}\n'
    assert.equal(parseClaudeJsonlPrefix(prefix, { fileMtime: 1 }), null)
  })

  it('returns null when nothing identifies a session', () => {
    assert.equal(parseClaudeJsonlPrefix('not json\n{"type":"mode"}\n', { fileMtime: 1 }), null)
  })
})

describe('parseCodexThreadRow', () => {
  it('reads title, cwd, and ms timestamps', () => {
    const row = parseCodexThreadRow({
      id: '019f266e-e3ab-7080-b3a9-177f08e5e0c4',
      cwd: '/Users/ada/src/app',
      title: 'Speed up CLI init',
      first_user_message: 'analyse packages/cli',
      updated_at: 1_783_059_255,
      updated_at_ms: 1_783_059_255_613,
      archived: 0,
    })
    assert.ok(row)
    assert.equal(row?.kind, 'codex')
    assert.equal(row?.title, 'Speed up CLI init')
    assert.equal(row?.cwd, '/Users/ada/src/app')
    assert.equal(row?.modifiedAt, 1_783_059_255_613)
  })

  it('skips archived threads and rows without an id', () => {
    assert.equal(parseCodexThreadRow({ id: 'x', archived: 1, title: 'gone' }), null)
    assert.equal(parseCodexThreadRow({ title: 'no id' }), null)
  })
})

describe('parseCodexJsonlPrefix', () => {
  it('picks session_meta cwd and the first real user_message', () => {
    const prefix = [
      '{"timestamp":"2026-07-03T05:23:49.357Z","type":"session_meta","payload":{"session_id":"abc-1","cwd":"/Users/ada/app"}}',
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>skip</environment_context>"}]}}',
      '{"type":"event_msg","payload":{"type":"user_message","message":"analyse packages/cli"}}',
    ].join('\n')
    const row = parseCodexJsonlPrefix(prefix, { fileMtime: 99 })
    assert.equal(row?.sessionId, 'abc-1')
    assert.equal(row?.cwd, '/Users/ada/app')
    assert.equal(row?.title, 'analyse packages/cli')
    assert.equal(row?.kind, 'codex')
  })

  it('falls back to the filename uuid', () => {
    const row = parseCodexJsonlPrefix('{"type":"session_meta","payload":{"cwd":"/tmp"}}\n', {
      sessionIdFromFilename: '019f266e-e3ab-7080-b3a9-177f08e5e0c4',
      fileMtime: 1,
    })
    assert.equal(row?.sessionId, '019f266e-e3ab-7080-b3a9-177f08e5e0c4')
  })
})

describe('codexSessionIdFromFilename', () => {
  it('pulls the uuid off a rollout filename', () => {
    assert.equal(
      codexSessionIdFromFilename(
        'rollout-2026-07-03T07-23-49-019f266e-e3ab-7080-b3a9-177f08e5e0c4.jsonl',
      ),
      '019f266e-e3ab-7080-b3a9-177f08e5e0c4',
    )
  })
})

describe('parseGrokSummary', () => {
  it('reads generated_title, id, cwd, and last_active_at', () => {
    const row = parseGrokSummary({
      info: { id: '2db0-b75f', cwd: '/Users/ada/app' },
      generated_title: 'Open PR Gap Check Automations',
      session_summary: 'older',
      last_active_at: '2026-08-04T21:02:10.383995Z',
      created_at: '2026-08-04T21:01:51.369368Z',
      num_chat_messages: 7,
    })
    assert.ok(row)
    assert.equal(row?.kind, 'grok')
    assert.equal(row?.sessionId, '2db0-b75f')
    assert.equal(row?.title, 'Open PR Gap Check Automations')
    assert.equal(row?.cwd, '/Users/ada/app')
    assert.equal(row?.messageCount, 7)
    assert.equal(row?.modifiedAt, Date.parse('2026-08-04T21:02:10.383995Z'))
  })

  it('returns null without an id', () => {
    assert.equal(parseGrokSummary({ generated_title: 'x' }), null)
  })
})

describe('agy parsers', () => {
  it('matches file:// workspace uris', () => {
    assert.equal(agyWorkspaceUrisMatch('["file:///Users/ada/app"]', '/Users/ada/app/'), true)
    assert.equal(agyWorkspaceUrisMatch('["file:///tmp/other"]', '/Users/ada/app'), false)
  })

  it('skips nested summary rows and uses preview as the title', () => {
    const nested = parseAgySummaryRow({
      conversation_id: 'child',
      preview: 'subagent',
      nesting_depth: 1,
    })
    assert.equal(nested, null)

    const row = parseAgySummaryRow({
      conversation_id: 'cdc49fcf-290b-4741-af3e-f60a5967fc9a',
      title: '',
      preview: 'Adding Dashboard Templates',
      step_count: 12,
      last_modified_time: '2026-04-19 20:53:11.170309+00:00',
      workspace_uris: '["file:///Users/ada/app"]',
      nesting_depth: 0,
    })
    assert.equal(row?.kind, 'antigravity')
    assert.equal(row?.title, 'Adding Dashboard Templates')
    assert.equal(row?.messageCount, 12)
  })

  it('groups history.jsonl by conversationId and skips slash commands as titles', () => {
    const rows = parseAgyHistoryJsonl(
      [
        '{"display":"/model","timestamp":1,"workspace":"/Users/ada/app","type":"slash_command","conversationId":"aaa"}',
        '{"display":"fix the login","timestamp":2,"workspace":"/Users/ada/app","conversationId":"aaa"}',
        '{"display":"and tests","timestamp":5,"workspace":"/Users/ada/app","conversationId":"aaa"}',
        '{"display":"other repo","timestamp":9,"workspace":"/tmp/other","conversationId":"bbb"}',
        '{"display":"no id","timestamp":3,"workspace":"/Users/ada/app"}',
      ].join('\n'),
    )
    assert.equal(rows.length, 2)
    const aaa = rows.find((r) => r.sessionId === 'aaa')
    assert.equal(aaa?.title, 'fix the login')
    assert.equal(aaa?.modifiedAt, 5)
    assert.equal(aaa?.cwd, '/Users/ada/app')
    assert.equal(aaa?.kind, 'antigravity')
  })
})

describe('filterSessionsForCwd', () => {
  it('keeps matching cwd and agy file:// uris', () => {
    const rows = filterSessionsForCwd(
      [
        { sessionId: 'a', title: 'a', modifiedAt: 1, kind: 'codex', cwd: '/Users/ada/app/' },
        { sessionId: 'b', title: 'b', modifiedAt: 1, kind: 'codex', cwd: '/tmp/other' },
        {
          sessionId: 'c',
          title: 'c',
          modifiedAt: 1,
          kind: 'antigravity',
          cwd: '["file:///Users/ada/app"]',
        },
      ],
      '/Users/ada/app',
    )
    assert.deepEqual(
      rows.map((r) => r.sessionId),
      ['a', 'c'],
    )
  })
})

describe('paginateNativeSessions', () => {
  it('slices and reports hasMore', () => {
    const items = [1, 2, 3, 4, 5, 6]
    const first = paginateNativeSessions(items, 0, 5)
    assert.deepEqual(first.items, [1, 2, 3, 4, 5])
    assert.equal(first.hasMore, true)
    const next = paginateNativeSessions(items, 5, 5)
    assert.deepEqual(next.items, [6])
    assert.equal(next.hasMore, false)
  })
})

describe('nativeResumeKindFor', () => {
  it('accepts CLI claude/codex/grok/agy and rejects ACP or gemini', () => {
    assert.equal(nativeResumeKindFor({ bin: 'claude' }), 'claude')
    assert.equal(nativeResumeKindFor({ bin: 'codex' }), 'codex')
    assert.equal(nativeResumeKindFor({ bin: 'grok' }), 'grok')
    assert.equal(nativeResumeKindFor({ bin: 'agy' }), 'antigravity')
    assert.equal(nativeResumeKindFor({ bin: 'claude', transport: 'acp' }), null)
    assert.equal(nativeResumeKindFor({ bin: 'gemini' }), null)
  })
})

describe('mergeNativeSessions', () => {
  it('lets the index win on id and sorts by modifiedAt desc', () => {
    const merged = mergeNativeSessions(
      [{ sessionId: 'a', title: 'from-index', modifiedAt: 10, kind: 'claude' }],
      [
        { sessionId: 'a', title: 'from-jsonl', modifiedAt: 99, kind: 'claude' },
        { sessionId: 'b', title: 'only-jsonl', modifiedAt: 50, kind: 'claude' },
      ],
    )
    assert.equal(merged.length, 2)
    assert.equal(merged[0]?.sessionId, 'b')
    assert.equal(merged[1]?.title, 'from-index')
  })
})

describe('copy', () => {
  it('builds the stub and missing-session message', () => {
    assert.equal(
      resumedClaudeChatStub('Auth token expiry'),
      'Resumed Claude chat · Auth token expiry',
    )
    assert.equal(resumedClaudeChatStub('  '), 'Resumed Claude chat')
    assert.equal(
      resumedNativeChatStub('codex', 'Speed up init'),
      'Resumed Codex chat · Speed up init',
    )
    assert.match(missingNativeSessionMessage(), /same folder/)
    assert.match(nativeResumeNotSupportedMessage(), /Claude, Codex, Grok, or Antigravity/)
  })

  it('truncates long titles on a word boundary-ish slice', () => {
    const long = 'x'.repeat(120)
    const title = truncateSessionTitle(long)
    assert.ok(title.endsWith('…'))
    assert.equal(title.length, 100)
  })
})

describe('sqliteTimestampMs', () => {
  it('prefers millisecond columns and promotes seconds', () => {
    assert.equal(sqliteTimestampMs(100, 1_700_000_000_000), 1_700_000_000_000)
    assert.equal(sqliteTimestampMs(1_783_059_255, undefined), 1_783_059_255_000)
  })
})

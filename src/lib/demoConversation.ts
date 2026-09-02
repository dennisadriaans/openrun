/**
 * One finished demo chat: Linear MCP, a web fetch, three Vue edits.
 * Served only when `pnpm dev -- --demo` is on; nothing is written to the DB.
 */
import type { ChatMessage } from '../server/core'
import type { DiffFile } from '../server/git'
import type { TurnEventKind, TurnEventPayload, TurnEventRow } from './turnEvents.ts'
import { DEMO_DETAIL_RUN_ID } from './demoData.ts'

export { DEMO_DETAIL_RUN_ID, isDemoDetailRun } from './demoData.ts'

const USER_ID = 'demo-msg-user'
const ASSISTANT_ID = 'demo-msg-assistant'
const WS_ID = 'demo-ws'
const PROJECT_ID = 'demo-project'

export const DEMO_VUE_PATHS = [
  'src/components/WaitlistHero.vue',
  'src/components/PricingCard.vue',
  'src/components/ThemeToggle.vue',
] as const

const HERO_OLD = `  <section class="hero">
    <h1>Join the waitlist</h1>`
const HERO_NEW = `  <section class="hero hero--beta">
    <p class="eyebrow">Public beta</p>
    <h1>Ship on your laptop.</h1>`

const PRICE_OLD = `      <article class="card" style="margin-bottom: 24px">
        <h3>{{ plan.name }}</h3>
        <p class="price">\${{ plan.price }}</p>`
const PRICE_NEW = `      <article class="card" style="margin-bottom: 12px">
        <h3>{{ plan.name }}</h3>
        <p class="price">{{ plan.priceLabel }}</p>`

const THEME_OLD = `  <button @click="toggle">Theme</button>`
const THEME_NEW = `  <button class="theme-toggle" :aria-pressed="dark" @click="toggle">
    {{ dark ? 'Dark' : 'Light' }}
  </button>`

export const DEMO_FILE_DIFFS: Record<(typeof DEMO_VUE_PATHS)[number], string> = {
  'src/components/WaitlistHero.vue': `diff --git a/src/components/WaitlistHero.vue b/src/components/WaitlistHero.vue
--- a/src/components/WaitlistHero.vue
+++ b/src/components/WaitlistHero.vue
@@ -1,10 +1,12 @@
 <template>
-  <section class="hero">
-    <h1>Join the waitlist</h1>
+  <section class="hero hero--beta">
+    <p class="eyebrow">Public beta</p>
+    <h1>Ship on your laptop.</h1>
     <WaitlistForm />
   </section>
 </template>
 
 <script setup lang="ts">
 import WaitlistForm from './WaitlistForm.vue'
 </script>
`,
  'src/components/PricingCard.vue': `diff --git a/src/components/PricingCard.vue b/src/components/PricingCard.vue
--- a/src/components/PricingCard.vue
+++ b/src/components/PricingCard.vue
@@ -8,8 +8,8 @@
     <li v-for="plan in plans" :key="plan.id">
-      <article class="card" style="margin-bottom: 24px">
+      <article class="card" style="margin-bottom: 12px">
         <h3>{{ plan.name }}</h3>
-        <p class="price">\${{ plan.price }}</p>
+        <p class="price">{{ plan.priceLabel }}</p>
       </article>
     </li>
`,
  'src/components/ThemeToggle.vue': `diff --git a/src/components/ThemeToggle.vue b/src/components/ThemeToggle.vue
--- a/src/components/ThemeToggle.vue
+++ b/src/components/ThemeToggle.vue
@@ -1,6 +1,8 @@
 <template>
-  <button @click="toggle">Theme</button>
+  <button class="theme-toggle" :aria-pressed="dark" @click="toggle">
+    {{ dark ? 'Dark' : 'Light' }}
+  </button>
 </template>
 
 <script setup lang="ts">
`,
}

const DEMO_FILES: DiffFile[] = [
  {
    path: 'src/components/WaitlistHero.vue',
    oldPath: null,
    status: 'modified',
    additions: 3,
    deletions: 2,
    binary: false,
  },
  {
    path: 'src/components/PricingCard.vue',
    oldPath: null,
    status: 'modified',
    additions: 2,
    deletions: 2,
    binary: false,
  },
  {
    path: 'src/components/ThemeToggle.vue',
    oldPath: null,
    status: 'modified',
    additions: 3,
    deletions: 1,
    binary: false,
  },
]

function event(
  runId: string,
  seq: number,
  kind: TurnEventKind,
  payload: TurnEventPayload,
  createdAt: number,
): TurnEventRow {
  return {
    id: `demo-ev-${seq}`,
    messageId: ASSISTANT_ID,
    runId,
    seq,
    kind,
    payload: JSON.stringify(payload),
    createdAt,
  }
}

function toolPair(
  runId: string,
  seq: number,
  startAt: number,
  start: TurnEventPayload,
  result: TurnEventPayload,
): TurnEventRow[] {
  return [
    event(runId, seq, 'tool_start', { ...start, status: 'in_progress' }, startAt),
    event(
      runId,
      seq + 1,
      'tool_result',
      { ...start, ...result, status: 'completed' },
      startAt + 4000,
    ),
  ]
}

function assistantEvents(runId: string, t0: number): TurnEventRow[] {
  const linear = toolPair(
    runId,
    2,
    t0 + 8_000,
    {
      name: 'mcp__linear__get_issue',
      title: 'get_issue',
      toolCallId: 'demo-mcp-1',
      toolKind: 'other',
      callRole: 'mcp',
      mcpServer: 'linear',
      input: { id: 'WAIT-18' },
    },
    {
      result: JSON.stringify({
        id: 'WAIT-18',
        title: 'Waitlist hero should match beta launch copy',
        description: 'Eyebrow: Public beta. Tighten pricing-card gap to 12px.',
      }),
    },
  )
  const web = toolPair(
    runId,
    4,
    t0 + 16_000,
    {
      name: 'WebFetch',
      title: 'Fetch waitlist.dev/blog/beta',
      toolCallId: 'demo-web-1',
      toolKind: 'fetch',
      callRole: 'tool',
      input: { url: 'https://waitlist.dev/blog/beta' },
    },
    {
      result: 'Public beta is open. Headline: Ship on your laptop. Dark/light toggle on the nav.',
    },
  )
  const hero = toolPair(
    runId,
    6,
    t0 + 28_000,
    {
      name: 'Edit',
      title: 'Edit WaitlistHero.vue',
      toolCallId: 'demo-edit-1',
      toolKind: 'edit',
      callRole: 'tool',
      locations: [{ path: 'src/components/WaitlistHero.vue' }],
      input: {
        file_path: 'src/components/WaitlistHero.vue',
        old_string: HERO_OLD,
        new_string: HERO_NEW,
      },
    },
    { result: 'Updated WaitlistHero.vue' },
  )
  const price = toolPair(
    runId,
    8,
    t0 + 40_000,
    {
      name: 'Edit',
      title: 'Edit PricingCard.vue',
      toolCallId: 'demo-edit-2',
      toolKind: 'edit',
      callRole: 'tool',
      locations: [{ path: 'src/components/PricingCard.vue' }],
      input: {
        file_path: 'src/components/PricingCard.vue',
        old_string: PRICE_OLD,
        new_string: PRICE_NEW,
      },
    },
    { result: 'Updated PricingCard.vue' },
  )
  const theme = toolPair(
    runId,
    10,
    t0 + 52_000,
    {
      name: 'Edit',
      title: 'Edit ThemeToggle.vue',
      toolCallId: 'demo-edit-3',
      toolKind: 'edit',
      callRole: 'tool',
      locations: [{ path: 'src/components/ThemeToggle.vue' }],
      input: {
        file_path: 'src/components/ThemeToggle.vue',
        old_string: THEME_OLD,
        new_string: THEME_NEW,
      },
    },
    { result: 'Updated ThemeToggle.vue' },
  )

  return [
    event(
      runId,
      1,
      'thought',
      { text: 'Pull WAIT-18 and the launch post, then patch the three Vue files.' },
      t0 + 3_000,
    ),
    ...linear,
    ...web,
    ...hero,
    ...price,
    ...theme,
    event(
      runId,
      12,
      'assistant',
      {
        text: 'Hero, pricing card, and theme toggle now match WAIT-18 and the beta launch copy.',
      },
      t0 + 64_000,
    ),
    event(runId, 13, 'turn_done', { stopReason: 'end_turn' }, t0 + 65_000),
  ]
}

function messages(runId: string, t0: number, t1: number): ChatMessage[] {
  const events = assistantEvents(runId, t0)
  return [
    {
      id: USER_ID,
      runId,
      role: 'user',
      content:
        'Match the waitlist to Linear WAIT-18 and pull the beta headline from the launch post.',
      stdout: '',
      stderr: '',
      status: 'success',
      exitCode: 0,
      diffSummary: [],
      sourceProvider: '',
      sourceUrl: '',
      sourceLabel: '',
      createdAt: t0,
      finishedAt: t0,
      events: [],
    },
    {
      id: ASSISTANT_ID,
      runId,
      role: 'assistant',
      content: 'Hero, pricing card, and theme toggle now match WAIT-18 and the beta launch copy.',
      stdout: '',
      stderr: '',
      status: 'success',
      exitCode: 0,
      diffSummary: [...DEMO_FILES],
      sourceProvider: '',
      sourceUrl: '',
      sourceLabel: '',
      createdAt: t0 + 2_000,
      finishedAt: t1,
      events,
    },
  ]
}

export function demoConversation(runId: string, now: number = Date.now()) {
  if (runId !== DEMO_DETAIL_RUN_ID) return null
  const t0 = now - 5 * 3600_000
  const t1 = now - 4.6 * 3600_000
  return {
    run: {
      id: runId,
      taskId: null,
      taskName: 'Chat',
      runtimeId: 'claude',
      trigger: 'chat' as const,
      status: 'success' as const,
      command: 'claude',
      cwd: '/Users/dev/waitlist',
      workspaceId: WS_ID,
      pid: null,
      exitCode: 0,
      stdout: '',
      stderr: '',
      startedAt: t0,
      finishedAt: t1,
      sessionId: 'demo-session',
      baseBranch: 'main',
      headBranch: 'main',
      baseSnapshot: 'demo-snap',
      model: 'opus',
      effort: 'high',
      runtimeMode: 'auto-accept-edits',
      archivedAt: null,
      verdict: 'unverified',
      repairAttempts: 0,
      timedOut: 0,
      lastReadAt: t1,
      prNumber: 0,
      prUrl: '',
      prTitle: '',
      prState: '',
      prChecks: '',
      prCheckedAt: 0,
    },
    messages: messages(runId, t0, t1),
    checkResults: [],
    queued: [],
    verdict: 'unverified' as const,
    canFollowUp: false,
    canQueueFollowUp: false,
    canSwitchRuntime: false,
    workspace: {
      id: WS_ID,
      projectId: PROJECT_ID,
      name: 'main',
      branch: 'main',
      path: '/Users/dev/waitlist',
      kind: 'main' as const,
      status: 'ready' as const,
      setupLog: '',
      setupExitCode: 0,
      blockedKind: '' as const,
      blockedReason: '',
      blockedAt: 0,
      baseCommit: '',
      createdAt: t0,
      archivedAt: null,
      projectName: 'waitlist',
      configuredBranch: 'main',
      actualBranch: 'main',
      exists: true,
      dirty: true,
      ahead: 0,
      activeRunId: null,
    },
    project: {
      id: PROJECT_ID,
      name: 'waitlist',
      slug: 'waitlist',
      path: '/Users/dev/waitlist',
      defaultBranch: 'main',
      remoteUrl: 'https://github.com/indie/waitlist',
      managed: 0,
      setupCommand: '',
      checks: '[]',
      createdAt: t0,
    },
    workspaces: [
      {
        id: WS_ID,
        projectId: PROJECT_ID,
        name: 'main',
        branch: 'main',
        path: '/Users/dev/waitlist',
        kind: 'main' as const,
        status: 'ready' as const,
        setupLog: '',
        setupExitCode: 0,
        blockedKind: '' as const,
        blockedReason: '',
        blockedAt: 0,
        baseCommit: '',
        createdAt: t0,
        archivedAt: null,
        projectName: 'waitlist',
        configuredBranch: 'main',
        actualBranch: 'main',
        exists: true,
        dirty: true,
        ahead: 0,
        activeRunId: null,
      },
    ],
    runtime: {
      id: 'claude',
      label: 'Claude Code',
      bin: 'claude',
      transport: 'cli' as const,
    },
    models: [],
    model: 'opus',
    effort: 'high',
    runtimeMode: 'auto-accept-edits' as const,
  }
}

export function demoRunWorkspace(runId: string, now: number = Date.now()) {
  if (runId !== DEMO_DETAIL_RUN_ID) return null
  const t0 = now - 5 * 3600_000
  return {
    runId,
    files: DEMO_FILES,
    repo: {
      isRepo: true,
      branch: 'main',
      head: 'a1b2c3d',
      remote: 'https://github.com/indie/waitlist',
      hasUpstream: true,
      ahead: 0,
      dirty: true,
    },
    totals: {
      additions: DEMO_FILES.reduce((n, f) => n + f.additions, 0),
      deletions: DEMO_FILES.reduce((n, f) => n + f.deletions, 0),
    },
    gh: { installed: true, authenticated: true },
    commits: { baseCommit: '', commits: [], published: 0 },
    taskName: 'Chat',
    baseBranch: 'main',
    startedAt: t0,
  }
}

export function demoFileDiff(runId: string, path: string) {
  if (runId !== DEMO_DETAIL_RUN_ID) return null
  const diff = DEMO_FILE_DIFFS[path as (typeof DEMO_VUE_PATHS)[number]]
  if (!diff) return null
  return { path, diff }
}

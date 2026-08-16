/**
 * Keep the model picker in step with the CLIs the user actually has installed.
 *
 * The problem this solves: a hardcoded list in `lib/models.ts` goes stale the
 * day `claude` ships a new model, and asking the CLI at render time costs a
 * process spawn (or, for `agy`, a network round trip) on a page that must feel
 * instant.
 *
 * So discovery never happens on the request path:
 *
 *   read   `cachedModelsForBin()` — one indexed SQLite row, synchronous
 *   check  fingerprint of the installed binary — an `lstat`, no spawn
 *   refill on a mismatch, in the background, results land in the next render
 *
 * A fresh clone therefore shows the static catalog immediately, and the real
 * one a moment later without the user doing anything. If discovery fails —
 * offline, unparseable bundle, CLI removed — the static catalog simply stays.
 */
import { spawn } from 'node:child_process'
import { createReadStream, lstatSync, readlinkSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  type DiscoveredModel,
  catalogFromDiscovered,
  parseAgyModelsOutput,
  parseClaudeBundleModels,
  parseGrokModelsOutput,
} from '../lib/modelDiscovery.ts'
import {
  type ModelOption,
  type RuntimeModelKind,
  modelKindForBin,
  modelsForKind,
} from '../lib/models.ts'
import { getDb } from './db.ts'
import { checkRuntimeInstalled } from './runtimePath.ts'
import { ensureProcessPathAugmented } from './userPath.ts'

type Provider = {
  /** Read the CLI's own model list. Rejects or returns [] when unavailable. */
  discover: (binPath: string) => Promise<DiscoveredModel[]>
}

const PROVIDERS: Partial<Record<RuntimeModelKind, Provider>> = {
  claude: { discover: (p) => scanClaudeBundle(p) },
  antigravity: { discover: (p) => runAndParse(p, ['models'], parseAgyModelsOutput, 20_000) },
  grok: { discover: (p) => runAndParse(p, ['models'], parseGrokModelsOutput, 10_000) },
}

/**
 * Models for a runtime, from cache, falling back to the static catalog.
 *
 * Synchronous and cheap by design — this sits on the run-detail render path.
 * The staleness check it kicks off is fire-and-forget.
 */
export function cachedModelsForBin(bin: string): ModelOption[] {
  const kind = modelKindForBin(bin)
  const fallback = modelsForKind(kind)
  if (!PROVIDERS[kind]) return fallback

  void refreshModelCatalog(bin)

  const row = getDb().prepare('SELECT models FROM model_catalog WHERE kind = ?').get(kind) as
    | { models: string }
    | undefined
  if (!row) return fallback
  try {
    const parsed = JSON.parse(row.models) as ModelOption[]
    return parsed.length > 0 ? parsed : fallback
  } catch {
    return fallback
  }
}

/**
 * Identify the installed binary without running it.
 *
 * Native `claude` installs are a symlink onto a version-stamped file, so the
 * link target alone changes on every update; size+mtime covers npm installs and
 * the other CLIs. Both are `lstat`-cheap, which is what lets us check on every
 * render instead of on a timer.
 */
function fingerprint(binPath: string): string {
  try {
    const st = lstatSync(binPath)
    if (st.isSymbolicLink()) {
      const target = readlinkSync(binPath)
      const abs = isAbsolute(target) ? target : resolve(dirname(binPath), target)
      const t = statSync(abs)
      return `${abs}:${t.size}:${Math.floor(t.mtimeMs)}`
    }
    return `${binPath}:${st.size}:${Math.floor(st.mtimeMs)}`
  } catch {
    return ''
  }
}

/** Kinds with a refresh already in flight — discovery is not re-entrant. */
const inFlight = new Set<RuntimeModelKind>()

/**
 * Even the staleness check walks PATH, so don't repeat it per render. A CLI
 * cannot update meaningfully faster than this, and a boot always re-checks.
 */
const CHECK_INTERVAL_MS = 60_000
const lastChecked = new Map<RuntimeModelKind, number>()

/**
 * Rediscover a runtime's models if the binary changed since we last looked.
 * Resolves once the cache is settled; callers on a render path do not await it.
 */
export async function refreshModelCatalog(bin: string, opts?: { force?: boolean }): Promise<void> {
  const kind = modelKindForBin(bin)
  const provider = PROVIDERS[kind]
  if (!provider || inFlight.has(kind)) return

  const now = Date.now()
  if (!opts?.force && now - (lastChecked.get(kind) ?? 0) < CHECK_INTERVAL_MS) return
  lastChecked.set(kind, now)

  const { installed, path } = checkRuntimeInstalled(bin)
  if (!installed) return

  const fp = fingerprint(path)
  if (!fp) return

  const row = getDb().prepare('SELECT fingerprint FROM model_catalog WHERE kind = ?').get(kind) as
    | { fingerprint: string }
    | undefined
  if (row?.fingerprint === fp) return

  inFlight.add(kind)
  try {
    const discovered = await provider.discover(path)
    const catalog = catalogFromDiscovered(kind, discovered)
    if (catalog.length === 0) return
    getDb()
      .prepare(
        `INSERT INTO model_catalog (kind, fingerprint, models, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           models = excluded.models,
           updatedAt = excluded.updatedAt`,
      )
      .run(kind, fp, JSON.stringify(catalog), Date.now())
  } catch {
    // Leave the previous rows in place; the fingerprint still differs, so the
    // next render retries. Never let discovery break a page.
  } finally {
    inFlight.delete(kind)
  }
}

/** Warm every known CLI's catalog once at boot, off the critical path. */
export function warmModelCatalogs(): void {
  for (const bin of ['claude', 'agy', 'grok']) {
    void refreshModelCatalog(bin, { force: true })
  }
}

// --- discovery mechanics ---------------------------------------------------

const BUNDLE_CHUNK = 4 * 1024 * 1024
/** Longest a single catalog entry runs; keeps entries from splitting a chunk. */
const BUNDLE_OVERLAP = 8 * 1024

/**
 * Claude Code has no `models list` subcommand and the catalog is baked into the
 * shipped bundle, so we read the bundle instead of running it — no spawn, no
 * network, works logged out.
 *
 * The native build is ~300MB, so this streams: 4MB chunks with an overlap so an
 * entry straddling a boundary is still matched, stopping at the
 * `latest_per_family` marker that closes the catalog object. Reading as latin1
 * keeps byte offsets stable through the binary's non-UTF-8 sections.
 */
function scanClaudeBundle(binPath: string): Promise<DiscoveredModel[]> {
  return new Promise((res) => {
    const stream = createReadStream(binPath, {
      encoding: 'latin1',
      highWaterMark: BUNDLE_CHUNK,
    })
    let carry = ''
    let done = false

    const finish = (models: DiscoveredModel[]) => {
      if (done) return
      done = true
      stream.destroy()
      res(models)
    }

    stream.on('data', (chunk: string | Buffer) => {
      const text = carry + chunk.toString()
      if (text.includes('latest_per_family:')) {
        const models = parseClaudeBundleModels(text)
        if (models.length > 0) {
          finish(models)
          return
        }
      }
      carry = text.slice(-BUNDLE_OVERLAP)
    })
    stream.on('error', () => finish([]))
    stream.on('end', () => finish([]))
  })
}

/** Run `<cli> <args>` and hand stdout to a parser. Bounded and never throws. */
function runAndParse(
  binPath: string,
  args: string[],
  parse: (text: string) => DiscoveredModel[],
  timeoutMs: number,
): Promise<DiscoveredModel[]> {
  return new Promise((res) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binPath, args, {
        env: { ...process.env, PATH: ensureProcessPathAugmented() },
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return res([])
    }

    let out = ''
    let settled = false
    const settle = (models: DiscoveredModel[]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      res(models)
    }
    const timer = setTimeout(() => settle([]), timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => {
      out += d
    })
    child.on('error', () => settle([]))
    child.on('close', () => {
      try {
        settle(parse(out))
      } catch {
        settle([])
      }
    })
  })
}

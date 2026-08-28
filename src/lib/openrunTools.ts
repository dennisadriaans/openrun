/**
 * The tools Open Run itself offers an agent, over MCP.
 *
 * A run knows things the agent cannot see from inside the worktree: which
 * automation started it, what the base commit was before the turn, which
 * verification checks it will be judged by, and how the previous runs of the
 * same automation went. Handing those over as MCP tools beats stuffing them
 * into every prompt — the agent asks only when it needs them.
 *
 * Everything here is read-only on purpose. The agent already has a shell and
 * the whole worktree; what it lacks is Open Run's own bookkeeping.
 *
 * Definitions live in `lib/` so the MCP page can list them without importing
 * the server; `server/openrunTools.ts` answers the calls and
 * `scripts/mcp-server.ts` is the stdio process the agent spawns.
 */

/** MCP `tools/list` entry. `inputSchema` is JSON Schema, as the spec requires. */
export type OpenrunToolDef = {
  name: string
  title: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** The name the config entry gets, and the `mcp__openrun__…` tool prefix. */
export const OPENRUN_MCP_SERVER_NAME = 'openrun'

/** Env var carrying the run a spawned server belongs to. */
export const OPENRUN_RUN_ID_ENV = 'OPENRUN_RUN_ID'

/**
 * Env var carrying the directory Open Run itself runs from.
 *
 * The server process is spawned by the agent, so it inherits the *worktree* as
 * its cwd — and the database path is resolved from cwd. Without this the
 * server would quietly create an empty `data/openrun.db` inside the user's
 * repository instead of reading the real one.
 */
export const OPENRUN_APP_DIR_ENV = 'OPENRUN_APP_DIR'

export const OPENRUN_TOOLS: OpenrunToolDef[] = [
  {
    name: 'run_context',
    title: 'Run context',
    description:
      'Facts about the Open Run run you are executing inside: the automation that started it, the workspace and branch, the model and access mode, and the verification checks your work will be judged by. Call this before assuming anything about why you were started.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'changed_files',
    title: 'Changed files',
    description:
      'Files this run has changed so far, compared against the commit the run started from — not against the last commit. Use it to review your own work before finishing.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'recent_runs',
    title: 'Recent runs',
    description:
      'How the previous runs of this same automation went: status, verdict, and when. Useful when a scheduled automation keeps failing the same way.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'How many runs to return (default 5).',
        },
      },
    },
  },
]

export function openrunToolDef(name: string): OpenrunToolDef | undefined {
  return OPENRUN_TOOLS.find((t) => t.name === name)
}

/** Shown when a tool is called outside a run, where there is nothing to report. */
export const NO_RUN_MESSAGE =
  'This tool only works inside an Open Run run — no run id was set in the environment.'

/** Shown when the server cannot tell where Open Run keeps its database. */
export const NO_APP_DIR_MESSAGE = `This tool needs ${OPENRUN_APP_DIR_ENV} in the environment to find Open Run's database. Start the agent from Open Run rather than by hand.`

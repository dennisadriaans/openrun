# Security policy

## Read this first

**Open Run executes coding-agent CLIs as child processes, in directories you
choose, using your own credentials.** Some runtime presets pass
permission-skipping flags (for example `--dangerously-skip-permissions` on Claude
Code). Agents can read and write files, run shell commands, and — where you have
enabled it — commit, push and open pull requests.

That is the product's function, not a defect. The consequence is blunt:

> **Anyone who can reach the Open Run HTTP server can run commands as you.**

Open Run therefore binds to `127.0.0.1` by default and refuses to start on a
non-loopback address unless you explicitly opt in *and* set an access token.

Binding to loopback is necessary but not sufficient: a page on the open web can
point its own domain at `127.0.0.1` (DNS rebinding) and then address Open Run as
though it were same-origin. So on a loopback bind Open Run also refuses any
request whose `Host` header is not a loopback name, and cross-site calls to
server functions are rejected by a CSRF check. If you reach Open Run through a
tunnel or reverse proxy, name it in `OPENRUN_ALLOWED_HOSTS`. See
[the security model](https://openrun.sh/docs/security) for the full trust
model, including what we defend against and what we deliberately do not.

## Supported versions

Only the latest tagged release receives security fixes. This is a young project
with a small maintainer team; we do not backport.

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private reporting: go to the repository's **Security** tab →
**Report a vulnerability**. This opens a draft advisory visible only to you and
the maintainers.

If you cannot use GitHub Security Advisories, email the maintainer at
`adriaansendennis@gmail.com` with `SECURITY` in the subject line.

Please include:

- The version or commit you tested.
- Your configuration: bind address, whether an access token was set, which
  runtimes and integrations were enabled.
- Reproduction steps, and the impact you believe it has.
- Whether you intend to publish, and on what timeline.

### What to expect

| Stage | Target |
| --- | --- |
| Acknowledgement | 5 business days |
| Initial assessment (accepted / needs info / out of scope) | 10 business days |
| Fix or documented mitigation | 90 days, coordinated with you |

These are honest targets for a small team, not a contractual SLA. If a report is
being actively exploited in the wild, say so in the first message and we will
prioritise accordingly.

We will credit you in the advisory and in `CHANGELOG.md` unless you ask us not
to. There is no bug bounty.

## In scope

- Bypassing the access-token check on any `/api/**` route or server function.
- Reaching Open Run from a web page you merely visited — cross-site requests
  that drive a server function, or a DNS-rebinding attack that gets past the
  `Host` check in `src/lib/serverAccess.ts`.
- Escaping the workspace path boundary in `src/server/files.ts` — reading or
  writing outside the run's working directory via traversal, absolute paths or
  symlinks.
- Getting a forged event onto the cloud relay so that it starts a run
  (`src/server/cloud/relay.ts`, `src/server/integrations/dispatcher.ts`).
- Bypassing a supervised-mode approval (`src/lib/approvals.ts`,
  `src/lib/supervisedPolicy.ts`) so a tool call executes without the decision it
  required.
- Argument injection into a spawned CLI via a runtime args template, prompt, or
  workspace name that escapes the intended argv.
- Leaking stored secrets (cloud session tokens, device tokens) to the client
  bundle, to logs, or to a notification payload.
- Any path that lets a *remote, unauthenticated* request cause code execution.

## Out of scope

These are known, documented, and intentional. Reports about them will be closed
with a pointer here.

- **A prompt that instructs an agent to do something destructive.** Prompts are
  code. Running agent-authored commands in your repository is what Open Run is
  for. Review prompts before you arm a schedule.
- **`--dangerously-skip-permissions` being available.** It is opt-in per runtime,
  surfaced in the command preview, and requires acknowledgement before a schedule
  is armed. Its existence is a documented product decision.
- **Secrets at rest in the local database.** Device pairing tokens and
  machine bearers are stored as SHA-256. MCP OAuth tokens, notification
  webhook URLs, and APNs tokens are AES-GCM sealed under `~/.openrun/data-key`,
  which is not in the database file. A copy of `openrun.db` alone is not a
  working credential. Anyone with your OS user can still read the key file;
  disk encryption is the operating system's job. See
  [the known-gaps list](https://openrun.sh/docs/security#known-gaps).
- **Anyone with a local shell account can control Open Run.** The trust boundary
  is the machine, not the user account.
- **Deliberately exposing the server to a network** and then reporting that it is
  reachable. Setting `OPENRUN_HOST` to a non-loopback address is an explicit,
  warned-about choice.
- Vulnerabilities in the agent CLIs themselves (`claude`, `codex`, `grok`,
  `gemini`, `fx`) — report those to their vendors.
- Denial of service by running a very large number of automations locally.
- Missing security headers on a loopback-only development server.

## Hardening checklist for operators

1. Leave the bind address at its default. Do not expose Open Run to a LAN or the
   internet. If you must reach it remotely, put it behind an authenticating
   reverse proxy or a VPN rather than binding to a public address.
2. Start with read-only prompts and a runtime that is *not* in full-access mode.
3. Configure project checks so runs must prove themselves before you trust them.
4. Use supervised mode for anything touching a repository you care about.
5. Review `~/.openrun` permissions if you have ever copied the directory
   between machines.

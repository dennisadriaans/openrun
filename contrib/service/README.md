# Running Open Run as a service

Open Run schedules agents with cron expressions, and `node-cron` only observes
ticks a **running process** is there to see. The only way an automation reliably
fires at 03:00 is for Open Run to be running at 03:00.

`pnpm dev` in a terminal tab is not that. These are.

| Platform | File | Install |
| --- | --- | --- |
| macOS | [`sh.openrun.plist`](./sh.openrun.plist) | `~/Library/LaunchAgents/`, then `launchctl load -w` |
| Linux | [`openrun.service`](./openrun.service) | `~/.config/systemd/user/`, then `systemctl --user enable --now openrun` |

Both are templates: edit the working directory, the `node` path, and `PATH`
before installing. Each file's header comment has the full sequence.

## Before you install

Build first — these run `scripts/start.ts`, which serves the production build
and refuses an unsafe bind:

```bash
pnpm install
pnpm build
```

## Two things people get wrong

**`PATH`.** launchd and systemd start a process with almost no environment.
Open Run spawns `claude`, `codex`, `git` and friends by name, so if `PATH` does
not contain the directory they installed into, every run fails with a confusing
"not installed" error. Both templates set `PATH` explicitly — check it matches
`echo $PATH` in your own shell.

**Logging out.** On Linux a user unit stops when your last session ends unless
you enable lingering:

```bash
sudo loginctl enable-linger "$USER"
```

On macOS a LaunchAgent runs only while you are logged in. It loads again at the
next login, but it does not keep Open Run running while you are logged out.

## Why a user service, not a system one

Open Run drives the agent CLIs **you** are logged into, using your credentials
and your git identity, against repositories in your home directory. It has to
run as you. A system-wide daemon would have none of that, and would be a much
larger thing to secure.

## Staying on loopback

Both templates leave the bind address at its default, so Open Run listens on
`127.0.0.1` only. Read [SECURITY.md](../../SECURITY.md) before changing that —
anyone who can reach the port can run commands as you. The one narrow exception
is the mobile companion, commented out in both files.

---
title: Open sourced under AGPLv3, with a hardened bind address
status: done
area: project
---

You no longer have to guess whether you are allowed to use, modify or run
Open Run in your company. It is licensed under **AGPLv3** — running it on your
own machines, on private repositories, modified however you like, carries no
obligation to publish anything. The copyleft attaches only if you distribute it
or offer a modified version to others as a network service. `COMMERCIAL-LICENSE.md`
covers the cases where AGPLv3 does not fit, and the README states the standing
boundary: **everything that runs on your machine is open source and stays that
way**, and a test fails the build if a local feature ever starts checking which
edition is running.

You no longer risk publishing arbitrary command execution by accident. Open Run
runs agent CLIs with your credentials, so anyone who can reach its HTTP server
can run commands as you — it now binds `127.0.0.1` only, and **refuses to start**
on a public interface unless you set an access token (`pnpm token:print`) or explicitly
override it. When a token is configured it is required on every server function
and API route through one global middleware, so no endpoint can be forgotten;
signed webhook endpoints stay reachable because they authenticate by HMAC
instead. Webhook secrets in the local database, and the token file itself, are
now written `0600` rather than inheriting your umask.

You no longer get a silent no-op from `pnpm start`. It pointed at a build output
this project never produces, so it exited without ever listening; it now serves
the real build — streaming SSE responses rather than buffering them — after
checking the bind address.

Docs: [getopenrun.dev](https://getopenrun.dev) covers install, architecture,
the security model, and how to add another agent CLI.

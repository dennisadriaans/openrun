You no longer have to be sitting at your Mac to find out a supervised run is
stuck on an approval prompt. Open Run now pairs with an iPhone app: scan a
code from the new Devices page and the phone can watch runs live, answer
allow/deny before the five-minute auto-deny fires, send a chat follow-up,
cancel a run, and switch an automation on or off.

Phone access is off until you start the server with `AGENTOPS_MOBILE=1`, and
turning it on no longer means exposing the whole app — only the token-checked
`/api/mobile/…` surface answers other devices, and a paired phone can never
edit runtimes or settings, touch workspace files, or commit, push, or open a
pull request.

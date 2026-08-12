You no longer need to be at the desktop to see what your agents are doing or to
redirect one — a Slack app now drives Open Run from your phone. Ask `status`,
`runs` or `automations`; `start`, `enable`, `disable` and `cancel` do what they
say; and replying inside a run's Slack thread sends that run another turn
without typing a command at all. Runs are addressable as `#1`, so nothing has
to be retyped from a list.

You no longer lose an instruction typed while a run was mid-turn — Open Run
refuses to resume a busy run, so the message is held and delivered the moment
that turn ends, instead of erroring out on the phone.

You no longer discover a supervised approval after it auto-denied — the prompt
is pushed to Slack with Allow / Deny buttons the second the agent asks, and the
button carries the request id so a stale card can never answer a newer prompt.

Connecting needs no tunnel: the desktop dials out to Slack over Socket Mode, so
a laptop behind NAT is reachable from Slack mobile with no public URL and no
inbound port. The HTTP endpoints (`/api/slack/events`,
`/api/slack/interactions`) remain for anyone who already runs one.

Because a Slack message that reaches a run is remote code execution on your own
machine, the allowlist defaults to *empty* and an empty allowlist authorises
nobody — not everybody. Messages posted by other apps are ignored outright.

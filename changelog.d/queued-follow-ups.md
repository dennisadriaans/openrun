- The composer no longer locks you out while the agent works. Keep typing:
  each message joins the run's queue and becomes its own turn, in order, the
  moment the current one ends — the same way the CLIs Open Run drives have
  always let you type ahead. The queue stacks on top of the composer, so you
  can see what is waiting, drop one message, or clear the lot.
- Waiting is no longer the only option. **Send now** interrupts the agent and
  hands it the queue immediately, and ⌘↵ does the same for the message you are
  typing. An interrupt taken for a queued message is not a Stop: no "run
  finished" notification, and the workspace stays reserved for the
  conversation instead of being handed to a scheduled run.
- Stopping a turn no longer throws away what you queued behind it. The queue
  survives, paused, with its own Send and Clear — a stop stops the agent, not
  your typing.

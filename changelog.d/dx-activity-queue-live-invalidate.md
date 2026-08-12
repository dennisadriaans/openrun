You no longer wait for an unrelated run status change to see “N runs queued”
on the Dashboard (or the Automations queue badge) — activity SSE invalidates
those lists on `queue_changed` while the stream is healthy.

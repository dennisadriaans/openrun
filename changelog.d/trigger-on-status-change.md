- You no longer have to accept "fires on every transition" when what you meant
  was "when it moves to In Progress". Finish setup now asks when the automation
  should run in plain words — a new ticket, a status, a label, an assignee, a
  comment — and compiles that to the event *and* the filter behind it. Status,
  label and assignee filters existed in the matcher all along but were
  unreachable from the setup flow, so a status trigger could only ever be bound
  wide open.
- The trigger no longer hides what it will actually match. The sentence it reads
  as is always shown, and one click expands it to the exact event ids and
  filters that get stored — so "why didn't my automation fire" is answerable
  before you create it rather than after a delivery quietly matches nothing.
- Triggers a provider cannot honour are no longer offered. Bitbucket never sends
  labels, so it has no label trigger instead of one that silently never matches;
  where a provider has no dedicated label event, the trigger says out loud that
  it fires on any update while the label is present.
- Connecting Jira now asks for write access up front. Nothing uses it yet — it
  is there so that when Open Run can comment on a ticket or move it to In
  Review, you are not sent back through the Atlassian consent screen to allow
  it.

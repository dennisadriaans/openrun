- Connecting an integration no longer asks you for anything. Jira, GitHub,
  GitLab, Bitbucket, Linear and Azure DevOps all connect the same way: click
  Connect, approve at the vendor, come back. No API token, no site URL, no
  signing secret, no public base URL, and no tunnel — the control plane owns the
  webhook and this machine receives events over the outbound connection it
  already holds. Hosting the webhook yourself is still there, folded behind
  "Set up a webhook yourself instead" on the providers that support it.
- Clicking Connect for a provider your control plane has no OAuth app for no
  longer dumps you on a raw JSON error page with no way back. The app asks the
  control plane which providers it can actually connect and says so in place;
  anything that goes wrong on the way out now returns you to the app with the
  reason.
- Connecting while signed out no longer means reading a paragraph about the
  sidebar. "Sign in and connect" does both, and lands you back on the same
  provider with the connect already running.
- A finished connection no longer sits there doing nothing. Connecting drops you
  straight into Finish setup — workspace, runtime, events and prompt, all
  pre-filled — so the last click leaves you with an automation that runs the
  next time someone touches an issue, instead of a row you have to go wire up
  yourself.

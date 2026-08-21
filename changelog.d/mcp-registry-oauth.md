- You no longer have to leave Open Run to finish an MCP install, and you no
  longer sign in once per CLI. Registry entries whose endpoint is OAuth-gated
  (Linear, Notion, Sentry, Stripe) are marked "Signs in on first use" and, once
  added, send you to the vendor's authorize page. Open Run registers itself as a
  client, keeps the token, writes it into every CLI config as an Authorization
  header, and refreshes it so scheduled runs and your own `claude` sessions stay
  live. A handwritten Authorization header is left alone. Connect is a full-page
  redirect — nothing to paste, no popup.
- Adding a server now tells you to restart any CLI session already open, since
  each CLI reads its own config at startup.

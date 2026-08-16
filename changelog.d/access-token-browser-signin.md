You no longer get locked out of your own app by setting an access token. A
configured token used to be unusable from a browser: the SPA's fetches and its
`EventSource` connections had no way to carry one, so every request after the
first came back `401`. Load the app once at `/?agentops_token=<token>` — the
token is exchanged for an `HttpOnly` cookie, stripped back out of the address
bar, and every later request carries it on its own. The `401` now says how.

You also no longer have to work out why `pnpm token` printed an npm registry
error instead of your token: pnpm claims that command name for itself, so the
script is `pnpm token:print`. It prints the sign-in URL along with the token.

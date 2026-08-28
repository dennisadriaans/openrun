- Grok no longer ignores an OAuth token Open Run just wrote. HTTP headers
  fan out as Grok's `headers` key rather than Codex's `http_headers`, which
  Grok treats as unknown and then fails the handshake with "authentication is
  required".

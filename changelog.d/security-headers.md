- Open Run no longer serves its pages without a content policy. Every response
  now carries a Content-Security-Policy, `nosniff`, `no-referrer` and
  `X-Frame-Options`, so a missed escape in the transcript — assistant prose,
  command output, a pull request title — cannot reach another host with your
  code or frame the app.

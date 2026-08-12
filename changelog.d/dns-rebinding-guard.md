You no longer have to trust that "loopback only" is enough — a web page you
merely visit can point its own domain at `127.0.0.1` and then talk to Open Run
as if it were same-origin, so Open Run now refuses any request that addresses it
by a name which is not a loopback name. Signed webhook and Slack endpoints are
exempt, and a tunnel or reverse-proxy hostname goes in `AGENTOPS_ALLOWED_HOSTS`.

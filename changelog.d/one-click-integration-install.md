You no longer paste webhook URLs and secrets into GitHub, Jira, or Linear by
hand to get an automation running. **Install** on Integrations registers the
provider webhook for you (GitHub via your local `gh` login; Jira/Linear with a
one-shot API token that is never stored), creates a connection, and wires a
ready automation with event filters and an `{{issue.*}}` prompt — no Open Run
env vars to manage. Localhost still needs a tunnel URL once; we remember it.

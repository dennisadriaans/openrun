You can sign in from the local GUI and connect Jira in the browser. Jira
webhooks hit the control plane and are pushed to this machine over an outbound
socket — no tunnel, no API token paste. Local install (email + token, or `gh`)
still works without an account.

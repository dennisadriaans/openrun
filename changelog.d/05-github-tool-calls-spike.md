- You can stop guessing whether a spawned agent can reach your `gh` login — executor children inherit working `gh` auth via `process.env`, and unauthenticated / no-remote failures already surface clearly in the log.


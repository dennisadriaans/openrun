A finished turn no longer shows a red error log for something that never
failed. Recoverable CLI chatter — an MCP server you have not signed into, a
websocket the CLI redials — is filtered out of the chat, and only real stderr
still opens the process log. The raw run log keeps everything.

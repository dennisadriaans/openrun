- A second Open Run client no longer means writing the API out a second time.
  Every capability is now described once, in one list, and the server functions
  the web app calls, a versioned `/api/v1` surface any client can reach, an
  OpenAPI document and a Swift package for the iOS and macOS apps are all built
  from that one description. They used to be separate hand-written surfaces
  that could disagree with each other, and only the web one was ever complete.
- Buttons that are disabled now explain themselves to every client, not just
  the web one. The rules that decide whether you can run an automation or arm
  its schedule already lived in one place; their answers now travel with the
  automation itself, so a phone or a Mac shows the same reason the browser
  does instead of guessing or staying silent.

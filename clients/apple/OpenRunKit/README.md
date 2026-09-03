# OpenRunKit

The half of an Apple client that is not a view: wire types, the HTTP client,
the SSE reader and its watchdog. The iOS and macOS apps both depend on this, so
there is one implementation of each rather than two that drift.

```bash
cd clients/apple/OpenRunKit
swift build
swift test
```

Add it to an app target with a local path dependency:

```swift
.package(path: "../../clients/apple/OpenRunKit")
```

## What is generated and what is not

`Sources/OpenRunKit/Generated.swift` is produced by `pnpm contract:generate`
from `src/contract/operations.ts`. **Never edit it** — the next run overwrites
it, and `pnpm contract:check` fails CI if it is stale. It carries:

- every operation as one `Operation` enum case, keyed by its wire id
- each operation's method, path, required capability and the clients it is
  offered to
- an `Encodable` request struct per operation that takes a payload
- `serverPingInterval` and `staleAfter`, generated from `src/lib/liveStream.ts`

Everything else in `Sources/` is hand-written and yours to change.

## Two rules worth keeping

**Never re-derive a refuse condition in Swift.** If you are about to write an
`if` that decides whether a button should be disabled, stop: that rule lives in
a gate module in `src/lib/`, the server runs it on the read path, and the
answer arrives as an `ActionDecision` on the resource. Show `reason` verbatim.
A second copy of the rule in Swift is how the fifth refuse condition ends up in
three places and missing from the fourth.

**Never restate the heartbeat period.** `SSEClient` derives its watchdog from
the two generated constants. A socket that dies while the device sleeps stays
open and never reports an error, so silence — not the socket's own opinion — is
what marks a stream dead. The web client learned this the hard way; the
constants are generated so the lesson cannot fail to reach here.

## Responses

Request payloads are generated because the contract declares their shapes.
Response types are not: `server/core.ts` infers its return types from the
database layer, and the contract does not describe them yet. Decode into the
concrete `Codable` types your app defines, or into `JSONValue` while a screen
is still taking shape.

Extending the contract to carry response shapes is the natural next step, and
would let this package generate response models too.

import Foundation

/// A live server-sent-event stream, with the watchdog that makes it trustworthy.
///
/// **The socket is not the judge of liveness — the heartbeat is.** A stream
/// that dies while the device sleeps, the network changes, or the Mac restarts
/// stays open as far as `URLSession` is concerned and never reports an error.
/// A reader that trusts the socket therefore shows a frozen screen forever and
/// never falls back to polling.
///
/// So liveness is decided here: the server heartbeats every
/// ``serverPingInterval`` seconds, and a stream silent past ``staleAfter`` is
/// torn down and redialled. Both numbers are generated from
/// `src/lib/liveStream.ts`, which owns them for the web client too — this file
/// must never restate them, because a second copy of that period is exactly
/// the bug the web client already fixed once.
///
/// The reconnect policy matches the web client's: exponential backoff, and
/// wake-up signals bypass the backoff entirely, because a device coming back
/// from sleep is precisely when a zombie socket surfaces.
public actor SSEClient {
    public enum Phase: Sendable {
        case connecting
        case open
        case reconnecting
        case closed
    }

    /// One `data:` frame. The server sends unnamed frames only, so the
    /// discriminant is the JSON `type` inside, not an `event:` field.
    public struct Frame: Sendable {
        public let data: String
    }

    private let url: URL
    private let token: String?
    private let session: URLSession

    private var phase: Phase = .closed
    private var lastFrameAt: Date?
    private var attempts = 0
    private var task: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?

    private let baseBackoff: TimeInterval = 1
    private let maxBackoff: TimeInterval = 15

    private var onFrame: (@Sendable (Frame) -> Void)?
    private var onPhase: (@Sendable (Phase) -> Void)?

    public init(url: URL, token: String? = nil, session: URLSession = .shared) {
        self.url = url
        self.token = token
        self.session = session
    }

    public func onFrame(_ handler: @escaping @Sendable (Frame) -> Void) {
        onFrame = handler
    }

    public func onPhaseChange(_ handler: @escaping @Sendable (Phase) -> Void) {
        onPhase = handler
    }

    /// True when a frame — heartbeat or data — arrived recently enough.
    public var isHealthy: Bool {
        guard phase == .open, let lastFrameAt else { return false }
        return Date().timeIntervalSince(lastFrameAt) < staleAfter
    }

    public func start() {
        guard task == nil else { return }
        setPhase(.connecting)
        task = Task { [weak self] in await self?.readLoop() }
        startWatchdog()
    }

    public func stop() {
        task?.cancel()
        task = nil
        watchdog?.cancel()
        watchdog = nil
        setPhase(.closed)
    }

    /// Redial now, ignoring backoff.
    ///
    /// Call this when the app returns to the foreground, the device wakes, or
    /// the network comes back. Those are the moments a socket that the system
    /// still reports as open turns out to be dead.
    public func reconnectNow() {
        attempts = 0
        task?.cancel()
        task = nil
        setPhase(.reconnecting)
        task = Task { [weak self] in await self?.readLoop() }
    }

    // MARK: - Internals

    private func setPhase(_ next: Phase) {
        phase = next
        onPhase?(next)
    }

    private func noteFrame() {
        lastFrameAt = Date()
    }

    /// Tear down and redial a stream that has gone quiet, whatever the socket
    /// claims about itself.
    private func startWatchdog() {
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard let self else { return }
                await self.checkForStall()
            }
        }
    }

    private func checkForStall() {
        guard phase == .open, let lastFrameAt else { return }
        if Date().timeIntervalSince(lastFrameAt) > staleAfter {
            reconnectNow()
        }
    }

    private func readLoop() async {
        while !Task.isCancelled {
            do {
                var request = URLRequest(url: url)
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                if let token {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }
                // Never let URLSession time the request out on its own — a long
                // quiet stream is normal, and the watchdog above is what decides
                // whether silence means death.
                request.timeoutInterval = .infinity

                let (bytes, response) = try await session.bytes(for: request)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    throw OpenRunError(status: 0, message: "Stream refused.")
                }

                attempts = 0
                noteFrame()
                setPhase(.open)

                var buffer = ""
                for try await line in bytes.lines {
                    if Task.isCancelled { return }
                    // Any line at all proves the socket is alive, comments and
                    // heartbeats included — that is what the watchdog measures.
                    noteFrame()

                    if line.isEmpty {
                        if !buffer.isEmpty {
                            onFrame?(Frame(data: buffer))
                            buffer = ""
                        }
                        continue
                    }
                    if line.hasPrefix(":") { continue }
                    if line.hasPrefix("data:") {
                        let value = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        buffer += buffer.isEmpty ? value : "\n\(value)"
                    }
                }
            } catch {
                if Task.isCancelled { return }
            }

            if Task.isCancelled { return }
            setPhase(.reconnecting)
            attempts += 1
            let delay = min(maxBackoff, baseBackoff * pow(2, Double(attempts - 1)))
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
    }
}

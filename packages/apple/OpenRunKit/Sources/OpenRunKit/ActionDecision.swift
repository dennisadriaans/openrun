import Foundation

/// Why a control is disabled, decided by the server.
///
/// The refuse conditions live in `src/lib/` — `runNowGate`, `enableGate`,
/// `gitActionGate` and the rest — and a TypeScript client imports them
/// directly. Swift cannot, and a second implementation in another language is
/// how the fifth refuse condition ends up in three places and missing from the
/// fourth.
///
/// So the server runs those gates on the read path and attaches the answers to
/// the resource. This type is the shape they arrive in. There is deliberately
/// no Swift logic here that decides whether something is allowed: if you find
/// yourself writing an `if` that re-derives one of these, the rule belongs in
/// the gate module and the decision belongs on the wire.
public struct ActionDecision: Codable, Hashable, Sendable {
    public let enabled: Bool

    /// Why not — present only when `enabled` is false, and already written for
    /// a person to read. Show it verbatim; do not rewrite it per platform.
    public let reason: String?

    public init(enabled: Bool, reason: String? = nil) {
        self.enabled = enabled
        self.reason = reason
    }

    /// A control the server did not describe.
    ///
    /// A build talking to an older server may ask for a decision that server
    /// has never heard of. Treat that as available rather than blocked: the
    /// server still enforces its own rules on the way in, so the worst case is
    /// an enabled control that refuses with a message, and the best case is a
    /// feature that keeps working. Refusing by default would disable controls
    /// on every server older than the app.
    public static let unknown = ActionDecision(enabled: true, reason: nil)
}

/// What may be done to an automation right now.
public struct TaskActions: Codable, Hashable, Sendable {
    public let runNow: ActionDecision
    public let enable: ActionDecision

    public init(runNow: ActionDecision, enable: ActionDecision) {
        self.runNow = runNow
        self.enable = enable
    }

    /// Forward compatible: a payload written before a control existed simply
    /// lacks it, and the missing decision reads as `.unknown` rather than
    /// failing the whole decode. Same tolerance `turn_events` rows already
    /// require of their readers.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        runNow = try container.decodeIfPresent(ActionDecision.self, forKey: .runNow) ?? .unknown
        enable = try container.decodeIfPresent(ActionDecision.self, forKey: .enable) ?? .unknown
    }
}

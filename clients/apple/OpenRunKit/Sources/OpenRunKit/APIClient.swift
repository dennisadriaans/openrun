import Foundation

/// A refusal from the server, carrying its own words.
///
/// The message is the one the gate module produced, so show it as-is rather
/// than substituting a generic "something went wrong".
public struct OpenRunError: LocalizedError, Sendable {
    public let status: Int
    public let message: String

    public var errorDescription: String? { message }

    public init(status: Int, message: String) {
        self.status = status
        self.message = message
    }
}

/// Which surface this client is on.
///
/// This is not a permission claim — the server decides what a caller may do
/// from how it reached the server, never from this header.
///
/// - `desktop`: the macOS app, running on the same machine. It reaches
///   `/api/v1/**` over loopback with the app's access token, and is offered
///   every operation.
/// - `mobile`: a paired phone. It is on another device, so it reaches
///   `/api/mobile/**` with its scoped device token — `/api/v1/**` refuses
///   non-loopback callers outright. `APIClient` is still useful for building
///   those requests, but point `baseURL` at the mobile surface.
public enum ClientKind: String, Sendable {
    case desktop
    case mobile
}

/// Reaches the operations in `Operation`.
///
/// One request path for every capability: the enum names the operation, the
/// generated `Route` says where it lives, and the caller says what it expects
/// back. There is no per-endpoint method to fall out of step with the server.
public actor APIClient {
    private let baseURL: URL
    private let kind: ClientKind
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    /// The token proving this client may call at all. A paired device's token
    /// for a phone; the access token for a desktop build.
    private var token: String?

    public init(
        baseURL: URL,
        kind: ClientKind,
        token: String? = nil,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.kind = kind
        self.token = token
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    public func setToken(_ token: String?) {
        self.token = token
    }

    /// Call an operation that takes no payload.
    public func call<Response: Decodable>(
        _ operation: Operation,
        expecting: Response.Type = Response.self
    ) async throws -> Response {
        try await send(operation, body: Optional<String>.none, expecting: Response.self)
    }

    /// Call an operation with one of the generated request structs.
    public func call<Body: Encodable, Response: Decodable>(
        _ operation: Operation,
        _ body: Body,
        expecting: Response.Type = Response.self
    ) async throws -> Response {
        try await send(operation, body: body, expecting: Response.self)
    }

    private func send<Body: Encodable, Response: Decodable>(
        _ operation: Operation,
        body: Body?,
        expecting: Response.Type
    ) async throws -> Response {
        let route = operation.route

        guard route.clients.contains(kind.rawValue) else {
            // Caught here rather than as a 403 round trip: the contract already
            // says which surfaces offer this, so a client can refuse to ask.
            throw OpenRunError(
                status: 403,
                message: "\(operation.rawValue) is not available to the \(kind.rawValue) client."
            )
        }

        var components = URLComponents(
            url: baseURL.appendingPathComponent(route.path),
            resolvingAgainstBaseURL: false
        )

        var request: URLRequest
        if route.method == "GET" {
            if let body {
                // Structured arguments travel as one JSON-encoded parameter;
                // flattening them would need a second encoding convention for
                // every client to agree on.
                let encoded = try encoder.encode(body)
                components?.queryItems = [
                    URLQueryItem(name: "input", value: String(decoding: encoded, as: UTF8.self))
                ]
            }
            guard let url = components?.url else {
                throw OpenRunError(status: 0, message: "Could not build a URL for \(operation.rawValue).")
            }
            request = URLRequest(url: url)
        } else {
            guard let url = components?.url else {
                throw OpenRunError(status: 0, message: "Could not build a URL for \(operation.rawValue).")
            }
            request = URLRequest(url: url)
            if let body {
                request.httpBody = try encoder.encode(body)
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
        }

        request.httpMethod = route.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(kind.rawValue, forHTTPHeaderField: "X-OpenRun-Client")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        guard (200..<300).contains(status) else {
            throw OpenRunError(status: status, message: Self.errorMessage(from: data, status: status))
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw OpenRunError(
                status: status,
                message: "The server's answer to \(operation.rawValue) did not decode: \(error.localizedDescription)"
            )
        }
    }

    /// Pull the server's own wording out of an error body, or fall back.
    private static func errorMessage(from data: Data, status: Int) -> String {
        if let payload = try? JSONDecoder().decode([String: JSONValue].self, from: data),
           let message = payload["error"]?.stringValue {
            return message
        }
        return "Request failed with \(status)."
    }
}

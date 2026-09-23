import XCTest
@testable import OpenRunKit

/// Checks on the generated surface.
///
/// These run on a Mac with `swift test`; they are not part of `pnpm test`,
/// which has no Swift toolchain.
final class ContractTests: XCTestCase {
    func testEveryOperationHasARoute() {
        for operation in Operation.allCases {
            let route = operation.route
            XCTAssertTrue(
                route.path.hasPrefix(apiPrefix),
                "\(operation.rawValue) is not under \(apiPrefix)"
            )
            XCTAssertTrue(["GET", "POST"].contains(route.method))
            XCTAssertFalse(route.capability.isEmpty)
            XCTAssertFalse(route.clients.isEmpty)
        }
    }

    func testRoutesAreDistinct() {
        let routes = Operation.allCases.map { "\($0.route.method) \($0.route.path)" }
        XCTAssertEqual(Set(routes).count, routes.count, "two operations share a route")
    }

    /// The phone must not be offered anything that writes to a repository.
    func testWritesAreNotOfferedToMobile() {
        let writes: [OpenRunKit.Operation] = [
            .gitCommitChanges, .gitPushChanges, .filesWriteWorkspace,
        ]
        for operation in writes {
            XCTAssertFalse(
                operation.route.clients.contains("mobile"),
                "\(operation.rawValue) must not be reachable from a phone"
            )
        }
    }

    /// The watchdog is only correct if it outlasts a heartbeat.
    func testStaleThresholdExceedsHeartbeat() {
        XCTAssertGreaterThan(staleAfter, serverPingInterval)
    }

    func testActionDecisionDecodesWithoutAReason() throws {
        let json = Data(#"{"enabled":true}"#.utf8)
        let decision = try JSONDecoder().decode(ActionDecision.self, from: json)
        XCTAssertTrue(decision.enabled)
        XCTAssertNil(decision.reason)
    }

    func testActionDecisionCarriesTheServersWords() throws {
        let json = Data(#"{"enabled":false,"reason":"Workspace has uncommitted changes."}"#.utf8)
        let decision = try JSONDecoder().decode(ActionDecision.self, from: json)
        XCTAssertFalse(decision.enabled)
        XCTAssertEqual(decision.reason, "Workspace has uncommitted changes.")
    }

    /// A payload written before a control existed must still decode.
    func testTaskActionsToleratesAMissingControl() throws {
        let json = Data(#"{"runNow":{"enabled":false,"reason":"No prompt."}}"#.utf8)
        let actions = try JSONDecoder().decode(TaskActions.self, from: json)
        XCTAssertFalse(actions.runNow.enabled)
        XCTAssertTrue(actions.enable.enabled, "an absent decision reads as available")
    }
}

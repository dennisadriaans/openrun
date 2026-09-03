// swift-tools-version: 5.9
import PackageDescription

/// The half of an Open Run Apple client that is not a view.
///
/// Wire types, the HTTP client, the SSE reader and its watchdog live here so
/// the iOS and macOS apps share one implementation instead of two that drift.
/// Add it to an app target with a local path dependency:
///
///     .package(path: "../../clients/apple/OpenRunKit")
let package = Package(
    name: "OpenRunKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "OpenRunKit", targets: ["OpenRunKit"])
    ],
    targets: [
        .target(name: "OpenRunKit"),
        .testTarget(name: "OpenRunKitTests", dependencies: ["OpenRunKit"])
    ]
)

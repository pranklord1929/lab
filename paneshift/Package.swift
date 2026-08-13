// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PaneShift",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "PaneShiftApp", targets: ["PaneShiftApp"]),
        .library(name: "PaneShiftCore", targets: ["PaneShiftCore"])
    ],
    targets: [
        // AppKit-free, so the conversation logic is unit-testable without a GUI.
        .target(
            name: "PaneShiftCore",
            path: "Sources/PaneShiftCore"
        ),
        .executableTarget(
            name: "PaneShiftApp",
            dependencies: ["PaneShiftCore"],
            path: "Sources/PaneShiftApp"
        ),
        // Lowercase `tests/`, alongside the shell suite: the repo already had one
        // and a case-insensitive macOS filesystem would otherwise hide a path
        // that breaks on the Linux server.
        .testTarget(
            name: "PaneShiftCoreTests",
            dependencies: ["PaneShiftCore"],
            path: "tests/PaneShiftCoreTests"
        )
    ]
)

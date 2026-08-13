// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PaneShift",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "PaneShiftApp", targets: ["PaneShiftApp"])
    ],
    targets: [
        .executableTarget(
            name: "PaneShiftApp",
            path: "Sources/PaneShiftApp"
        )
    ]
)

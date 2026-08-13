import AppKit
import QuartzCore

// Motion in PaneShift always encodes state: the beam runs only while agents are
// actually working, and carries their colours. Nothing here animates for
// decoration.
//
// Technique reproduced from the Border Beam component: a row of soft radial
// ellipses sweeping the bottom edge, drawn twice — a tight core and a wider
// bloom — with a gaussian blur and a brightness/saturation lift on each.

enum Motion {
    /// Sweep period, matching the reference component.
    static let period: CFTimeInterval = 3.1
    static let coreBlur: Double = 10
    static let bloomBlur: Double = 19
    static let brightness: Double = 0.12   // CIColorControls is additive, ~1.3 multiplicative
    static let saturation: Double = 1.2

    /// Ellipse geometry from the reference component, kept so the rhythm of
    /// overlapping sizes and offsets survives the port.
    static let blobs: [(width: CGFloat, height: CGFloat, offsetX: CGFloat)] = [
        (36, 36, 0), (30, 32, 39), (33, 28, -36), (29, 34, -54), (27, 30, 51),
        (36, 24, 21), (30, 22, -21), (25, 28, 66), (23, 30, -66)
    ]

    static func radialLayer(color: NSColor, width: CGFloat, height: CGFloat) -> CAGradientLayer {
        let layer = CAGradientLayer()
        layer.type = .radial
        let rgb = color.usingColorSpace(.deviceRGB) ?? color
        layer.colors = [
            rgb.withAlphaComponent(1.0).cgColor,
            rgb.withAlphaComponent(0.75).cgColor,
            rgb.withAlphaComponent(0.28).cgColor,
            rgb.withAlphaComponent(0.0).cgColor
        ]
        layer.locations = [0, 0.25, 0.55, 0.8]
        layer.startPoint = CGPoint(x: 0.5, y: 0.5)
        layer.endPoint = CGPoint(x: 1, y: 1)
        layer.bounds = CGRect(x: 0, y: 0, width: width, height: height)
        return layer
    }

    static func blurFilters(radius: Double) -> [CIFilter] {
        var filters: [CIFilter] = []
        if let blur = CIFilter(name: "CIGaussianBlur") {
            blur.setValue(radius, forKey: kCIInputRadiusKey)
            filters.append(blur)
        }
        if let controls = CIFilter(name: "CIColorControls") {
            controls.setValue(brightness, forKey: kCIInputBrightnessKey)
            controls.setValue(saturation, forKey: kCIInputSaturationKey)
            filters.append(controls)
        }
        return filters
    }

    static var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }
}

// MARK: - Beam

/// A light sweeping the bottom edge of its host. Sits at the foot of the
/// sidebar and reports which agents are currently working.
final class BeamView: NSView {
    private let bloomHost = CALayer()
    private let coreHost = CALayer()
    private var blobLayers: [CAGradientLayer] = []
    private var isRunning = false

    /// Colours of the agents currently working. Empty means an idle room, and
    /// the beam fades out entirely.
    var activeColors: [NSColor] = [] {
        didSet {
            guard activeColors.map(\.description) != oldValue.map(\.description) else { return }
            rebuild()
        }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        // Required for CIFilter-based layer filters to take effect on macOS.
        layerUsesCoreImageFilters = true
        layer?.masksToBounds = false
        bloomHost.masksToBounds = false
        coreHost.masksToBounds = false
        bloomHost.filters = Motion.blurFilters(radius: Motion.bloomBlur)
        coreHost.filters = Motion.blurFilters(radius: Motion.coreBlur)
        bloomHost.opacity = 0
        coreHost.opacity = 0
        layer?.addSublayer(bloomHost)
        layer?.addSublayer(coreHost)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { true }
    /// Purely decorative: never steal a click meant for the sidebar beneath it.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        bloomHost.frame = bounds.insetBy(dx: -14, dy: -14)
        coreHost.frame = bounds
        CATransaction.commit()
        rebuild()
    }

    private func rebuild() {
        blobLayers.forEach { $0.removeFromSuperlayer() }
        blobLayers.removeAll()

        let colors = activeColors
        let shouldRun = !colors.isEmpty && bounds.width > 1
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        bloomHost.opacity = shouldRun ? 0.72 : 0
        coreHost.opacity = shouldRun ? 1 : 0
        CATransaction.commit()
        isRunning = shouldRun
        guard shouldRun else { return }

        for (index, blob) in Motion.blobs.enumerated() {
            let color = colors[index % colors.count]
            for (host, scale) in [(bloomHost, CGFloat(1.25)), (coreHost, CGFloat(1.0))] {
                let layer = Motion.radialLayer(
                    color: color,
                    width: blob.width * 2.2 * scale,
                    height: blob.height * 1.6 * scale)
                layer.position = CGPoint(x: 0, y: host.bounds.height)
                host.addSublayer(layer)
                blobLayers.append(layer)
                attachSweep(to: layer, in: host, offsetX: blob.offsetX, phase: Double(index) / Double(Motion.blobs.count))
            }
        }
    }

    private func attachSweep(to layer: CAGradientLayer, in host: CALayer, offsetX: CGFloat, phase: Double) {
        guard !Motion.reduceMotion else {
            layer.position = CGPoint(x: host.bounds.width * CGFloat(phase) + offsetX, y: host.bounds.height)
            return
        }
        let animation = CABasicAnimation(keyPath: "position.x")
        animation.fromValue = -0.18 * host.bounds.width + offsetX
        animation.toValue = 1.18 * host.bounds.width + offsetX
        animation.duration = Motion.period
        animation.repeatCount = .infinity
        animation.timeOffset = Motion.period * phase
        animation.isRemovedOnCompletion = false
        layer.add(animation, forKey: "sweep")
    }
}

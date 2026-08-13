import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct Pane {
    let identifier: String
    let left: CGFloat
    let top: CGFloat
    let width: CGFloat
    let height: CGFloat
}

func run(_ executable: String, _ arguments: [String]) -> String? {
    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = output
    process.standardError = Pipe()
    do {
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        return String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
    } catch {
        return nil
    }
}

// Si défini, les commandes tmux sont exécutées sur cette machine distante via SSH
// (cas où la session tmux vit sur l'OVH et non en local).
var tmuxSSHHost: String? = nil

// Entoure une chaîne de guillemets simples pour qu'elle traverse le shell distant intacte.
func shellQuote(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

func tmux(_ arguments: [String]) -> String? {
    let full = ["tmux"] + arguments
    guard let host = tmuxSSHHost else {
        return run("/usr/bin/env", full)
    }
    // Une seule chaîne shell-quotée : send-keys avec du texte à espaces reste intact.
    let remoteCommand = full.map(shellQuote).joined(separator: " ")
    let sshArgs = [
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=6",
        "-o", "ControlMaster=auto",
        "-o", "ControlPath=\(NSHomeDirectory())/.ssh/cm-paneshift-%C",
        "-o", "ControlPersist=60",
        host,
        remoteCommand,
    ]
    return run("/usr/bin/env", sshArgs)
}

// Extensions d'images qu'on accepte au drop.
let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "heic", "webp", "tiff", "tif", "bmp"]

// Renvoie la première URL de fichier image trouvée dans un pasteboard de drag, sinon nil.
func firstImageURL(in pasteboard: NSPasteboard) -> URL? {
    let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    guard let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL] else {
        return nil
    }
    return urls.first { imageExtensions.contains($0.pathExtension.lowercased()) }
}

// Vue transparente qui, en plus de surligner le pane visé, devient une cible de drop
// pour les images : elle attrape le fichier avant le terminal en dessous.
final class IndicatorView: NSView {
    weak var hover: DropHover?
    var target: NSRect? { didSet { needsDisplay = true } }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        registerForDraggedTypes([.fileURL])
    }

    override func draw(_ dirtyRect: NSRect) {
        // Intentionally blank: the focused pane border is enough feedback.
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        firstImageURL(in: sender.draggingPasteboard) != nil ? .copy : []
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        firstImageURL(in: sender.draggingPasteboard) != nil ? .copy : []
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        hover?.disarmDrop()
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        defer { hover?.disarmDrop() }
        guard let url = firstImageURL(in: sender.draggingPasteboard) else { return false }
        return hover?.handleDroppedImage(url) ?? false
    }
}

final class DropHover {
    private let session: String
    private let panel: NSPanel
    private let indicator = IndicatorView(frame: .zero)
    private var panes: [Pane] = []
    private var clientSize = CGSize.zero
    private var terminalFrame: NSRect?
    private var lastMouse = NSPoint.zero
    private var isVisible = false
    private var eventTap: CFMachPort?
    private var eventSource: CFRunLoopSource?
    private var lastHotkey = Date.distantPast
    /// nil = room locale : aucun envoi réseau, on insère le chemin local.
    private let remoteHost: String?
    private let remoteDir: String

    init(session: String, remoteHost: String?, remoteDir: String) {
        self.session = session
        self.remoteHost = remoteHost
        self.remoteDir = remoteDir
        panel = NSPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = indicator
        indicator.hover = self
        refreshLayout()
    }

    func start() {
        installEventTap()
        Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
            guard let self else { return }
            guard tmux(["has-session", "-t", self.session]) != nil else {
                NSApp.terminate(nil)
                return
            }
            self.refreshLayout()
            if self.isVisible { self.showTarget(at: self.lastMouse) }
        }
        NSApp.run()
    }

    private func installEventTap() {
        let trustedOptions = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        if !AXIsProcessTrustedWithOptions(trustedOptions) {
            fputs("PaneShift: waiting for macOS Accessibility permission; Command+Shift+Arrow hotkeys are disabled until it is granted.\n", stderr)
        }
        let types: [CGEventType] = [.leftMouseDragged, .leftMouseUp, .keyDown]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << CGEventMask($1.rawValue)) }
        let context = Unmanaged.passUnretained(self).toOpaque()
        eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: { _, type, event, userInfo in
                guard let userInfo else { return Unmanaged.passUnretained(event) }
                let hover = Unmanaged<DropHover>.fromOpaque(userInfo).takeUnretainedValue()
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    if let tap = hover.eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
                    return Unmanaged.passUnretained(event)
                }
                if type == .keyDown, hover.handleKeyDown(event) {
                    return nil
                }
                DispatchQueue.main.async {
                    if type == .leftMouseDragged {
                        hover.lastMouse = NSEvent.mouseLocation
                        hover.armDropIfImageDrag()
                        hover.showTarget(at: hover.lastMouse)
                    } else if type == .leftMouseUp {
                        hover.scheduleDisarm()
                        hover.hide()
                    }
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: context
        )
        guard let eventTap else {
            fputs("PaneShift: could not install macOS event tap; grant Accessibility permission or use Ctrl+Tab.\n", stderr)
            return
        }
        eventSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
        if let eventSource {
            CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, .commonModes)
        }
        CGEvent.tapEnable(tap: eventTap, enable: true)
    }

    private func handleKeyDown(_ event: CGEvent) -> Bool {
        let flags = event.flags
        guard flags.contains(.maskCommand),
              flags.contains(.maskShift),
              !flags.contains(.maskControl),
              !flags.contains(.maskAlternate),
              terminalWindowFrame() != nil
        else { return false }

        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let delta: Int
        switch keyCode {
        case 124: delta = 1
        case 123: delta = -1
        default: return false
        }

        let now = Date()
        guard now.timeIntervalSince(lastHotkey) > 0.16 else { return true }
        lastHotkey = now
        focusAdjacentPane(delta: delta)
        return true
    }

    private func focusAdjacentPane(delta: Int) {
        guard let paneOutput = tmux(["list-panes", "-t", "\(session):agents", "-F", "#{pane_active}|#{@agent_index}|#{pane_id}"])
        else { return }
        let panes = paneOutput.split(separator: "\n").compactMap { line -> (active: Bool, index: Int, pane: String)? in
            let fields = line.split(separator: "|")
            guard fields.count == 3, let index = Int(fields[1]) else { return nil }
            return (fields[0] == "1", index, String(fields[2]))
        }
        guard let current = panes.first(where: { $0.active }) else { return }
        // Le cycle doit couvrir tous les agents de la room, pas quatre : avec six
        // agents les rôles 5 et 6 étaient inatteignables au clavier.
        let count = max(panes.count, 1)
        let targetIndex = ((current.index - 1 + delta + count) % count) + 1
        guard let target = panes.first(where: { $0.index == targetIndex }) else { return }
        _ = tmux(["select-window", "-t", "\(session):agents"])
        _ = tmux(["select-pane", "-t", target.pane])
    }

    private func refreshLayout() {
        guard let paneOutput = tmux(["list-panes", "-t", "\(session):agents", "-F", "#{pane_id}|#{pane_left}|#{pane_top}|#{pane_width}|#{pane_height}"]),
              let clientOutput = tmux(["display-message", "-p", "-t", session, "#{client_width}|#{client_height}"])
        else {
            return
        }
        let dimensions = clientOutput.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "|")
        guard dimensions.count == 2,
              let numericWidth = Double(dimensions[0]),
              let numericHeight = Double(dimensions[1])
        else { return }
        let width = CGFloat(numericWidth)
        let height = CGFloat(numericHeight)
        guard width > 0, height > 0 else { return }
        let parsed = paneOutput.split(separator: "\n").compactMap { line -> Pane? in
            let fields = line.split(separator: "|")
            guard fields.count == 5,
                  let numericLeft = Double(fields[1]),
                  let numericTop = Double(fields[2]),
                  let numericWidth = Double(fields[3]),
                  let numericHeight = Double(fields[4])
            else { return nil }
            return Pane(identifier: String(fields[0]), left: CGFloat(numericLeft), top: CGFloat(numericTop), width: CGFloat(numericWidth), height: CGFloat(numericHeight))
        }
        guard let frame = terminalWindowFrame(), !parsed.isEmpty else { return }
        panes = parsed
        clientSize = CGSize(width: width, height: height)
        terminalFrame = frame
        panel.setFrame(frame, display: true)
        indicator.frame = NSRect(origin: .zero, size: frame.size)
    }

    private func terminalWindowFrame() -> NSRect? {
        let terminalNames = ["Terminal", "iTerm2", "Warp", "Ghostty", "kitty", "Alacritty", "WezTerm"]
        let frontmost = NSWorkspace.shared.frontmostApplication?.localizedName
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        let candidates = windows.compactMap { item -> (NSRect, Int, Bool)? in
            guard let owner = item[kCGWindowOwnerName as String] as? String,
                  terminalNames.contains(owner),
                  let layer = item[kCGWindowLayer as String] as? Int,
                  layer == 0,
                  let bounds = item[kCGWindowBounds as String] as? [String: Any],
                  let x = (bounds["X"] as? NSNumber)?.doubleValue,
                  let y = (bounds["Y"] as? NSNumber)?.doubleValue,
                  let width = (bounds["Width"] as? NSNumber)?.doubleValue,
                  let height = (bounds["Height"] as? NSNumber)?.doubleValue
            else { return nil }
            let rect = CGRect(x: x, y: y, width: width, height: height)
            guard rect.width > 250, rect.height > 180 else { return nil }
            let screenTop = NSScreen.screens.map { $0.frame.maxY }.max() ?? NSScreen.main?.frame.maxY ?? 0
            let appKitRect = NSRect(x: rect.minX, y: screenTop - rect.maxY, width: rect.width, height: rect.height)
            return (appKitRect, Int(rect.width * rect.height), owner == frontmost)
        }
        return candidates.sorted {
            if $0.2 != $1.2 { return $0.2 }
            return $0.1 > $1.1
        }.first?.0
    }

    // Quel pane tmux se trouve sous ce point écran (coordonnées AppKit) ?
    private func paneUnder(_ point: NSPoint) -> Pane? {
        guard let frame = terminalFrame,
              frame.contains(point),
              clientSize.width > 0, clientSize.height > 0
        else { return nil }
        let x = (point.x - frame.minX) / frame.width * clientSize.width
        let y = (frame.maxY - point.y) / frame.height * clientSize.height
        return panes.first { x >= $0.left && x < $0.left + $0.width && y >= $0.top && y < $0.top + $0.height }
    }

    private func showTarget(at point: NSPoint) {
        guard let frame = terminalFrame,
              let pane = paneUnder(point)
        else { hide(); return }
        let scaleX = frame.width / clientSize.width
        let scaleY = frame.height / clientSize.height
        indicator.target = NSRect(
            x: pane.left * scaleX,
            y: frame.height - (pane.top + pane.height) * scaleY,
            width: pane.width * scaleX,
            height: pane.height * scaleY
        )
        panel.orderFrontRegardless()
        isVisible = true
    }

    private func hide() {
        indicator.target = nil
        panel.orderOut(nil)
        isVisible = false
    }

    // --- Drop d'image : envoi vers l'OVH puis insertion du chemin distant ---

    // Rend le panneau capable d'attraper le drop UNIQUEMENT quand une image est
    // en cours de glissement. Le reste du temps il laisse tout passer (clics normaux).
    func armDropIfImageDrag() {
        guard firstImageURL(in: NSPasteboard(name: .drag)) != nil else { return }
        if panel.ignoresMouseEvents { panel.ignoresMouseEvents = false }
    }

    func disarmDrop() {
        if !panel.ignoresMouseEvents { panel.ignoresMouseEvents = true }
    }

    // Filet de sécurité : si un drag se termine sans qu'on ait reçu le drop,
    // on redevient transparent aux clics peu après le relâchement.
    func scheduleDisarm() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.disarmDrop()
        }
    }

    // Appelé par la vue quand une image est lâchée. Renvoie true si un pane a été visé.
    func handleDroppedImage(_ url: URL) -> Bool {
        guard let pane = paneUnder(NSEvent.mouseLocation) else { return false }
        uploadAndInsert(url: url, paneId: pane.identifier)
        return true
    }

    private func uploadAndInsert(url: URL, paneId: String) {
        // Room locale : le fichier est déjà sur la machine qui exécute tmux.
        // Aucun transfert réseau ne doit avoir lieu — on insère le chemin local.
        guard let host = remoteHost else {
            _ = tmux(["send-keys", "-t", paneId, "-l", "regarde la capture \(url.path) "])
            return
        }
        let dir = remoteDir
        DispatchQueue.global(qos: .userInitiated).async {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyyMMdd-HHmmss"
            let stamp = formatter.string(from: Date())
            let ext = url.pathExtension.isEmpty ? "png" : url.pathExtension.lowercased()
            let remotePath = "\(dir)/shot-\(stamp).\(ext)"
            let uploaded = run("/usr/bin/env", ["scp", "-q", url.path, "\(host):\(remotePath)"]) != nil
            DispatchQueue.main.async {
                guard uploaded else {
                    fputs("PaneShift: échec de l'envoi de \(url.lastPathComponent) vers \(host).\n", stderr)
                    return
                }
                _ = tmux(["send-keys", "-t", paneId, "-l", "regarde la capture \(remotePath) "])
            }
        }
    }
}

func optionValue(_ name: String, in args: [String]) -> String? {
    guard let index = args.firstIndex(of: name), args.indices.contains(index + 1) else { return nil }
    return args[index + 1]
}

let arguments = CommandLine.arguments
guard let session = optionValue("--session", in: arguments) else {
    fputs("Usage: paneshift-drop-hover --session NAME [--ssh user@host] [--remote user@host] [--remote-dir PATH]\n", stderr)
    exit(64)
}
// --ssh : machine où tourne la session tmux (les commandes tmux passent par SSH).
tmuxSSHHost = optionValue("--ssh", in: arguments)
// --remote : machine où l'on dépose les images (par défaut, la même que --ssh).
// Sans --ssh ni --remote la room est locale : aucun hôte par défaut, donc aucun
// envoi réseau possible. L'ancienne valeur codée en dur expédiait les captures
// d'une room locale vers un serveur OVH.
let remoteHost = optionValue("--remote", in: arguments) ?? tmuxSSHHost
let remoteDir = optionValue("--remote-dir", in: arguments) ?? "/home/ubuntu/work/PANESHIFT/shots"
NSApplication.shared.setActivationPolicy(.accessory)
let hover = DropHover(session: session, remoteHost: remoteHost, remoteDir: remoteDir)
hover.start()

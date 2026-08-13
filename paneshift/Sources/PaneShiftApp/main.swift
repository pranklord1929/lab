import AppKit
import Foundation

// MARK: - Theme

struct Pane {
    let index: Int
    let identifier: String
    let title: String
}

enum TerminalTheme {
    static let appBackground = NSColor(calibratedWhite: 0.96, alpha: 1.0)
    static let paneBackground = NSColor.white
    static let outputBackground = NSColor.white
    static let sidebarBackground = NSColor.white
    static let text = NSColor(calibratedWhite: 0.05, alpha: 1.0)
    static let dimText = NSColor(calibratedWhite: 0.48, alpha: 1.0)
    static let active = NSColor(calibratedRed: 0.0, green: 0.84, blue: 1.0, alpha: 1.0)
    static let inactive = NSColor(calibratedWhite: 0.70, alpha: 1.0)
    static let gold = NSColor(calibratedWhite: 0.05, alpha: 1.0)
    static let black = NSColor.black
    static let white = NSColor.white
}

func paneHeaderColor(_ index: Int) -> NSColor {
    switch index {
    case 1: return color256(141)
    case 2: return color256(117)
    case 3: return color256(150)
    case 4: return color256(223)
    default: return color256(250)
    }
}

// MARK: - xterm 256-colour palette (matches tmux `colourN`)

func color256(_ n: Int) -> NSColor {
    func c(_ r: Int, _ g: Int, _ b: Int) -> NSColor {
        NSColor(calibratedRed: CGFloat(r) / 255.0, green: CGFloat(g) / 255.0, blue: CGFloat(b) / 255.0, alpha: 1.0)
    }
    switch n {
    case 0: return c(0, 0, 0)
    case 1: return c(205, 0, 0)
    case 2: return c(0, 205, 0)
    case 3: return c(205, 205, 0)
    case 4: return c(0, 0, 238)
    case 5: return c(205, 0, 205)
    case 6: return c(0, 205, 205)
    case 7: return c(229, 229, 229)
    case 8: return c(127, 127, 127)
    case 9: return c(255, 0, 0)
    case 10: return c(0, 255, 0)
    case 11: return c(255, 255, 0)
    case 12: return c(92, 92, 255)
    case 13: return c(255, 0, 255)
    case 14: return c(0, 255, 255)
    case 15: return c(255, 255, 255)
    case 16...231:
        let v = n - 16
        let r = v / 36, g = (v / 6) % 6, b = v % 6
        func level(_ x: Int) -> Int { x == 0 ? 0 : 55 + 40 * x }
        return c(level(r), level(g), level(b))
    case 232...255:
        let gray = 8 + 10 * (n - 232)
        return c(gray, gray, gray)
    default:
        return TerminalTheme.text
    }
}

// MARK: - ANSI SGR parser → attributed string (true-terminal look)

func ansiAttributed(_ input: String, font: NSFont, boldFont: NSFont, defaultFg: NSColor, defaultBg: NSColor) -> NSAttributedString {
    let result = NSMutableAttributedString()
    var fg: NSColor? = nil
    var bg: NSColor? = nil
    var bold = false
    var dim = false
    var inverse = false

    func attributes() -> [NSAttributedString.Key: Any] {
        var effFg = fg ?? defaultFg
        var effBg = bg
        if inverse {
            let a = effFg
            let b = effBg ?? defaultBg
            effFg = b
            effBg = a
        }
        if dim { effFg = effFg.withAlphaComponent(0.6) }
        var attrs: [NSAttributedString.Key: Any] = [
            .font: bold ? boldFont : font,
            .foregroundColor: effFg
        ]
        if let effBg { attrs[.backgroundColor] = effBg }
        return attrs
    }

    func applySGR(_ codes: [Int]) {
        var i = 0
        if codes.isEmpty { fg = nil; bg = nil; bold = false; dim = false; inverse = false; return }
        while i < codes.count {
            let code = codes[i]
            switch code {
            case 0: fg = nil; bg = nil; bold = false; dim = false; inverse = false
            case 1: bold = true
            case 2: dim = true
            case 7: inverse = true
            case 22: bold = false; dim = false
            case 27: inverse = false
            case 39: fg = nil
            case 49: bg = nil
            case 30...37: fg = color256(code - 30)
            case 90...97: fg = color256(code - 90 + 8)
            case 40...47: bg = color256(code - 40)
            case 100...107: bg = color256(code - 100 + 8)
            case 38, 48:
                let isFg = (code == 38)
                if i + 1 < codes.count, codes[i + 1] == 5, i + 2 < codes.count {
                    let color = color256(codes[i + 2]); if isFg { fg = color } else { bg = color }; i += 2
                } else if i + 1 < codes.count, codes[i + 1] == 2, i + 4 < codes.count {
                    let color = NSColor(calibratedRed: CGFloat(codes[i + 2]) / 255.0, green: CGFloat(codes[i + 3]) / 255.0, blue: CGFloat(codes[i + 4]) / 255.0, alpha: 1.0)
                    if isFg { fg = color } else { bg = color }; i += 4
                }
            default: break
            }
            i += 1
        }
    }

    let scalars = Array(input.unicodeScalars)
    var idx = 0
    var pending = ""
    func flush() {
        if !pending.isEmpty {
            result.append(NSAttributedString(string: pending, attributes: attributes()))
            pending = ""
        }
    }
    while idx < scalars.count {
        let s = scalars[idx]
        if s == "\u{1B}" { // ESC
            flush()
            if idx + 1 < scalars.count, scalars[idx + 1] == "[" {
                var j = idx + 2
                var params = ""
                while j < scalars.count {
                    let ch = scalars[j]
                    if (ch.value >= 0x40 && ch.value <= 0x7E) { break } // final byte
                    params.unicodeScalars.append(ch)
                    j += 1
                }
                if j < scalars.count {
                    let final = scalars[j]
                    if final == "m" {
                        let codes = params.split(separator: ";", omittingEmptySubsequences: false).map { Int($0) ?? 0 }
                        applySGR(codes)
                    }
                    idx = j + 1
                    continue
                }
            }
            if idx + 1 < scalars.count, scalars[idx + 1] == "]" {
                // OSC (e.g. window title): ESC ] ... terminated by BEL or ST (ESC \).
                var j = idx + 2
                while j < scalars.count {
                    if scalars[j] == "\u{07}" { j += 1; break }
                    if scalars[j] == "\u{1B}", j + 1 < scalars.count, scalars[j + 1] == "\\" { j += 2; break }
                    j += 1
                }
                idx = j
                continue
            }
            // Lone ESC or unsupported: skip the ESC.
            idx += 1
            continue
        }
        if s == "\r" { idx += 1; continue }
        pending.unicodeScalars.append(s)
        idx += 1
    }
    flush()
    return result
}

// MARK: - Terminal input-chrome filter

func stripANSI(_ s: String) -> String {
    var out = String.UnicodeScalarView()
    let scalars = Array(s.unicodeScalars)
    var i = 0
    while i < scalars.count {
        if scalars[i] == "\u{1B}" {
            i += 1
            if i < scalars.count, scalars[i] == "[" {
                i += 1
                while i < scalars.count, !(scalars[i].value >= 0x40 && scalars[i].value <= 0x7E) { i += 1 }
                if i < scalars.count { i += 1 }
            } else if i < scalars.count, scalars[i] == "]" {
                i += 1
                while i < scalars.count {
                    if scalars[i] == "\u{07}" { i += 1; break }
                    if scalars[i] == "\u{1B}", i + 1 < scalars.count, scalars[i + 1] == "\\" { i += 2; break }
                    i += 1
                }
            }
            continue
        }
        out.append(scalars[i]); i += 1
    }
    return String(out)
}

// Claude/Codex draw their input box as a `❯` prompt bounded by two full-width
// `─` rules, with the permission-mode line just below it. In chat mode we own
// the input, so we crop that box out of the mirror and hand the mode line back
// to be shown under our own field. Returns (body to display, mode line if any).
func splitTerminalChrome(_ raw: String) -> (body: String, status: String?) {
    let rawLines = raw.components(separatedBy: "\n")
    let plain = rawLines.map { stripANSI($0).trimmingCharacters(in: .whitespaces) }
    var rules: [Int] = []
    for (i, t) in plain.enumerated() where t.count >= 20 && t.allSatisfy({ $0 == "─" }) {
        rules.append(i)
    }
    guard rules.count >= 2 else { return (raw, nil) }
    let rBottom = rules[rules.count - 1]
    let rTop = rules[rules.count - 2]
    guard rBottom > rTop, rTop >= rawLines.count - 12 else { return (raw, nil) }
    let promptMarkers: Set<Character> = ["❯", "›", ">", "▌"]
    let hasPrompt = (rTop + 1 ..< rBottom).contains { idx in
        guard let first = plain[idx].first else { return false }
        return promptMarkers.contains(first)
    }
    guard hasPrompt else { return (raw, nil) }
    var status: String? = nil
    for idx in (rBottom + 1) ..< plain.count where !plain[idx].isEmpty {
        let t = plain[idx]
        if t.contains("shift+tab to cycle") || t.hasPrefix("⏵") || t.hasPrefix("▸") { status = t }
        break
    }
    let body = rawLines[0 ..< rTop].joined(separator: "\n")
    return (body, status)
}

// MARK: - Non-isolated shell helpers

// Launchd (via `open`) gives GUI apps a minimal PATH that omits Homebrew, so
// `tmux`, `git`, `jq`… would not resolve. Prepend the usual tool locations.
func augmentedEnvironment() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    let current = env["PATH"] ?? ""
    env["PATH"] = current.isEmpty ? extra : "\(extra):\(current)"
    return env
}

func shellCapture(_ launchPath: String, _ arguments: [String]) -> String? {
    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: launchPath)
    process.arguments = arguments
    process.environment = augmentedEnvironment()
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return nil }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return String(data: data, encoding: .utf8)
}

// MARK: - Sidebar data model

struct AgentRoute: Sendable {
    let index: Int
    let name: String
    let provider: String
    let model: String
    let color: Int
    let anthropicModels: [String]
    let openaiModels: [String]
}

struct SidebarData: Sendable {
    var agents: [AgentRoute] = []
    var momentum = ""
    var elapsed = ""
    var longest = ""
    var sessions = ""
    var streak = ""
    var cpu = ""
    var gpu = ""
    var tokens = ""
    var ram = ""
    var ovh = ""
    var live = ""
    var total = ""
    var handoffs = ""
    var claims = ""
    var conflicts = ""
    var sync = ""
    var runs = ""
    var grid: [String] = []

    init?(raw: String) {
        var found = false
        for line in raw.split(separator: "\n", omittingEmptySubsequences: false) {
            let f = line.components(separatedBy: "\t")
            guard let kind = f.first else { continue }
            switch kind {
            case "AGENT" where f.count >= 6:
                let models: (String) -> [String] = { csv in
                    csv.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                }
                agents.append(AgentRoute(
                    index: Int(f[1]) ?? 0,
                    name: f[2],
                    provider: f[3],
                    model: f[4],
                    color: Int(f[5]) ?? 250,
                    anthropicModels: f.count > 6 ? models(f[6]) : [],
                    openaiModels: f.count > 7 ? models(f[7]) : []
                ))
                found = true
            case "SESSION" where f.count >= 6:
                momentum = f[1]; elapsed = f[2]; longest = f[3]; sessions = f[4]; streak = f[5]
            case "SYSTEM" where f.count >= 4:
                cpu = f[1]; gpu = f[2]; tokens = f[3]
                if f.count > 4 { ram = f[4] }
            case "OVH" where f.count >= 2:
                ovh = f[1]
            case "MEMORY" where f.count >= 2:
                let h = f[1].components(separatedBy: "|")
                if h.count >= 7 {
                    live = h[0]; total = h[1]; handoffs = h[2]; claims = h[3]; conflicts = h[4]; sync = h[5]; runs = h[6]
                }
            case "GRID" where f.count >= 2:
                grid.append(f[1])
            default:
                break
            }
        }
        if !found { return nil }
    }
}

// MARK: - tmux controller

final class TmuxController {
    let session: String
    var roomScript: String?
    var roomConfig: String?

    init(session: String) {
        self.session = session
    }

    @discardableResult
    func tmux(_ arguments: [String], input: String? = nil) -> String? {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["tmux"] + arguments
        process.environment = augmentedEnvironment()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        var stdinPipe: Pipe?
        if input != nil {
            let pipe = Pipe()
            stdinPipe = pipe
            process.standardInput = pipe
        }
        do { try process.run() } catch { return nil }
        if let input, let stdinPipe {
            if let data = input.data(using: .utf8) {
                stdinPipe.fileHandleForWriting.write(data)
            }
            try? stdinPipe.fileHandleForWriting.close()
        }
        // Drain the pipe BEFORE waiting, otherwise a capture larger than the
        // 64 KB pipe buffer blocks the child and deadlocks the main thread.
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func optionValue(_ name: String) -> String? {
        guard let value = tmux(["show-option", "-t", session, "-v", name])?
            .trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    func panes() -> [Pane] {
        guard let output = tmux(["list-panes", "-t", "\(session):agents", "-F", "#{@agent_index}|#{pane_id}|#{@agent_name}|#{@agent_provider}|#{@agent_model}"]) else {
            return []
        }
        return output.split(separator: "\n").compactMap { line in
            let fields = line.split(separator: "|", omittingEmptySubsequences: false)
            guard fields.count >= 5, let index = Int(fields[0]) else { return nil }
            let name = fields[2].isEmpty ? "Terminal \(index)" : String(fields[2])
            let provider = fields[3].isEmpty ? "" : String(fields[3]).uppercased()
            let model = fields[4].isEmpty ? "default" : String(fields[4])
            let suffix = provider.isEmpty ? "" : " · \(provider) / \(model)"
            return Pane(index: index, identifier: String(fields[1]), title: "\(name)\(suffix)")
        }.sorted { $0.index < $1.index }
    }

    func capture(_ pane: Pane) -> String {
        tmux(["capture-pane", "-p", "-e", "-S", "-420", "-t", pane.identifier]) ?? ""
    }

    func focus(_ pane: Pane) {
        _ = tmux(["select-window", "-t", "\(session):agents"])
        _ = tmux(["select-pane", "-t", pane.identifier])
    }

    func paste(_ text: String, into pane: Pane) {
        guard !text.isEmpty else { return }
        _ = tmux(["load-buffer", "-"], input: text)
        _ = tmux(["paste-buffer", "-t", pane.identifier])
    }

    func sendLiteral(_ text: String, into pane: Pane) {
        guard !text.isEmpty else { return }
        _ = tmux(["send-keys", "-l", "-t", pane.identifier, text])
    }

    func sendKey(_ key: String, into pane: Pane) {
        _ = tmux(["send-keys", "-t", pane.identifier, key])
    }

    func resizeWindow(columns: Int, rows: Int) {
        guard columns > 0, rows > 0 else { return }
        _ = tmux(["set-window-option", "-t", "\(session):agents", "window-size", "manual"])
        _ = tmux(["resize-window", "-t", "\(session):agents", "-x", "\(columns)", "-y", "\(rows)"])
    }
}

// MARK: - Terminal text view + pane

final class TerminalTextView: NSTextView {
    var onTerminalKey: ((NSEvent) -> Bool)?
    var onTerminalText: ((String) -> Void)?
    var onTerminalCommand: ((String) -> Void)?
    var onFocus: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }

    override func mouseDown(with event: NSEvent) {
        onFocus?()
        super.mouseDown(with: event)
    }

    override func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if modifiers.contains(.command) {
            super.keyDown(with: event)
            return
        }
        if onTerminalKey?(event) == true {
            return
        }
        super.keyDown(with: event)
    }

    override func insertText(_ insertString: Any, replacementRange: NSRange) {
        if let text = insertString as? String, !text.isEmpty {
            onTerminalText?(text)
        } else if let attributed = insertString as? NSAttributedString, !attributed.string.isEmpty {
            onTerminalText?(attributed.string)
        }
    }

    override func doCommand(by selector: Selector) {
        switch selector {
        case #selector(insertNewline(_:)): onTerminalCommand?("Enter")
        case #selector(deleteBackward(_:)): onTerminalCommand?("BSpace")
        case #selector(insertTab(_:)): onTerminalCommand?("Tab")
        case #selector(cancelOperation(_:)): onTerminalCommand?("Escape")
        case #selector(moveLeft(_:)): onTerminalCommand?("Left")
        case #selector(moveRight(_:)): onTerminalCommand?("Right")
        case #selector(moveDown(_:)): onTerminalCommand?("Down")
        case #selector(moveUp(_:)): onTerminalCommand?("Up")
        default: super.doCommand(by: selector)
        }
    }
}

// Editable one/multi-line field used by the chat input bar. Enter submits,
// Shift+Enter inserts a newline.
final class InputTextView: NSTextView {
    var onSubmit: ((String) -> Void)?
    var onFocusChange: ((Bool) -> Void)?

    override var acceptsFirstResponder: Bool { true }

    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder(); if ok { onFocusChange?(true) }; return ok
    }
    override func resignFirstResponder() -> Bool {
        let ok = super.resignFirstResponder(); if ok { onFocusChange?(false) }; return ok
    }
    override func doCommand(by selector: Selector) {
        if selector == #selector(insertNewline(_:)) {
            let shift = NSApp.currentEvent?.modifierFlags.contains(.shift) ?? false
            if shift { super.insertNewline(nil) } else { onSubmit?(string) }
            return
        }
        super.doCommand(by: selector)
    }
}

final class PaneView: NSView, NSTextViewDelegate {
    let pane: Pane
    let controller: TmuxController
    let title = NSTextField(labelWithString: "")
    let output = TerminalTextView()
    let scroll = NSScrollView()
    let inputBar = NSView()
    let input = InputTextView()
    let inputScroll = NSScrollView()
    let placeholder = NSTextField(labelWithString: "")
    let modeButton = NSButton()
    let permButton = NSButton()
    private var permHeight: NSLayoutConstraint!
    let monoFont = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    let monoBold = NSFont.monospacedSystemFont(ofSize: 12, weight: .bold)
    var isActive = false
    var directMode = false
    var onFocus: ((PaneView) -> Void)?
    private var lastRaw = ""

    private let chatPlaceholder = "Écris un message…  ⏎ pour envoyer"
    private let directPlaceholder = "Mode direct — tape dans le terminal · ⌨ pour revenir"

    init(pane: Pane, controller: TmuxController) {
        self.pane = pane
        self.controller = controller
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 9
        layer?.masksToBounds = true
        layer?.borderWidth = 1
        layer?.backgroundColor = TerminalTheme.paneBackground.cgColor
        registerForDraggedTypes([.fileURL])

        title.stringValue = "  ○  \(pane.title.uppercased())  "
        title.font = .monospacedSystemFont(ofSize: 12, weight: .bold)
        title.textColor = TerminalTheme.black
        title.backgroundColor = paneHeaderColor(pane.index)
        title.drawsBackground = true
        title.translatesAutoresizingMaskIntoConstraints = false

        output.isEditable = false
        output.isSelectable = true
        output.font = monoFont
        output.textColor = TerminalTheme.text
        output.insertionPointColor = TerminalTheme.active
        output.backgroundColor = TerminalTheme.outputBackground
        output.selectedTextAttributes = [
            .backgroundColor: TerminalTheme.active.withAlphaComponent(0.35),
            .foregroundColor: TerminalTheme.black
        ]
        output.textContainerInset = NSSize(width: 8, height: 6)
        output.onFocus = { [weak self] in
            guard let self else { return }
            self.onFocus?(self)
        }
        output.onTerminalKey = { [weak self] event in
            self?.handleTerminalKey(event) ?? false
        }
        output.onTerminalText = { [weak self] text in
            guard let self, self.directMode else { return }
            self.controller.sendLiteral(text, into: self.pane)
            self.refresh()
        }
        output.onTerminalCommand = { [weak self] key in
            guard let self, self.directMode else { return }
            self.controller.sendKey(key, into: self.pane)
            self.refresh()
        }
        scroll.documentView = output
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false

        // Chat input bar — always docked at the bottom, so every pane (including
        // the two bottom ones) has a reachable, obvious place to type.
        inputBar.wantsLayer = true
        inputBar.layer?.cornerRadius = 8
        inputBar.layer?.borderWidth = 1
        inputBar.layer?.borderColor = TerminalTheme.inactive.cgColor
        inputBar.layer?.backgroundColor = NSColor.white.cgColor
        inputBar.translatesAutoresizingMaskIntoConstraints = false

        input.drawsBackground = false
        input.isRichText = false
        input.font = monoFont
        input.textColor = TerminalTheme.text
        input.insertionPointColor = TerminalTheme.active
        input.textContainerInset = NSSize(width: 4, height: 5)
        input.delegate = self
        input.onSubmit = { [weak self] text in self?.submit(text) }
        input.onFocusChange = { [weak self] focused in self?.updateInputChrome(focused: focused) }
        inputScroll.documentView = input
        inputScroll.drawsBackground = false
        inputScroll.hasVerticalScroller = false
        inputScroll.borderType = .noBorder
        inputScroll.translatesAutoresizingMaskIntoConstraints = false

        placeholder.stringValue = chatPlaceholder
        placeholder.font = monoFont
        placeholder.textColor = TerminalTheme.dimText
        placeholder.backgroundColor = .clear
        placeholder.translatesAutoresizingMaskIntoConstraints = false

        modeButton.title = "⌨"
        modeButton.isBordered = false
        modeButton.font = .systemFont(ofSize: 14)
        modeButton.contentTintColor = TerminalTheme.dimText
        modeButton.target = self
        modeButton.action = #selector(toggleMode)
        modeButton.toolTip = "Mode direct : frappe live dans le terminal (menus, flèches, esc)"
        modeButton.translatesAutoresizingMaskIntoConstraints = false

        // Permission-mode line lifted out of the terminal and shown under the
        // field; clicking it sends shift+tab to cycle the mode.
        permButton.isBordered = false
        permButton.alignment = .left
        permButton.title = ""
        permButton.isHidden = true
        permButton.target = self
        permButton.action = #selector(cyclePermission)
        permButton.toolTip = "Changer le mode de permission (envoie shift+tab)"
        permButton.translatesAutoresizingMaskIntoConstraints = false

        addSubview(title)
        addSubview(scroll)
        addSubview(inputBar)
        addSubview(permButton)
        inputBar.addSubview(inputScroll)
        inputBar.addSubview(placeholder)
        inputBar.addSubview(modeButton)

        permHeight = permButton.heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: topAnchor),
            title.leadingAnchor.constraint(equalTo: leadingAnchor),
            title.trailingAnchor.constraint(equalTo: trailingAnchor),
            title.heightAnchor.constraint(equalToConstant: 18),

            scroll.topAnchor.constraint(equalTo: title.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: inputBar.topAnchor, constant: -6),

            inputBar.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 7),
            inputBar.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -7),
            inputBar.bottomAnchor.constraint(equalTo: permButton.topAnchor, constant: -5),
            inputBar.heightAnchor.constraint(equalToConstant: 30),

            permButton.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 11),
            permButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -11),
            permButton.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
            permHeight,

            modeButton.trailingAnchor.constraint(equalTo: inputBar.trailingAnchor, constant: -6),
            modeButton.centerYAnchor.constraint(equalTo: inputBar.centerYAnchor),
            modeButton.widthAnchor.constraint(equalToConstant: 24),
            modeButton.heightAnchor.constraint(equalToConstant: 24),

            inputScroll.leadingAnchor.constraint(equalTo: inputBar.leadingAnchor, constant: 6),
            inputScroll.trailingAnchor.constraint(equalTo: modeButton.leadingAnchor, constant: -4),
            inputScroll.topAnchor.constraint(equalTo: inputBar.topAnchor),
            inputScroll.bottomAnchor.constraint(equalTo: inputBar.bottomAnchor),

            placeholder.leadingAnchor.constraint(equalTo: inputScroll.leadingAnchor, constant: 6),
            placeholder.centerYAnchor.constraint(equalTo: inputBar.centerYAnchor)
        ])
        refresh()
        setActive(false)
        updatePlaceholder()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func mouseDown(with event: NSEvent) {
        onFocus?(self)
        super.mouseDown(with: event)
    }

    func refresh() {
        let raw = controller.capture(pane)
        // Skip when the capture is unchanged: avoids re-parsing 420 lines on every
        // 1.2s tick and, crucially, avoids wiping an in-progress text selection.
        if raw == lastRaw { return }
        lastRaw = raw
        // Chat mode: crop the terminal's own input box and lift its permission
        // line under our field. Direct mode: show the raw terminal untouched.
        let (body, status) = directMode ? (raw, nil) : splitTerminalChrome(raw)
        setPermissionStatus(directMode ? nil : status)
        let attributed = ansiAttributed(body, font: monoFont, boldFont: monoBold, defaultFg: TerminalTheme.text, defaultBg: TerminalTheme.outputBackground)
        let atBottom = isScrolledToBottom()
        let previousSelection = output.selectedRange()
        output.textStorage?.setAttributedString(attributed)
        // Restore the selection so a background refresh never eats a copy in progress.
        let length = output.textStorage?.length ?? 0
        if previousSelection.length > 0, previousSelection.location + previousSelection.length <= length {
            output.setSelectedRange(previousSelection)
        }
        if atBottom { output.scrollToEndOfDocument(nil) }
    }

    private func isScrolledToBottom() -> Bool {
        guard let docView = scroll.documentView else { return true }
        let visible = scroll.contentView.bounds
        return visible.maxY >= docView.bounds.maxY - 4
    }

    func setActive(_ active: Bool) {
        isActive = active
        layer?.borderColor = (active ? TerminalTheme.active : TerminalTheme.inactive).cgColor
        layer?.borderWidth = active ? 2 : 1
        title.textColor = TerminalTheme.black
        title.stringValue = "  \(active ? "●" : "○")  \(pane.title.uppercased())  "
    }

    // MARK: Input (hybrid: chat field by default, live terminal on demand)

    func submit(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        input.string = ""
        updatePlaceholder()
        guard !trimmed.isEmpty else { return }
        controller.sendLiteral(text, into: pane)
        controller.sendKey("Enter", into: pane)
        refresh()
    }

    @objc func toggleMode() {
        setDirectMode(!directMode)
        onFocus?(self)
    }

    func setDirectMode(_ on: Bool) {
        directMode = on
        input.isEditable = !on
        inputBar.alphaValue = on ? 0.55 : 1.0
        modeButton.contentTintColor = on ? TerminalTheme.active : TerminalTheme.dimText
        placeholder.stringValue = on ? directPlaceholder : chatPlaceholder
        updatePlaceholder()
        updateInputChrome(focused: false)
        lastRaw = ""            // force a re-render so the crop toggles immediately
        refresh()
        window?.makeFirstResponder(on ? output : input)
        if on { output.scrollToEndOfDocument(nil) }
    }

    func focusInput() {
        window?.makeFirstResponder(directMode ? output : input)
    }

    func updateInputChrome(focused: Bool) {
        let highlight = focused && !directMode
        inputBar.layer?.borderColor = (highlight ? TerminalTheme.active : TerminalTheme.inactive).cgColor
        inputBar.layer?.borderWidth = highlight ? 2 : 1
    }

    func updatePlaceholder() {
        placeholder.isHidden = directMode ? false : !input.string.isEmpty
    }

    // Shows the permission-mode line under the field (collapsed to 0 height when
    // there is none, e.g. a provider without that concept).
    func setPermissionStatus(_ status: String?) {
        if let s = status, !s.isEmpty {
            permButton.attributedTitle = NSAttributedString(string: s, attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular),
                .foregroundColor: color256(212)
            ])
            permButton.isHidden = false
            permHeight.constant = 15
        } else {
            permButton.title = ""
            permButton.isHidden = true
            permHeight.constant = 0
        }
    }

    @objc func cyclePermission() {
        controller.sendKey("BTab", into: pane)
        onFocus?(self)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.refresh() }
    }

    func textDidChange(_ notification: Notification) {
        updatePlaceholder()
    }

    func pasteFromClipboard() {
        guard let text = NSPasteboard.general.string(forType: .string) else { return }
        if directMode {
            controller.paste(text, into: pane)
            refresh()
        } else {
            input.insertText(text, replacementRange: input.selectedRange())
            updatePlaceholder()
        }
    }

    func selectedOutputText() -> String {
        let range = output.selectedRange()
        guard range.length > 0, let swiftRange = Range(range, in: output.string) else { return "" }
        return String(output.string[swiftRange])
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        onFocus?(self)
        return .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let items = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self]) as? [URL], !items.isEmpty else {
            return false
        }
        let payload = items.map { $0.path }.joined(separator: " ")
        if directMode {
            controller.paste(payload, into: pane)
            refresh()
        } else {
            input.insertText(payload + " ", replacementRange: input.selectedRange())
            updatePlaceholder()
            window?.makeFirstResponder(input)
        }
        return true
    }

    // Only forwards live keystrokes while in direct mode; in chat mode the input
    // field owns the keyboard.
    func handleTerminalKey(_ event: NSEvent) -> Bool {
        guard directMode else { return false }
        switch event.keyCode {
        case 36: controller.sendKey("Enter", into: pane)
        case 51: controller.sendKey("BSpace", into: pane)
        case 48: controller.sendKey("Tab", into: pane)
        case 53: controller.sendKey("Escape", into: pane)
        case 123: controller.sendKey("Left", into: pane)
        case 124: controller.sendKey("Right", into: pane)
        case 125: controller.sendKey("Down", into: pane)
        case 126: controller.sendKey("Up", into: pane)
        default:
            guard let text = event.characters, !text.isEmpty else { return false }
            controller.sendLiteral(text, into: pane)
        }
        refresh()
        return true
    }
}

// MARK: - Native sidebar (mirrors sidebar_view)

final class SidebarView: NSView {
    var data: SidebarData?
    var onRoute: ((Int, NSPoint) -> Void)?
    var onSync: (() -> Void)?
    var onReset: (() -> Void)?

    private var agentRects: [(index: Int, rect: NSRect)] = []
    private var syncRect: NSRect = .zero
    private var resetRect: NSRect = .zero

    private let font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    private let boldFont = NSFont.monospacedSystemFont(ofSize: 12, weight: .bold)
    private let lineHeight: CGFloat = 17

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    func update(_ newData: SidebarData) {
        data = newData
        needsDisplay = true
    }

    private func cellWidth() -> CGFloat {
        ("█" as NSString).size(withAttributes: [.font: font]).width
    }

    override func draw(_ dirtyRect: NSRect) {
        TerminalTheme.sidebarBackground.setFill()
        bounds.fill()
        agentRects = []

        let w = bounds.width
        var y: CGFloat = 0

        func band(_ color: NSColor, height: CGFloat = 17) {
            color.setFill()
            NSRect(x: 0, y: y, width: w, height: height).fill()
        }
        func text(_ string: String, _ color: NSColor, _ f: NSFont, x: CGFloat = 10) {
            (string as NSString).draw(at: NSPoint(x: x, y: y + 1), withAttributes: [.font: f, .foregroundColor: color])
        }
        func newline(_ count: CGFloat = 1) { y += lineHeight * count }

        guard let data else {
            text("  PANESHIFT · CONTROL ROOM", TerminalTheme.dimText, boldFont)
            newline(2)
            text("  connecting to tmux...", TerminalTheme.dimText, font)
            return
        }

        // Header
        band(color256(223))
        text("  PANESHIFT · CONTROL ROOM", TerminalTheme.black, boldFont)
        newline(2)

        // Routing
        text("  ROUTING · click to change", TerminalTheme.text, boldFont)
        newline()
        for agent in data.agents {
            let start = y
            band(color256(agent.color))
            let namePadded = agent.name.count > 12 ? agent.name : agent.name.padding(toLength: 12, withPad: " ", startingAt: 0)
            text("  \(agent.index) \(namePadded) \(agent.provider.uppercased()) ▾", TerminalTheme.black, boldFont)
            newline()
            text("    \(agent.model)", TerminalTheme.dimText, font)
            newline()
            agentRects.append((agent.index, NSRect(x: 0, y: start, width: w, height: y - start)))
        }
        newline()

        // Session
        text("  SESSION", TerminalTheme.text, boldFont)
        newline()
        band(color256(31))
        text("  \(data.momentum)", TerminalTheme.white, boldFont)
        newline()
        text("  Now \(data.elapsed) · longest \(data.longest)", TerminalTheme.text, font)
        newline()
        text("  \(data.sessions) sessions · \(data.streak)-day streak", TerminalTheme.text, font)
        newline(2)

        // System
        text("  SYSTEM", TerminalTheme.text, boldFont)
        newline()
        text("  CPU \(data.cpu) · RAM \(data.ram) · GPU \(data.gpu)", TerminalTheme.text, font)
        newline()
        text("  TOKENS \(data.tokens) · local logs", TerminalTheme.text, font)
        newline()
        text("  OVH \(data.ovh) · ce mois", TerminalTheme.text, font)
        newline(2)

        // Memory
        text("  MEMORY", TerminalTheme.text, boldFont)
        newline()
        text("  \(data.live)/\(data.total) live · \(data.handoffs)/\(data.total) handoffs", TerminalTheme.text, font)
        newline()
        text("  \(data.runs) runs · \(data.claims) claims · \(data.conflicts) conflicts", TerminalTheme.text, font)
        newline()
        text("  last sync \(data.sync)", TerminalTheme.text, font)
        newline()
        syncRect = NSRect(x: 0, y: y, width: w, height: lineHeight)
        band(color256(117))
        text("  SYNC MEMORY", TerminalTheme.black, boldFont)
        newline(2)
        resetRect = NSRect(x: 0, y: y, width: w, height: lineHeight)
        band(color256(250))
        text("  RESET LAYOUT", TerminalTheme.black, boldFont)
        newline(2)

        // Calendar
        text("  CODE SESSIONS · 12 WEEKS", TerminalTheme.text, boldFont)
        newline()
        let labels = ["M", "T", "W", "T", "F", "S", "S"]
        let cw = cellWidth()
        for (rowIndex, row) in data.grid.enumerated() {
            let label = rowIndex < labels.count ? labels[rowIndex] : " "
            text("  \(label) ", TerminalTheme.dimText, font)
            var cx: CGFloat = 10 + ("  X " as NSString).size(withAttributes: [.font: font]).width
            for ch in row {
                let (glyph, color) = cell(ch)
                if glyph != " " {
                    (String(glyph) as NSString).draw(at: NSPoint(x: cx, y: y + 1), withAttributes: [.font: font, .foregroundColor: color])
                }
                cx += cw
            }
            newline()
        }
        text("  ░ session · ▒▓█ token volume", TerminalTheme.dimText, font)
        newline(2)
        text("  Ctrl+/ · room actions", TerminalTheme.dimText, font)
    }

    private func cell(_ ch: Character) -> (Character, NSColor) {
        switch ch {
        case "4": return ("█", color256(34))
        case "3": return ("▓", color256(35))
        case "2": return ("▒", color256(36))
        case "1": return ("░", color256(37))
        case "0": return ("░", color256(151))
        case ".": return ("·", color256(245))
        default: return (" ", TerminalTheme.dimText)
        }
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        for entry in agentRects where entry.rect.contains(point) {
            onRoute?(entry.index, point)
            return
        }
        if syncRect.contains(point) { onSync?(); return }
        if resetRect.contains(point) { onReset?(); return }
    }
}

// MARK: - Window

final class MainWindow: NSWindow {
    var onNextPane: (() -> Void)?
    var onPreviousPane: (() -> Void)?
    var onPaste: (() -> Void)?
    var onCopy: (() -> Void)?
    var onTerminalKey: ((NSEvent) -> Bool)?

    override func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if modifiers.contains([.command, .shift]), event.keyCode == 124 { onNextPane?(); return }
        if modifiers.contains([.command, .shift]), event.keyCode == 123 { onPreviousPane?(); return }
        if modifiers.contains(.command), event.charactersIgnoringModifiers == "v" { onPaste?(); return }
        if modifiers.contains(.command), event.charactersIgnoringModifiers == "c" { onCopy?(); return }
        if onTerminalKey?(event) == true { return }
        super.keyDown(with: event)
    }
}

// MARK: - Route menu choice

final class RouteChoice: NSObject {
    let index: Int
    let provider: String
    let model: String
    init(index: Int, provider: String, model: String) {
        self.index = index
        self.provider = provider
        self.model = model
    }
}

// MARK: - App delegate

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let controller: TmuxController
    var window: MainWindow?
    var paneViews: [PaneView] = []
    let sidebar = SidebarView()
    var activeIndex = 0
    var paneTimer: Timer?
    var sidebarTimer: Timer?
    var resizeWorkItem: DispatchWorkItem?
    var latestData: SidebarData?

    init(session: String) {
        controller = TmuxController(session: session)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        controller.roomScript = controller.optionValue("@agent_room_script")
        controller.roomConfig = controller.optionValue("@agent_room_config")

        let panes = controller.panes()
        guard panes.count >= 4 else {
            showError("PaneShift could not find four panes in tmux session '\(controller.session):agents'.")
            return
        }

        let content = NSView()
        content.wantsLayer = true
        content.layer?.backgroundColor = TerminalTheme.appBackground.cgColor

        let grid = NSView()
        grid.translatesAutoresizingMaskIntoConstraints = false

        paneViews = panes.prefix(4).map { pane in
            let view = PaneView(pane: pane, controller: controller)
            view.translatesAutoresizingMaskIntoConstraints = false
            view.onFocus = { [weak self] paneView in self?.activate(paneView) }
            return view
        }
        paneViews.forEach { grid.addSubview($0) }

        sidebar.translatesAutoresizingMaskIntoConstraints = false
        sidebar.wantsLayer = true
        sidebar.onRoute = { [weak self] index, point in self?.showRouteMenu(index: index, at: point) }
        sidebar.onSync = { [weak self] in self?.runRoomAsync(["memory-refresh", "manual", "0"]) }
        sidebar.onReset = { [weak self] in self?.runRoomAsync(["reset-layout"]) }

        content.addSubview(grid)
        content.addSubview(sidebar)
        NSLayoutConstraint.activate([
            grid.topAnchor.constraint(equalTo: content.topAnchor, constant: 8),
            grid.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 8),
            grid.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -8),
            grid.trailingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: -2),
            sidebar.topAnchor.constraint(equalTo: content.topAnchor, constant: 8),
            sidebar.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -8),
            sidebar.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -8),
            sidebar.widthAnchor.constraint(equalToConstant: 268),

            paneViews[0].topAnchor.constraint(equalTo: grid.topAnchor),
            paneViews[0].leadingAnchor.constraint(equalTo: grid.leadingAnchor),
            paneViews[0].trailingAnchor.constraint(equalTo: paneViews[1].leadingAnchor, constant: -2),
            paneViews[0].bottomAnchor.constraint(equalTo: paneViews[2].topAnchor, constant: -2),

            paneViews[1].topAnchor.constraint(equalTo: grid.topAnchor),
            paneViews[1].trailingAnchor.constraint(equalTo: grid.trailingAnchor),
            paneViews[1].bottomAnchor.constraint(equalTo: paneViews[3].topAnchor, constant: -2),
            paneViews[1].widthAnchor.constraint(equalTo: paneViews[0].widthAnchor),

            paneViews[2].leadingAnchor.constraint(equalTo: grid.leadingAnchor),
            paneViews[2].bottomAnchor.constraint(equalTo: grid.bottomAnchor),
            paneViews[2].trailingAnchor.constraint(equalTo: paneViews[3].leadingAnchor, constant: -2),
            paneViews[2].heightAnchor.constraint(equalTo: paneViews[0].heightAnchor),

            paneViews[3].trailingAnchor.constraint(equalTo: grid.trailingAnchor),
            paneViews[3].bottomAnchor.constraint(equalTo: grid.bottomAnchor),
            paneViews[3].widthAnchor.constraint(equalTo: paneViews[2].widthAnchor),
            paneViews[3].heightAnchor.constraint(equalTo: paneViews[1].heightAnchor)
        ])

        let window = MainWindow(
            contentRect: NSRect(x: 60, y: 60, width: 1620, height: 940),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "PaneShift Native Prototype"
        window.contentView = content
        window.onNextPane = { [weak self] in self?.moveFocus(delta: 1) }
        window.onPreviousPane = { [weak self] in self?.moveFocus(delta: -1) }
        window.onPaste = { [weak self] in self?.pasteClipboard() }
        window.onCopy = { [weak self] in self?.copySelection() }
        window.onTerminalKey = { [weak self] event in
            guard let self, self.paneViews.indices.contains(self.activeIndex) else { return false }
            return self.paneViews[self.activeIndex].handleTerminalKey(event)
        }
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
        activate(paneViews[0])
        scheduleTmuxResize()

        paneTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.paneViews.forEach { $0.refresh() } }
        }
        sidebarTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshSidebar() }
        }
        refreshSidebar()
    }

    func scheduleTmuxResize() {
        resizeWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            Task { @MainActor in self?.syncTmuxSizeToNativeWindow() }
        }
        resizeWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: item)
    }

    func syncTmuxSizeToNativeWindow() {
        guard paneViews.count >= 4 else { return }
        paneViews[0].layoutSubtreeIfNeeded()
        sidebar.layoutSubtreeIfNeeded()

        let charWidth = max(1, ("W" as NSString).size(withAttributes: [.font: paneViews[0].monoFont]).width)
        let lineHeight = max(1, paneViews[0].output.layoutManager?.defaultLineHeight(for: paneViews[0].monoFont) ?? 14)
        let contentSize = paneViews[0].scroll.contentView.bounds.size

        let paneColumns = max(24, Int(contentSize.width / charWidth))
        let paneRows = max(8, Int(contentSize.height / lineHeight))
        let sidebarColumns = max(20, Int(sidebar.bounds.width / charWidth))
        let totalColumns = paneColumns * 2 + sidebarColumns + 4
        let totalRows = paneRows * 2 + 3

        paneViews.forEach { $0.output.textContainer?.widthTracksTextView = true }
        controller.resizeWindow(columns: totalColumns, rows: totalRows)
        paneViews.forEach { $0.refresh() }
    }

    func refreshSidebar() {
        guard let script = controller.roomScript, let config = controller.roomConfig else { return }
        let session = controller.session
        Task.detached(priority: .userInitiated) {
            guard let raw = shellCapture(script, ["--config", config, "--session", session, "sidebar-data"]),
                  let data = SidebarData(raw: raw) else { return }
            await MainActor.run {
                self.latestData = data
                self.sidebar.update(data)
            }
        }
    }

    func runRoomAsync(_ arguments: [String]) {
        guard let script = controller.roomScript, let config = controller.roomConfig else { return }
        let session = controller.session
        Task.detached(priority: .userInitiated) {
            _ = shellCapture(script, ["--config", config, "--session", session] + arguments)
            await MainActor.run { self.refreshSidebar() }
        }
    }

    func showRouteMenu(index: Int, at point: NSPoint) {
        guard let agent = latestData?.agents.first(where: { $0.index == index }) else { return }
        let menu = NSMenu(title: "Route \(agent.name)")

        func providerItem(_ label: String, _ provider: String, _ models: [String]) {
            let submenu = NSMenu(title: label)
            for model in ["default"] + models {
                let item = NSMenuItem(title: model, action: #selector(routeSelected(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = RouteChoice(index: index, provider: provider, model: model)
                if agent.provider == provider && agent.model == model {
                    item.state = .on
                }
                submenu.addItem(item)
            }
            let parent = NSMenuItem(title: label, action: nil, keyEquivalent: "")
            parent.submenu = submenu
            if agent.provider == provider { parent.state = .on }
            menu.addItem(parent)
        }

        providerItem("ANTHROPIC · Claude Code", "anthropic", agent.anthropicModels)
        providerItem("OPENAI · Codex", "openai", agent.openaiModels)
        providerItem("LOCAL · configured CLI", "local", [])

        menu.popUp(positioning: nil, at: point, in: sidebar)
    }

    @objc func routeSelected(_ sender: NSMenuItem) {
        guard let choice = sender.representedObject as? RouteChoice else { return }
        let providerLabel = choice.provider.uppercased()
        let alert = NSAlert()
        alert.messageText = "Start a fresh \(providerLabel) session?"
        alert.informativeText = "This closes the current chat in this terminal and starts \(providerLabel) with model \(choice.model)."
        alert.addButton(withTitle: "Start")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        runRoomAsync(["switch", "\(choice.index)", choice.provider, choice.model])
    }

    func activate(_ paneView: PaneView) {
        guard let index = paneViews.firstIndex(of: paneView) else { return }
        activeIndex = index
        paneViews.enumerated().forEach { offset, view in view.setActive(offset == index) }
        controller.focus(paneView.pane)
        paneView.focusInput()
    }

    func moveFocus(delta: Int) {
        guard !paneViews.isEmpty else { return }
        let next = (activeIndex + delta + paneViews.count) % paneViews.count
        activate(paneViews[next])
    }

    func pasteClipboard() {
        guard paneViews.indices.contains(activeIndex) else { return }
        paneViews[activeIndex].pasteFromClipboard()
    }

    func copySelection() {
        guard paneViews.indices.contains(activeIndex) else { return }
        let selected = paneViews[activeIndex].selectedOutputText()
        guard !selected.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(selected, forType: .string)
    }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "PaneShift"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
}

extension AppDelegate: NSWindowDelegate {
    func windowDidResize(_ notification: Notification) {
        scheduleTmuxResize()
    }
}

// MARK: - Entry point

func argumentValue(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), args.indices.contains(index + 1) else { return nil }
    return args[index + 1]
}

// Fall back to whichever live tmux session owns an `agents` window rather than a
// hardcoded name, so a direct launch finds the room whatever it is called
// ("bb", "agent-room", "my-agents"…). "agent-room" matches the engine default.
func detectAgentSession() -> String {
    guard let listing = shellCapture("/usr/bin/env", ["tmux", "list-windows", "-a", "-F", "#{session_name}:#{window_name}"]) else {
        return "agent-room"
    }
    for line in listing.split(separator: "\n") where line.hasSuffix(":agents") {
        return String(line.dropLast(":agents".count))
    }
    return "agent-room"
}

let session = argumentValue("--session") ?? ProcessInfo.processInfo.environment["ROOM_SESSION"] ?? detectAgentSession()
if CommandLine.arguments.contains("--check") {
    let controller = TmuxController(session: session)
    let panes = controller.panes()
    guard panes.count >= 4 else {
        fputs("PaneShiftApp: expected four panes in \(session):agents, found \(panes.count)\n", stderr)
        exit(1)
    }
    print(panes.prefix(4).map { "\($0.index):\($0.identifier)" }.joined(separator: " "))
    exit(0)
}
let app = NSApplication.shared
let delegate = AppDelegate(session: session)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()

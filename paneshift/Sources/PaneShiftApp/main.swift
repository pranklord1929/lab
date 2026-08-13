import AppKit
import Foundation
import PaneShiftCore

// MARK: - Theme

struct Pane: Sendable, Equatable {
    let index: Int
    let identifier: String
    let title: String
    /// Provider and working directory are the join key to the CLI's own session
    /// transcript, which is where CHAT reads its content from.
    let provider: Provider?
    let workingDirectory: String
    /// Deliberately stopped by the operator. Distinct from a crashed CLI: the
    /// UI must not report a decision as a failure.
    let isPaused: Bool
}

enum TerminalTheme {
    static let appBackground = NSColor(calibratedWhite: 0.945, alpha: 1.0)
    static let paneBackground = NSColor.white
    static let outputBackground = NSColor.white
    static let paneHeader = NSColor(calibratedWhite: 0.975, alpha: 1.0)
    static let paneHeaderActive = NSColor(calibratedWhite: 0.93, alpha: 1.0)
    static let inputBackground = NSColor(calibratedWhite: 0.985, alpha: 1.0)
    static let text = NSColor(calibratedWhite: 0.075, alpha: 1.0)
    static let dimText = NSColor(calibratedWhite: 0.46, alpha: 1.0)
    static let active = NSColor(calibratedWhite: 0.06, alpha: 1.0)
    static let inactive = NSColor(calibratedWhite: 0.82, alpha: 1.0)
    static let sidebarBackground = NSColor(calibratedWhite: 0.065, alpha: 1.0)
    static let sidebarText = NSColor(calibratedWhite: 0.94, alpha: 1.0)
    static let sidebarDim = NSColor(calibratedWhite: 0.58, alpha: 1.0)
    static let sidebarRow = NSColor(calibratedWhite: 0.115, alpha: 1.0)
    static let sidebarRule = NSColor(calibratedWhite: 0.20, alpha: 1.0)
    static let black = NSColor.black
    static let white = NSColor.white

    // Warm tones carried over from the tmux Control Room's "red sands" palette,
    // so the native window reads as the same product rather than a grey shell.
    /// `48;5;223` — the peach the tmux header band uses.
    static let sand = NSColor(calibratedRed: 1.0, green: 0.87, blue: 0.76, alpha: 1.0)
    /// `#DFBD22`, the room's bold accent.
    static let gold = NSColor(calibratedRed: 0.87, green: 0.74, blue: 0.13, alpha: 1.0)
    /// Readable on the dark sidebar, unlike systemRed.
    static let alert = NSColor(calibratedRed: 1.0, green: 0.45, blue: 0.40, alpha: 1.0)
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

func compactWhitespace(_ value: String) -> String {
    value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}

// The real terminal is still the authority on one thing only: whether the
// provider is actively working. Everything the operator reads now comes from
// the provider's own structured transcript.
func terminalIsBusy(_ raw: String) -> Bool {
    let tail = raw.components(separatedBy: "\n").suffix(24).map {
        stripANSI($0).lowercased()
    }
    return tail.contains { line in
        line.contains("esc to interrupt") || line.contains("ctrl+c to stop") ||
            line.contains("esc to cancel")
    }
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

struct ShellResult: Sendable {
    let output: String
    let status: Int32
    var succeeded: Bool { status == 0 }
}

func shellRun(_ launchPath: String, _ arguments: [String]) -> ShellResult? {
    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: launchPath)
    process.arguments = arguments
    process.environment = augmentedEnvironment()
    process.standardOutput = output
    process.standardError = output
    do { try process.run() } catch { return nil }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return ShellResult(output: String(data: data, encoding: .utf8) ?? "", status: process.terminationStatus)
}

func shellCapture(_ launchPath: String, _ arguments: [String]) -> String? {
    guard let result = shellRun(launchPath, arguments), result.succeeded else { return nil }
    return result.output
}

func shellQuote(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
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
    let grokModels: [String]
    let anthropicAvailable: Bool
    let openaiAvailable: Bool
    let grokAvailable: Bool
    let localAvailable: Bool
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
                    openaiModels: f.count > 7 ? models(f[7]) : [],
                    grokModels: f.count > 8 ? models(f[8]) : [],
                    anthropicAvailable: f.count <= 9 || f[9] == "1",
                    openaiAvailable: f.count <= 10 || f[10] == "1",
                    grokAvailable: f.count > 11 && f[11] == "1",
                    localAvailable: f.count > 12 && f[12] == "1"
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

// Configuration is completed synchronously during app launch; background tasks
// only invoke its process helpers afterwards, so concurrent mutation is absent.
final class TmuxController: @unchecked Sendable {
    let session: String
    let sshHost: String?
    var roomScript: String?
    var roomConfig: String?

    init(session: String, sshHost: String? = nil) {
        self.session = session
        self.sshHost = sshHost
    }

    @discardableResult
    func tmux(_ arguments: [String], input: String? = nil) -> String? {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        if let sshHost {
            let command = (["tmux"] + arguments).map(shellQuote).joined(separator: " ")
            process.arguments = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6",
                "-o", "ControlMaster=auto", "-o", "ControlPath=\(NSHomeDirectory())/.ssh/cm-paneshift-%C",
                "-o", "ControlPersist=60", sshHost, command]
        } else {
            process.arguments = ["tmux"] + arguments
        }
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

    func agentCount() -> Int {
        Int(optionValue("@agent_count") ?? "") ?? panes().count
    }

    func panes() -> [Pane] {
        guard let output = tmux(["list-panes", "-t", "\(session):agents", "-F", "#{@agent_index}|#{pane_id}|#{@agent_name}|#{@agent_provider}|#{@agent_model}|#{pane_current_path}|#{@agent_paused}"]) else {
            return []
        }
        return output.split(separator: "\n").compactMap { line in
            let fields = line.split(separator: "|", omittingEmptySubsequences: false)
            guard fields.count >= 6, let index = Int(fields[0]) else { return nil }
            let name = fields[2].isEmpty ? "Terminal \(index)" : String(fields[2])
            let providerName = String(fields[3])
            let label = providerName.isEmpty ? "" : providerName.uppercased()
            let model = fields[4].isEmpty ? "default" : String(fields[4])
            let suffix = label.isEmpty ? "" : " · \(label) / \(model)"
            return Pane(
                index: index,
                identifier: String(fields[1]),
                title: "\(name)\(suffix)",
                provider: Provider(roomValue: providerName),
                workingDirectory: String(fields[5]),
                isPaused: fields.count > 6 && fields[6] == "1")
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
        // Named buffer, deleted on paste: the shared default buffer let two panes
        // (or two clients) overwrite each other's clipboard mid-paste.
        let buffer = "paneshift-paste-\(UUID().uuidString.prefix(8).lowercased())"
        guard tmux(["load-buffer", "-b", buffer, "-"], input: text) != nil else { return }
        _ = tmux(["paste-buffer", "-d", "-b", buffer, "-t", pane.identifier])
    }

    func sendLiteral(_ text: String, into pane: Pane) {
        guard !text.isEmpty else { return }
        _ = tmux(["send-keys", "-l", "-t", pane.identifier, text])
    }

    func sendKey(_ key: String, into pane: Pane) {
        _ = tmux(["send-keys", "-t", pane.identifier, key])
    }

    private func terminalHasDraft(_ pane: Pane) -> Bool {
        guard let raw = tmux(["capture-pane", "-p", "-S", "-40", "-t", pane.identifier]) else { return false }
        let lines = raw.components(separatedBy: "\n").suffix(40).map {
            $0.trimmingCharacters(in: .whitespaces)
        }
        if lines.contains(where: { $0.lowercased().contains("esc to interrupt") }) { return false }
        for line in lines.reversed() where !line.isEmpty {
            if let marker = line.firstIndex(where: { $0 == "›" || $0 == "❯" }) {
                var payload = compactWhitespace(String(line[line.index(after: marker)...]))
                payload = payload.trimmingCharacters(in: CharacterSet(charactersIn: "│ "))
                if payload.isEmpty || payload.lowercased().hasPrefix("implement ") { return false }
                return true
            }
        }
        return false
    }

    /// Shells a pane falls back to once its provider CLI exits.
    static let shellCommands: Set<String> = [
        "zsh", "-zsh", "bash", "-bash", "sh", "-sh", "fish", "-fish", "login", "tmux"
    ]

    func currentCommand(_ pane: Pane) -> String {
        tmux(["display-message", "-p", "-t", pane.identifier, "#{pane_current_command}"])?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    /// True when the pane still runs an agent rather than an abandoned shell.
    ///
    /// A shell in the foreground is not proof of death: a provider can be started
    /// through a wrapper script, which reports as `bash`. Only a shell with no
    /// child process at all is really an exited agent — exactly what a pane looks
    /// like after its CLI quits.
    func agentProcessIsAlive(_ pane: Pane) -> Bool {
        guard Self.shellCommands.contains(currentCommand(pane)) else { return true }
        guard let pid = tmux(["display-message", "-p", "-t", pane.identifier, "#{pane_pid}"])?
            .trimmingCharacters(in: .whitespacesAndNewlines), !pid.isEmpty else { return true }
        guard let children = shellRun("/usr/bin/env", ["pgrep", "-P", pid]) else { return true }
        return !children.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    enum SendOutcome {
        case sent
        /// The CLI exited and left a shell. Pasting here would hand the prompt to
        /// zsh, which runs it as a command line — observed live on CODEX-2 after
        /// Codex quit on a usage limit ("zsh: command not found: Réponds").
        case agentExited
        case tmuxFailed
    }

    /// Hands a prompt to the real CLI. Never call this from the main thread.
    ///
    /// A `true` result only means tmux accepted the keystrokes. Whether the
    /// provider actually took the prompt is confirmed separately, by watching it
    /// appear in that provider's own transcript, which is what makes a silent
    /// draft stuck in the composer detectable instead of invisible.
    @discardableResult
    func sendLine(_ text: String, into pane: Pane) -> SendOutcome {
        guard !text.isEmpty else { return .tmuxFailed }
        // Hard guard, checked at send time rather than from a 5 s poll: a prompt
        // must never reach a bare shell, which would execute it.
        guard agentProcessIsAlive(pane) else { return .agentExited }
        // A named buffer keeps two panes (or two clients) from overwriting each
        // other's prompt through the shared default buffer.
        let buffer = "paneshift-\(UUID().uuidString.prefix(8).lowercased())"
        // Full-screen TUIs process bracketed paste asynchronously. Clear only a
        // detected stale draft, then leave a short beat after paste before Enter;
        // queueing both together can turn Enter into a newline inside the draft.
        if terminalHasDraft(pane) {
            guard tmux(["send-keys", "-t", pane.identifier, "C-c"]) != nil else { return .tmuxFailed }
            Thread.sleep(forTimeInterval: 0.08)
        }
        guard tmux(["load-buffer", "-b", buffer, "-"], input: text) != nil else { return .tmuxFailed }
        guard tmux(["paste-buffer", "-d", "-b", buffer, "-t", pane.identifier]) != nil else {
            _ = tmux(["delete-buffer", "-b", buffer])
            return .tmuxFailed
        }
        // Grok (and sometimes Codex) finishes applying bracketed paste after the
        // old 120 ms beat. Submitting too early leaves the prompt sitting in the
        // composer with "Enter:send" — CHAT then times out with an empty answer.
        Thread.sleep(forTimeInterval: 0.22)
        // The CLI can die between the first check and here — Codex prints its
        // banner then quits on a usage limit. Pasted text is inert; only Enter
        // would hand it to the shell as a command line. So re-check, and discard
        // the line instead of submitting it if the agent is gone.
        guard agentProcessIsAlive(pane) else {
            _ = tmux(["send-keys", "-t", pane.identifier, "C-u"])
            _ = tmux(["send-keys", "-t", pane.identifier, "C-c"])
            return .agentExited
        }
        guard tmux(["send-keys", "-t", pane.identifier, "Enter"]) != nil else { return .tmuxFailed }
        // Second Enter only when the TUI still shows our text as an unsent draft.
        Thread.sleep(forTimeInterval: 0.12)
        if composerStillHolds(text, in: pane) {
            _ = tmux(["send-keys", "-t", pane.identifier, "Enter"])
        }
        return .sent
    }

    /// True when the live screen still shows `text` next to a prompt marker and
    /// the footer is waiting for Enter — the classic "paste landed, submit did not".
    private func composerStillHolds(_ text: String, in pane: Pane) -> Bool {
        guard let raw = tmux(["capture-pane", "-p", "-S", "-30", "-t", pane.identifier]) else {
            return false
        }
        let lines = raw.components(separatedBy: "\n").suffix(24).map {
            stripANSI($0).trimmingCharacters(in: .whitespaces)
        }
        let needle = compactWhitespace(text)
        guard !needle.isEmpty else { return false }
        let hasDraft = lines.contains { line in
            guard let marker = line.firstIndex(where: { $0 == "›" || $0 == "❯" }) else { return false }
            let payload = compactWhitespace(String(line[line.index(after: marker)...]))
            return payload == needle || payload.hasPrefix(needle)
        }
        let wantsEnter = lines.contains {
            let lower = $0.lowercased()
            return lower.contains("enter:send") || lower.contains("enter to send")
        }
        return hasDraft && wantsEnter
    }

    /// Interrupts whatever the provider is doing, for the CHAT Stop button.
    func interrupt(_ pane: Pane) {
        // Escape alone is ignored by several TUIs once a tool is running; Ctrl+C
        // is the universal "stop" most CLIs bind, with Escape as a soft cancel.
        _ = tmux(["send-keys", "-t", pane.identifier, "Escape"])
        _ = tmux(["send-keys", "-t", pane.identifier, "C-c"])
    }

    func resizeWindow(columns: Int, rows: Int) {
        guard columns > 0, rows > 0 else { return }
        _ = tmux(["set-window-option", "-t", "\(session):agents", "window-size", "manual"])
        _ = tmux(["resize-window", "-t", "\(session):agents", "-x", "\(columns)", "-y", "\(rows)"])
    }

    func room(_ arguments: [String]) -> String? {
        guard let result = roomResult(arguments), result.succeeded else { return nil }
        return result.output
    }

    func roomResult(_ arguments: [String]) -> ShellResult? {
        guard let script = roomScript, let config = roomConfig else { return nil }
        let command = [script, "--config", config, "--session", session] + arguments
        if let sshHost {
            return shellRun("/usr/bin/env", ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6",
                "-o", "ControlMaster=auto", "-o", "ControlPath=\(NSHomeDirectory())/.ssh/cm-paneshift-%C",
                "-o", "ControlPersist=60", sshHost, command.map(shellQuote).joined(separator: " ")])
        }
        return shellRun(script, ["--config", config, "--session", session] + arguments)
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
    var pane: Pane
    let controller: TmuxController
    /// Reads this agent's real conversation from the provider's own session log.
    let session: TranscriptSession
    let title = NSTextField(labelWithString: "")
    let output = TerminalTextView()
    let scroll = NSScrollView()
    let inputBar = NSView()
    let input = InputTextView()
    let inputScroll = NSScrollView()
    let placeholder = NSTextField(labelWithString: "")
    let modeButton = NSButton()
    let actionButton = NSButton()
    let loadingIndicator = NSProgressIndicator()
    private var inputHeight: NSLayoutConstraint!
    private var scrollBottomChat: NSLayoutConstraint!
    private var scrollBottomTerminal: NSLayoutConstraint!
    let monoFont = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    let monoBold = NSFont.monospacedSystemFont(ofSize: 12, weight: .bold)
    var isActive = false
    var directMode = false
    var onFocus: ((PaneView) -> Void)?
    private var lastRaw = ""
    private var followsLatestOutput = true
    private var isApplyingRefresh = false
    private var renderedSignature = ""
    /// Last prompt handed to tmux, so Retry can resend it verbatim.
    private var lastSubmittedPrompt: String?
    /// xterm colour this role already has in the tmux room; used for the header
    /// dot and the chat prompt marker so both surfaces agree on identity.
    var accent = TerminalTheme.dimText {
        didSet {
            guard accent != oldValue else { return }
            setActive(isActive)
            renderedSignature = ""
            syncChatState()
        }
    }

    private let chatPlaceholder = "Message this agent…"

    init(pane: Pane, controller: TmuxController) {
        self.pane = pane
        self.controller = controller
        self.session = TranscriptSession(
            provider: pane.provider,
            workingDirectory: pane.workingDirectory)
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 7
        layer?.masksToBounds = true
        layer?.borderWidth = 1
        layer?.backgroundColor = TerminalTheme.paneBackground.cgColor
        registerForDraggedTypes([.fileURL])

        title.font = .monospacedSystemFont(ofSize: 11, weight: .medium)
        title.textColor = TerminalTheme.black
        title.backgroundColor = TerminalTheme.paneHeader
        title.drawsBackground = true
        title.lineBreakMode = .byTruncatingTail
        title.maximumNumberOfLines = 1
        title.translatesAutoresizingMaskIntoConstraints = false

        output.isEditable = false
        output.isSelectable = true
        output.font = monoFont
        output.textColor = TerminalTheme.text
        output.insertionPointColor = TerminalTheme.active
        output.backgroundColor = TerminalTheme.outputBackground
        output.selectedTextAttributes = [
            .backgroundColor: TerminalTheme.active.withAlphaComponent(0.14),
            .foregroundColor: TerminalTheme.black
        ]
        output.textContainerInset = NSSize(width: 10, height: 8)
        // NSTextView does not automatically become a vertically growing
        // document when it is installed in an NSScrollView programmatically.
        // Without this geometry the capture can be present in textStorage while
        // the document view still has a zero/single-line height, which looks like
        // the provider never answered.
        output.minSize = .zero
        output.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude)
        output.isVerticallyResizable = true
        output.isHorizontallyResizable = false
        output.autoresizingMask = [.width]
        output.textContainer?.containerSize = NSSize(
            width: 0,
            height: CGFloat.greatestFiniteMagnitude)
        output.textContainer?.widthTracksTextView = true
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
            self.requestCapture()
        }
        output.onTerminalCommand = { [weak self] key in
            guard let self, self.directMode else { return }
            self.controller.sendKey(key, into: self.pane)
            self.requestCapture()
        }
        scroll.documentView = output
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(outputBoundsDidChange),
            name: NSView.boundsDidChangeNotification,
            object: scroll.contentView)

        // Chat input bar — always docked at the bottom, so every pane (including
        // the two bottom ones) has a reachable, obvious place to type.
        inputBar.wantsLayer = true
        inputBar.layer?.cornerRadius = 6
        inputBar.layer?.borderWidth = 1
        inputBar.layer?.borderColor = TerminalTheme.inactive.cgColor
        inputBar.layer?.backgroundColor = TerminalTheme.inputBackground.cgColor
        inputBar.translatesAutoresizingMaskIntoConstraints = false

        input.drawsBackground = false
        input.isRichText = false
        input.isHorizontallyResizable = false
        input.isVerticallyResizable = false
        input.autoresizingMask = [.width, .height]
        input.minSize = .zero
        input.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude)
        input.font = .systemFont(ofSize: 13, weight: .regular)
        input.textColor = TerminalTheme.text
        input.insertionPointColor = TerminalTheme.active
        input.textContainerInset = NSSize(width: 4, height: 7)
        input.textContainer?.widthTracksTextView = true
        input.textContainer?.heightTracksTextView = true
        input.delegate = self
        input.onSubmit = { [weak self] text in self?.submit(text) }
        input.onFocusChange = { [weak self] focused in self?.updateInputChrome(focused: focused) }
        inputScroll.documentView = input
        inputScroll.drawsBackground = false
        inputScroll.hasVerticalScroller = false
        inputScroll.hasHorizontalScroller = false
        inputScroll.borderType = .noBorder
        inputScroll.translatesAutoresizingMaskIntoConstraints = false

        placeholder.stringValue = chatPlaceholder
        placeholder.font = .systemFont(ofSize: 13, weight: .regular)
        placeholder.textColor = TerminalTheme.dimText
        placeholder.backgroundColor = .clear
        placeholder.translatesAutoresizingMaskIntoConstraints = false

        modeButton.title = "Chat"
        modeButton.isBordered = false
        modeButton.font = .monospacedSystemFont(ofSize: 10, weight: .semibold)
        modeButton.contentTintColor = TerminalTheme.dimText
        modeButton.wantsLayer = true
        modeButton.layer?.cornerRadius = 4
        modeButton.layer?.backgroundColor = TerminalTheme.paneHeaderActive.cgColor
        modeButton.focusRingType = .none
        modeButton.target = self
        modeButton.action = #selector(toggleMode)
        modeButton.toolTip = "Chat: line prompts · Term: keyboard talks to the live CLI"
        modeButton.translatesAutoresizingMaskIntoConstraints = false

        // Stop while a turn runs, Retry once one has failed. Without this the
        // only way out of a stuck turn was to restart the app.
        actionButton.title = "Stop"
        actionButton.isBordered = false
        actionButton.font = .monospacedSystemFont(ofSize: 10, weight: .semibold)
        actionButton.contentTintColor = TerminalTheme.dimText
        actionButton.wantsLayer = true
        actionButton.layer?.cornerRadius = 4
        actionButton.layer?.backgroundColor = TerminalTheme.paneHeaderActive.cgColor
        actionButton.focusRingType = .none
        actionButton.target = self
        actionButton.action = #selector(actionButtonPressed)
        actionButton.isHidden = true
        actionButton.translatesAutoresizingMaskIntoConstraints = false

        loadingIndicator.style = .spinning
        loadingIndicator.controlSize = .small
        loadingIndicator.isDisplayedWhenStopped = false
        loadingIndicator.isHidden = true
        loadingIndicator.translatesAutoresizingMaskIntoConstraints = false

        addSubview(title)
        addSubview(scroll)
        addSubview(inputBar)
        addSubview(modeButton)
        addSubview(actionButton)
        addSubview(loadingIndicator)
        inputBar.addSubview(inputScroll)
        inputBar.addSubview(placeholder)

        inputHeight = inputBar.heightAnchor.constraint(equalToConstant: 38)
        scrollBottomChat = scroll.bottomAnchor.constraint(equalTo: inputBar.topAnchor, constant: -7)
        scrollBottomTerminal = scroll.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -7)
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: topAnchor),
            title.leadingAnchor.constraint(equalTo: leadingAnchor),
            title.trailingAnchor.constraint(equalTo: trailingAnchor),
            title.heightAnchor.constraint(equalToConstant: 30),

            scroll.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 1),
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            scrollBottomChat,

            inputBar.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 7),
            inputBar.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -7),
            inputBar.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -7),
            inputHeight,

            modeButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -7),
            modeButton.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            modeButton.widthAnchor.constraint(equalToConstant: 44),
            modeButton.heightAnchor.constraint(equalToConstant: 20),

            actionButton.trailingAnchor.constraint(equalTo: modeButton.leadingAnchor, constant: -6),
            actionButton.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            actionButton.widthAnchor.constraint(equalToConstant: 48),
            actionButton.heightAnchor.constraint(equalToConstant: 20),

            loadingIndicator.trailingAnchor.constraint(equalTo: actionButton.leadingAnchor, constant: -9),
            loadingIndicator.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            loadingIndicator.widthAnchor.constraint(equalToConstant: 14),
            loadingIndicator.heightAnchor.constraint(equalToConstant: 14),

            inputScroll.leadingAnchor.constraint(equalTo: inputBar.leadingAnchor, constant: 6),
            inputScroll.trailingAnchor.constraint(equalTo: inputBar.trailingAnchor, constant: -8),
            inputScroll.topAnchor.constraint(equalTo: inputBar.topAnchor),
            inputScroll.bottomAnchor.constraint(equalTo: inputBar.bottomAnchor),

            placeholder.leadingAnchor.constraint(equalTo: inputScroll.leadingAnchor, constant: 6),
            placeholder.centerYAnchor.constraint(equalTo: inputBar.centerYAnchor)
        ])
        // No synchronous tmux capture here: six panes each shelling out during
        // init is what made the window take seconds to appear.
        setActive(false)
        updatePlaceholder()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    override func mouseDown(with event: NSEvent) {
        onFocus?(self)
        super.mouseDown(with: event)
    }

    override func layout() {
        super.layout()
        let desiredFrame = inputScroll.contentView.bounds
        if input.frame != desiredFrame { input.frame = desiredFrame }
    }

    /// Applies a terminal capture taken on a background task. TERM mirrors the
    /// raw screen; CHAT ignores it entirely except for the busy signal.
    func applyCapture(_ raw: String) {
        let changed = raw != lastRaw
        lastRaw = raw
        guard directMode, changed else { return }
        renderRawTerminal(raw)
    }

    var terminalIsCurrentlyBusy: Bool { terminalIsBusy(lastRaw) }

    /// True while a turn is in flight — drives the sidebar beam.
    var hasTurnInFlight: Bool { session.snapshot().activeTurn != nil }

    /// True when the pane fell back to a bare shell: the provider CLI exited and
    /// anything typed here would be pasted into zsh.
    private(set) var agentProcessExited = false

    /// Captures the pane off the main thread. Typing in TERM used to block the
    /// UI on a subprocess for every keystroke.
    func requestCapture() {
        let controller = self.controller
        let pane = self.pane
        Task.detached(priority: .userInitiated) {
            let capture = controller.capture(pane)
            await MainActor.run { [weak self] in self?.applyCapture(capture) }
        }
    }

    /// Reads whatever the provider appended to its own transcript. Runs for every
    /// pane, not only the visible one, so a turn started on one agent keeps
    /// progressing while the operator works on another.
    func pollTranscript() {
        session.poll(terminalIsBusy: terminalIsCurrentlyBusy) { [weak self] _ in
            Task { @MainActor in self?.syncChatState() }
        }
    }

    private func renderRawTerminal(_ raw: String) {
        let attributed = ansiAttributed(raw, font: monoFont, boldFont: monoBold, defaultFg: TerminalTheme.text, defaultBg: TerminalTheme.outputBackground)
        let shouldFollow = followsLatestOutput || isScrolledToBottom()
        let previousSelection = output.selectedRange()
        isApplyingRefresh = true
        defer { isApplyingRefresh = false }
        output.textStorage?.setAttributedString(attributed)
        // Restore the selection so a background refresh never eats a copy in progress.
        let length = output.textStorage?.length ?? 0
        if previousSelection.length > 0, previousSelection.location + previousSelection.length <= length {
            output.setSelectedRange(previousSelection)
        }
        // Lay out the new document before scrolling. scrollToEndOfDocument on a
        // not-yet-laid-out NSTextView can keep the old origin and hide a reply.
        if shouldFollow, previousSelection.length == 0 {
            if let container = output.textContainer {
                output.layoutManager?.ensureLayout(for: container)
            }
            let end = output.textStorage?.length ?? 0
            output.scrollRangeToVisible(NSRange(location: end, length: 0))
            followsLatestOutput = true
        }
    }

    /// Reflects the conversation engine into the view: transcript, spinner,
    /// Stop/Retry affordance and input availability all derive from one state.
    func syncChatState() {
        let state = session.snapshot()
        let turns = state.turns
        let active = state.activeTurn
        // Re-rendering an unchanged transcript would fight the user's selection
        // and scroll position on every tick.
        let signature = turns.map { "\($0.id)|\($0.state.diagnosticName)|\($0.response.count)" }
            .joined(separator: ";")
        if signature != renderedSignature {
            renderedSignature = signature
            if !directMode { renderChatHistory(turns) }
        }

        setLoading(active != nil)
        input.isEditable = !directMode && active == nil
        updatePlaceholder()
        updateHeaderTitle(active: isActive)

        let failedLast = turns.last.map { turn -> Bool in
            if case .failed = turn.state { return true }
            return false
        } ?? false

        if directMode {
            actionButton.isHidden = true
        } else if active != nil {
            actionButton.isHidden = false
            actionButton.title = "Stop"
        } else if failedLast, lastSubmittedPrompt != nil {
            actionButton.isHidden = false
            actionButton.title = "Retry"
        } else {
            actionButton.isHidden = true
        }
    }

    private func renderChatHistory(_ turns: [Turn]) {
        let result = NSMutableAttributedString()
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 2
        let promptAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13, weight: .medium),
            .foregroundColor: TerminalTheme.dimText,
            .paragraphStyle: paragraph
        ]
        // The role's colour marks who was asked, matching the sidebar band.
        let markerAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
            .foregroundColor: accent.blended(withFraction: 0.35, of: TerminalTheme.black) ?? accent,
            .paragraphStyle: paragraph
        ]
        let responseAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13, weight: .regular),
            .foregroundColor: TerminalTheme.text,
            .paragraphStyle: paragraph
        ]
        let noticeAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12, weight: .medium),
            .foregroundColor: NSColor.systemRed,
            .paragraphStyle: paragraph
        ]

        for turn in turns {
            if result.length > 0 { result.append(NSAttributedString(string: "\n")) }
            if !turn.prompt.isEmpty {
                result.append(NSAttributedString(string: "› ", attributes: markerAttributes))
                result.append(NSAttributedString(string: "\(turn.prompt)\n", attributes: promptAttributes))
            }
            if !turn.response.isEmpty {
                result.append(NSAttributedString(string: "\n\(turn.response)\n", attributes: responseAttributes))
            }
            // The failure modes the old CHAT hid behind an endless spinner are now
            // stated in the transcript itself.
            switch turn.state {
            case .submitting:
                result.append(NSAttributedString(string: "\n  sending…\n", attributes: promptAttributes))
            case .blocked(let reason):
                result.append(NSAttributedString(string: "\n  ⚠︎ \(reason)\n", attributes: noticeAttributes))
            case .failed(let reason, _):
                result.append(NSAttributedString(string: "\n  ⚠︎ \(reason)\n", attributes: noticeAttributes))
            case .cancelled:
                result.append(NSAttributedString(string: "\n  stopped\n", attributes: promptAttributes))
            case .running, .completed:
                break
            }
        }

        let shouldFollow = followsLatestOutput || isScrolledToBottom()
        let previousSelection = output.selectedRange()
        isApplyingRefresh = true
        output.textStorage?.setAttributedString(result)
        if previousSelection.length > 0, previousSelection.location + previousSelection.length <= result.length {
            output.setSelectedRange(previousSelection)
        }
        if let container = output.textContainer { output.layoutManager?.ensureLayout(for: container) }
        if shouldFollow, previousSelection.length == 0 {
            output.scrollRangeToVisible(NSRange(location: result.length, length: 0))
            followsLatestOutput = true
        }
        isApplyingRefresh = false
    }

    private func setLoading(_ loading: Bool) {
        let visible = loading && !directMode
        loadingIndicator.isHidden = !visible
        if visible { loadingIndicator.startAnimation(nil) }
        else { loadingIndicator.stopAnimation(nil) }
    }

    private func isScrolledToBottom() -> Bool {
        guard let docView = scroll.documentView else { return true }
        let visible = scroll.contentView.bounds
        return visible.maxY >= docView.bounds.maxY - 4
    }

    @objc private func outputBoundsDidChange(_ notification: Notification) {
        guard !isApplyingRefresh else { return }
        followsLatestOutput = isScrolledToBottom()
    }

    func setActive(_ active: Bool) {
        isActive = active
        layer?.borderColor = (active ? accent.blended(withFraction: 0.30, of: TerminalTheme.black) ?? accent
                                     : TerminalTheme.inactive).cgColor
        layer?.borderWidth = active ? 1.5 : 1
        title.backgroundColor = active ? TerminalTheme.paneHeaderActive : TerminalTheme.paneHeader
        updateHeaderTitle(active: active)
    }

    private func updateHeaderTitle(active: Bool) {
        let components = pane.title.components(separatedBy: " · ")
        let name = components.first ?? pane.title
        let detail = components.dropFirst().joined(separator: " · ")
            .replacingOccurrences(of: " / default", with: "")
        let header = NSMutableAttributedString(string: "  \(active ? "●" : "○")", attributes: [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold),
            .foregroundColor: accent
        ])
        header.append(NSAttributedString(string: "  \(name)", attributes: [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold),
            .foregroundColor: active ? TerminalTheme.text : TerminalTheme.dimText
        ]))
        if !detail.isEmpty {
            header.append(NSAttributedString(string: "   \(detail)", attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular),
                .foregroundColor: TerminalTheme.dimText
            ]))
        }
        // A live process is not an available agent. A provider stopped by a quota
        // used to look identical to one waiting for work.
        let state = session.snapshot()
        if pane.isPaused {
            header.append(NSAttributedString(string: "   ⏸ paused", attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .semibold),
                .foregroundColor: TerminalTheme.dimText
            ]))
        } else if agentProcessExited {
            header.append(NSAttributedString(string: "   ⚠︎ process exited", attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .semibold),
                .foregroundColor: NSColor.systemRed
            ]))
        } else if !state.supportsTranscript {
            header.append(NSAttributedString(string: "   TERM only · no readable transcript", attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular),
                .foregroundColor: TerminalTheme.dimText
            ]))
        } else if case .blocked(let reason) = state.health {
            header.append(NSAttributedString(string: "   ⚠︎ \(reason)", attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .semibold),
                .foregroundColor: NSColor.systemRed
            ]))
        } else if !state.isAttached {
            header.append(NSAttributedString(string: "   no session yet", attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular),
                .foregroundColor: TerminalTheme.dimText
            ]))
        }
        title.attributedStringValue = header
    }

    /// Refreshed on the sidebar cadence. `exited` uses the same rule as the send
    /// guard: a foreground shell *with no children*, never the command name alone.
    func updateProcessState(exited: Bool) {
        guard exited != agentProcessExited else { return }
        agentProcessExited = exited
        Diagnostics.shared.record(exited ? "agent.exited" : "agent.restarted", ["pane": pane.identifier])
        renderedSignature = ""
        syncChatState()
    }

    func updateMetadata(_ updatedPane: Pane) {
        guard updatedPane.identifier == pane.identifier else { return }
        let previous = pane
        pane = updatedPane
        setActive(isActive)
        // A provider switch respawns the pane onto a brand new CLI session. The
        // previous transcript belongs to a session that no longer exists and must
        // not be shown, or left spinning, under the new one.
        if previous.provider != updatedPane.provider || previous.workingDirectory != updatedPane.workingDirectory {
            lastSubmittedPrompt = nil
            renderedSignature = ""
            session.rebind(
                provider: updatedPane.provider,
                workingDirectory: updatedPane.workingDirectory)
            Diagnostics.shared.record("pane.rebind", [
                "pane": pane.identifier,
                "provider": updatedPane.provider?.rawValue ?? "unknown"
            ])
            syncChatState()
        }
    }

    // MARK: Input (hybrid: chat field by default, live terminal on demand)

    func submit(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        input.string = ""
        updatePlaceholder()
        guard !trimmed.isEmpty else { return }
        guard session.snapshot().activeTurn == nil else { NSSound.beep(); return }
        guard !pane.isPaused else {
            let id = TurnID()
            session.registerSubmission(id: id, prompt: trimmed)
            session.failSubmission(
                id: id,
                reason: "This agent is paused. Resume it with: agent-room.sh resume \(pane.index)")
            lastSubmittedPrompt = trimmed
            renderedSignature = ""
            syncChatState()
            return
        }
        guard !agentProcessExited else {
            // Pasting into a bare shell would silently do nothing, then time out.
            let id = TurnID()
            session.registerSubmission(id: id, prompt: trimmed)
            session.failSubmission(
                id: id,
                reason: "This agent's CLI has exited — the pane is a plain shell. Restart it from the sidebar route menu.")
            lastSubmittedPrompt = trimmed
            renderedSignature = ""
            syncChatState()
            return
        }
        followsLatestOutput = true
        lastSubmittedPrompt = trimmed
        let id = TurnID()
        session.registerSubmission(id: id, prompt: trimmed)
        renderedSignature = ""
        syncChatState()
        Diagnostics.shared.record("turn.submitting", [
            "pane": pane.identifier,
            "turn": id.description,
            "chars": String(trimmed.count)
        ])

        // tmux spawns subprocesses and sleeps between paste and Enter. Doing that
        // on the main actor is what made the whole window stutter on submit.
        let controller = self.controller
        let pane = self.pane
        // Send exactly the text recorded as the prompt, so the acknowledgement
        // can be matched against what the provider echoes back.
        Task.detached(priority: .userInitiated) {
            let outcome = controller.sendLine(trimmed, into: pane)
            await MainActor.run { [weak self] in
                guard let self else { return }
                switch outcome {
                case .sent:
                    return
                case .agentExited:
                    self.session.failSubmission(
                        id: id,
                        reason: "This agent's CLI has exited — the pane is back to a plain shell, so nothing was sent. Restart it from the sidebar route menu.")
                    Diagnostics.shared.record("turn.failed", [
                        "pane": pane.identifier, "turn": id.description, "reason": "agent-exited"
                    ])
                case .tmuxFailed:
                    self.session.failSubmission(
                        id: id, reason: "tmux refused this prompt. The pane may have closed.")
                    Diagnostics.shared.record("turn.failed", [
                        "pane": pane.identifier, "turn": id.description, "reason": "tmux-refused"
                    ])
                }
                self.renderedSignature = ""
                self.syncChatState()
            }
        }
    }

    @objc func actionButtonPressed() {
        if session.snapshot().activeTurn != nil {
            stopActiveTurn()
        } else {
            retryLastPrompt()
        }
    }

    private func stopActiveTurn() {
        let controller = self.controller
        let pane = self.pane
        Diagnostics.shared.record("turn.cancelled", ["pane": pane.identifier])
        Task.detached(priority: .userInitiated) { controller.interrupt(pane) }
        session.cancelActiveTurn()
        renderedSignature = ""
        syncChatState()
    }

    private func retryLastPrompt() {
        guard let prompt = lastSubmittedPrompt else { return }
        Diagnostics.shared.record("turn.retry", ["pane": pane.identifier])
        submit(prompt)
    }

    @objc func toggleMode() {
        setDirectMode(!directMode)
        onFocus?(self)
    }

    func setDirectMode(_ on: Bool) {
        directMode = on
        followsLatestOutput = true
        inputBar.isHidden = on
        inputHeight.constant = on ? 0 : 38
        scrollBottomChat.isActive = !on
        scrollBottomTerminal.isActive = on
        modeButton.title = on ? "Term" : "Chat"
        modeButton.contentTintColor = on ? TerminalTheme.white : TerminalTheme.dimText
        modeButton.layer?.backgroundColor = (on ? TerminalTheme.active : TerminalTheme.paneHeaderActive).cgColor
        placeholder.stringValue = chatPlaceholder
        updateInputChrome(focused: false)
        renderedSignature = ""
        if on {
            renderRawTerminal(lastRaw)
        }
        syncChatState()
        window?.makeFirstResponder(on ? output : input)
        if on { output.scrollToEndOfDocument(nil) }
    }

    func focusInput() {
        window?.makeFirstResponder(directMode ? output : input)
    }

    func updateInputChrome(focused: Bool) {
        let highlight = focused && !directMode
        inputBar.layer?.borderColor = (highlight ? TerminalTheme.active : TerminalTheme.inactive).cgColor
        inputBar.layer?.borderWidth = highlight ? 1.5 : 1
    }

    func updatePlaceholder() {
        placeholder.isHidden = session.snapshot().activeTurn != nil || !input.string.isEmpty
    }

    func textDidChange(_ notification: Notification) {
        updatePlaceholder()
    }

    func pasteFromClipboard() {
        guard let text = NSPasteboard.general.string(forType: .string) else { return }
        if directMode {
            controller.paste(text, into: pane)
            requestCapture()
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
            requestCapture()
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
        case 48:
            controller.sendKey(event.modifierFlags.contains(.shift) ? "BTab" : "Tab", into: pane)
        case 53: controller.sendKey("Escape", into: pane)
        case 123: controller.sendKey("Left", into: pane)
        case 124: controller.sendKey("Right", into: pane)
        case 125: controller.sendKey("Down", into: pane)
        case 126: controller.sendKey("Up", into: pane)
        default:
            guard let text = event.characters, !text.isEmpty else { return false }
            controller.sendLiteral(text, into: pane)
        }
        requestCapture()
        return true
    }
}

// MARK: - Native sidebar (mirrors sidebar_view)

final class SidebarView: NSView {
    var data: SidebarData?
    /// Per-agent warning shown instead of the provider name: "GONE" when the
    /// tmux pane vanished, "EXITED" when the CLI died and left a bare shell.
    var agentNotes: [Int: String] = [:] {
        didSet { if oldValue != agentNotes { needsDisplay = true } }
    }
    var showsServerControls = false
    var selectedIndex = 1 {
        didSet { if oldValue != selectedIndex { needsDisplay = true } }
    }
    var onSelect: ((Int) -> Void)?
    var onRoute: ((Int, NSPoint) -> Void)?
    var onSync: (() -> Void)?
    var onReset: (() -> Void)?
    var onShelve: (() -> Void)?

    private var agentRects: [(index: Int, rect: NSRect)] = []
    private var syncRect: NSRect = .zero
    private var resetRect: NSRect = .zero
    private var shelveRect: NSRect = .zero

    private let font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
    private let boldFont = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .semibold)
    private let headingFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .bold)
    private let lineHeight: CGFloat = 16

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    func update(_ newData: SidebarData) {
        data = newData
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        TerminalTheme.sidebarBackground.setFill()
        bounds.fill()
        agentRects = []
        syncRect = .zero
        resetRect = .zero
        shelveRect = .zero

        let w = bounds.width
        let inset: CGFloat = 12
        let innerWidth = max(0, w - inset * 2)
        var y: CGFloat = 14

        @discardableResult
        func band(_ color: NSColor, height: CGFloat, x: CGFloat = inset, width: CGFloat = innerWidth) -> NSRect {
            let rect = NSRect(x: x, y: y, width: width, height: height)
            color.setFill()
            NSBezierPath(roundedRect: rect, xRadius: 6, yRadius: 6).fill()
            return rect
        }
        func text(_ string: String, _ color: NSColor, _ f: NSFont, x: CGFloat = inset) {
            (string as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [.font: f, .foregroundColor: color])
        }
        func rightText(_ string: String, _ color: NSColor, _ f: NSFont, right: CGFloat = inset) {
            let width = (string as NSString).size(withAttributes: [.font: f]).width
            text(string, color, f, x: w - right - width)
        }
        func centeredText(_ string: String, _ color: NSColor, _ f: NSFont, in rect: NSRect) {
            let size = (string as NSString).size(withAttributes: [.font: f])
            (string as NSString).draw(
                at: NSPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2),
                withAttributes: [.font: f, .foregroundColor: color])
        }
        func divider() {
            TerminalTheme.sidebarRule.setFill()
            NSRect(x: inset, y: y, width: innerWidth, height: 1).fill()
        }
        func newline(_ count: CGFloat = 1) { y += lineHeight * count }
        func section(_ label: String) {
            text(label.uppercased(), TerminalTheme.sidebarDim, boldFont)
            newline(1.35)
        }

        guard let data else {
            text("PANESHIFT", TerminalTheme.sidebarText, headingFont)
            newline(2)
            text("Connecting to tmux…", TerminalTheme.sidebarDim, font)
            return
        }

        // Title band in the room's sand tone, echoing the tmux Control Room
        // header (`48;5;223`, bold black on peach).
        let titleBand = band(TerminalTheme.sand, height: 26)
        (("  PANESHIFT") as NSString).draw(
            at: NSPoint(x: inset + 4, y: titleBand.midY - headingFont.pointSize * 0.66),
            withAttributes: [.font: headingFont, .foregroundColor: TerminalTheme.black])
        let scopeLabel = showsServerControls ? "REMOTE" : "LOCAL"
        let scopeWidth = (scopeLabel as NSString).size(withAttributes: [.font: boldFont]).width
        (scopeLabel as NSString).draw(
            at: NSPoint(x: titleBand.maxX - scopeWidth - 8, y: titleBand.midY - boldFont.pointSize * 0.62),
            withAttributes: [.font: boldFont, .foregroundColor: NSColor(calibratedWhite: 0.28, alpha: 1)])
        y = titleBand.maxY + 8
        text("\(data.agents.count) TERMINALS", TerminalTheme.sidebarDim, font)
        newline(1.4)
        divider()
        newline(1.2)

        section("Agents")
        for agent in data.agents {
            let start = y
            let selected = agent.index == selectedIndex
            // Each role keeps the pastel identity it already has in tmux, so the
            // two surfaces name the same agent with the same colour.
            let accent = color256(agent.color)
            // Unselected rows sit back without losing their hue; the active one
            // is the full tone, which is what makes the selection obvious.
            let fill = selected ? accent : accent.blended(withFraction: 0.62, of: TerminalTheme.sidebarBackground) ?? accent
            let rect = band(fill, height: 28)
            if selected {
                TerminalTheme.white.withAlphaComponent(0.9).setStroke()
                let ring = NSBezierPath(roundedRect: rect.insetBy(dx: 0.75, dy: 0.75), xRadius: 6, yRadius: 6)
                ring.lineWidth = 1.5
                ring.stroke()
            }
            let primary = selected ? TerminalTheme.black : TerminalTheme.sidebarText
            let secondary = selected
                ? NSColor(calibratedWhite: 0.28, alpha: 1)
                : accent.blended(withFraction: 0.25, of: TerminalTheme.white) ?? TerminalTheme.sidebarDim
            text(String(format: "%02d", agent.index), secondary, boldFont, x: inset + 7)
            text(agent.name, primary, boldFont, x: inset + 35)
            // A role whose pane or CLI is gone must not look ready to receive work.
            if let note = agentNotes[agent.index] {
                rightText(note, selected ? NSColor.systemRed : TerminalTheme.alert, boldFont, right: inset + 8)
            } else {
                rightText(agent.provider.uppercased(), secondary, font, right: inset + 8)
            }
            y = start + 33
            agentRects.append((agent.index, rect))
        }
        newline(0.55)
        divider()
        newline(1.2)

        section("Status")
        text(data.momentum, TerminalTheme.sidebarText, boldFont)
        rightText(data.elapsed, TerminalTheme.sidebarDim, font)
        newline()
        text("\(data.sessions) sessions · \(data.streak)d streak · best \(data.longest)", TerminalTheme.sidebarDim, font)
        newline()
        text("CPU \(data.cpu) · RAM \(data.ram) · GPU \(data.gpu)", TerminalTheme.sidebarText, font)
        newline()
        text("\(data.live)/\(data.total) live · \(data.claims) claims · \(data.tokens) tokens", TerminalTheme.sidebarDim, font)
        newline(1.4)

        // Twelve-week activity calendar. `sidebar_data` has always emitted these
        // GRID rows and SidebarData has always stored them, but nothing drew
        // them, so the heatmap existed only in the tmux sidebar.
        if !data.grid.isEmpty {
            let columns = data.grid.map(\.count).max() ?? 0
            if columns > 0 {
                let cell: CGFloat = 8
                let gap: CGFloat = 2
                let available = innerWidth
                let scale = min(1, available / (CGFloat(columns) * (cell + gap)))
                let size = max(3, (cell * scale).rounded())
                let step = size + gap * scale
                for (row, levels) in data.grid.enumerated() {
                    for (column, level) in levels.enumerated() {
                        let color: NSColor
                        switch level {
                        case " ": continue                       // future day
                        case ".": color = TerminalTheme.sidebarRow
                        case "0": color = NSColor(calibratedWhite: 0.28, alpha: 1)
                        case "1": color = NSColor(calibratedRed: 0.24, green: 0.42, blue: 0.30, alpha: 1)
                        case "2": color = NSColor(calibratedRed: 0.27, green: 0.57, blue: 0.36, alpha: 1)
                        case "3": color = NSColor(calibratedRed: 0.33, green: 0.72, blue: 0.42, alpha: 1)
                        default: color = NSColor(calibratedRed: 0.45, green: 0.90, blue: 0.52, alpha: 1)
                        }
                        color.setFill()
                        NSBezierPath(roundedRect: NSRect(
                            x: inset + CGFloat(column) * step,
                            y: y + CGFloat(row) * step,
                            width: size,
                            height: size), xRadius: 1.5, yRadius: 1.5).fill()
                    }
                }
                y += CGFloat(data.grid.count) * step + 10
            }
        }

        if showsServerControls {
            text("OVH \(data.ovh) / month", TerminalTheme.sidebarDim, font)
            newline(1.4)
            shelveRect = band(TerminalTheme.sidebarRow, height: 27)
            centeredText("SAVE & SHELVE", TerminalTheme.sidebarText, boldFont, in: shelveRect)
            y += 34
        }

        let buttonGap: CGFloat = 7
        let buttonWidth = (innerWidth - buttonGap) / 2
        syncRect = band(TerminalTheme.sidebarText, height: 27, width: buttonWidth)
        centeredText("SYNC", TerminalTheme.black, boldFont, in: syncRect)
        resetRect = band(TerminalTheme.sidebarRow, height: 27, x: inset + buttonWidth + buttonGap, width: buttonWidth)
        centeredText("RESET", TerminalTheme.sidebarText, boldFont, in: resetRect)
        y += 38
        text("CLICK open · RIGHT-CLICK route", TerminalTheme.sidebarDim, font)
        newline()
        text("⌘⇧←/→ agent · sync \(data.sync)", TerminalTheme.sidebarDim, font)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        for entry in agentRects where entry.rect.contains(point) {
            onSelect?(entry.index)
            return
        }
        if syncRect.contains(point) { onSync?(); return }
        if resetRect.contains(point) { onReset?(); return }
        if shelveRect.contains(point) { onShelve?(); return }
    }

    override func rightMouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        for entry in agentRects where entry.rect.contains(point) {
            onRoute?(entry.index, point)
            return
        }
        super.rightMouseDown(with: event)
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
    /// Light along the foot of the sidebar, carrying the colours of whichever
    /// agents are working. An idle room shows nothing.
    let beam = BeamView()
    var activeIndex = 0
    var paneTimer: Timer?
    var sidebarTimer: Timer?
    var processHealthTimer: Timer?
    var resizeWorkItem: DispatchWorkItem?
    var paneRefreshInFlight = false
    var paneRefreshPending = false
    var gridColumns = 2
    var gridRows = 2
    var latestData: SidebarData?
    /// Roles whose tmux pane no longer exists. Shown in the sidebar instead of
    /// silently disappearing from the room.
    var missingAgents: [Int] = []
    let serverConfig: String
    let serverController: String

    init(session: String, sshHost: String?, serverConfig: String, serverController: String) {
        controller = TmuxController(session: session, sshHost: sshHost)
        self.serverConfig = serverConfig
        self.serverController = serverController
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        controller.roomScript = controller.optionValue("@agent_room_script")
        controller.roomConfig = controller.optionValue("@agent_room_config")

        let expectedCount = controller.agentCount()
        let panes = controller.panes()
        // One agent dying used to take the whole app down: the window refused to
        // open at all until the room was rebuilt by hand. Open with whatever
        // survives, and say which roles are missing.
        guard !panes.isEmpty else {
            showError("PaneShift found no agent panes in tmux session '\(controller.session):agents'. Start the room first, for example with ./paneshift-local.")
            return
        }
        if panes.count < expectedCount {
            let present = Set(panes.map(\.index))
            missingAgents = (1 ... expectedCount).filter { !present.contains($0) }
            Diagnostics.shared.record("room.incomplete", [
                "expected": String(expectedCount),
                "found": String(panes.count),
                "missing": missingAgents.map(String.init).joined(separator: ",")
            ])
        }

        let content = NSView()
        content.wantsLayer = true
        content.layer?.backgroundColor = TerminalTheme.appBackground.cgColor

        let grid = NSView()
        grid.translatesAutoresizingMaskIntoConstraints = false

        paneViews = panes.prefix(max(expectedCount, panes.count)).map { pane in
            let view = PaneView(pane: pane, controller: controller)
            view.translatesAutoresizingMaskIntoConstraints = false
            view.onFocus = { [weak self] paneView in self?.activate(paneView) }
            return view
        }
        paneViews.forEach { grid.addSubview($0) }

        sidebar.translatesAutoresizingMaskIntoConstraints = false
        beam.translatesAutoresizingMaskIntoConstraints = false
        sidebar.addSubview(beam)
        sidebar.wantsLayer = true
        sidebar.layer?.cornerRadius = 7
        sidebar.layer?.masksToBounds = true
        sidebar.showsServerControls = controller.sshHost != nil
        sidebar.onSelect = { [weak self] index in self?.selectAgent(index) }
        sidebar.onRoute = { [weak self] index, point in self?.showRouteMenu(index: index, at: point) }
        sidebar.onSync = { [weak self] in self?.runRoomAsync(["memory-refresh", "manual", "0"]) }
        sidebar.onReset = { [weak self] in self?.runRoomAsync(["reset-layout"]) }
        sidebar.onShelve = { [weak self] in self?.confirmShelve() }

        content.addSubview(grid)
        content.addSubview(sidebar)
        var layoutConstraints = [
            grid.topAnchor.constraint(equalTo: content.topAnchor, constant: 12),
            grid.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            grid.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -12),
            grid.trailingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: -12),
            sidebar.topAnchor.constraint(equalTo: content.topAnchor, constant: 12),
            sidebar.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -12),
            sidebar.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12),
            sidebar.widthAnchor.constraint(equalToConstant: 220),

            beam.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor),
            beam.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor),
            beam.bottomAnchor.constraint(equalTo: sidebar.bottomAnchor),
            beam.heightAnchor.constraint(equalToConstant: 46)
        ]
        // One focused workspace. All six PaneViews stay alive and retain their
        // state, but only the selected agent is visible.
        gridColumns = paneViews.count > 4 ? 3 : 2
        gridRows = (paneViews.count + gridColumns - 1) / gridColumns
        for paneView in paneViews {
            layoutConstraints.append(contentsOf: [
                paneView.topAnchor.constraint(equalTo: grid.topAnchor),
                paneView.leadingAnchor.constraint(equalTo: grid.leadingAnchor),
                paneView.trailingAnchor.constraint(equalTo: grid.trailingAnchor),
                paneView.bottomAnchor.constraint(equalTo: grid.bottomAnchor)
            ])
        }
        NSLayoutConstraint.activate(layoutConstraints)

        let initialRect: NSRect
        if let visible = NSScreen.main?.visibleFrame {
            let width = min(1320, visible.width * 0.92)
            let height = min(900, visible.height * 0.90)
            initialRect = NSRect(
                x: visible.midX - width / 2,
                y: visible.midY - height / 2,
                width: width,
                height: height)
        } else {
            initialRect = NSRect(x: 60, y: 60, width: 1440, height: 900)
        }
        let window = MainWindow(
            contentRect: initialRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "PaneShift · \(controller.session)"
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
        // Local live-follow: pin the window to the right half of the screen so a
        // reviewer can watch changes land while working elsewhere on the left.
        // The workspace shows one agent at a time whatever the room size, so the
        // dock applies to a six-agent room exactly as it does to a four-agent one.
        // Gating it on `count <= 4` silently disabled the documented behaviour.
        if ProcessInfo.processInfo.environment["PANESHIFT_DOCK_RIGHT"] == "1",
           let screen = NSScreen.main {
            let visible = screen.visibleFrame
            let width = (visible.width / 2).rounded()
            window.setFrame(
                NSRect(x: visible.maxX - width, y: visible.minY, width: width, height: visible.height),
                display: true)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
        activate(paneViews[0])
        scheduleTmuxResize()

        paneTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshPaneOutputs() }
        }
        sidebarTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshSidebar()
                // Same cadence: catch a CLI that exited, or a pane that vanished,
                // without paying for it on every 1.2 s transcript tick.
                self?.refreshPaneMetadata()
            }
        }
        // Faster process health than sidebar: dead CLI must show before the next send.
        processHealthTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshPaneMetadata() }
        }
        refreshSidebar()
        refreshPaneMetadata()
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
        guard paneViews.indices.contains(activeIndex) else { return }
        let activePane = paneViews[activeIndex]
        activePane.layoutSubtreeIfNeeded()
        sidebar.layoutSubtreeIfNeeded()

        let charWidth = max(1, ("W" as NSString).size(withAttributes: [.font: activePane.monoFont]).width)
        let lineHeight = max(1, activePane.output.layoutManager?.defaultLineHeight(for: activePane.monoFont) ?? 14)
        let contentSize = activePane.scroll.contentView.bounds.size

        let paneColumns = max(24, Int(contentSize.width / charWidth))
        let paneRows = max(8, Int(contentSize.height / lineHeight))
        let sidebarColumns = max(20, Int(sidebar.bounds.width / charWidth))
        let totalColumns = paneColumns * gridColumns + sidebarColumns + gridColumns + 2
        let totalRows = paneRows * gridRows + gridRows + 1

        paneViews.forEach { $0.output.textContainer?.widthTracksTextView = true }
        controller.resizeWindow(columns: totalColumns, rows: totalRows)
        // The native sidebar does not need the wide tmux control pane. Pin the
        // latter back to its configured width so each hidden provider pane gets
        // the same readable columns as the focused native workspace.
        _ = controller.room(["sidebar-resize"])
        _ = controller.room(["sidebar-balance"])
        refreshPaneOutputs()
    }

    /// The beam shows which agents are mid-turn right now.
    func refreshBeam() {
        let colors = paneViews.filter { $0.hasTurnInFlight }.map(\.accent)
        beam.activeColors = colors
    }

    func refreshPaneOutputs() {
        // Only the selected terminal is mirrored pixel for pixel — that is the
        // expensive part. Every pane still follows its own transcript, which is a
        // cheap incremental file read, so a turn left running on a hidden agent
        // keeps advancing instead of freezing until it is selected again.
        paneViews.forEach { $0.pollTranscript() }
        refreshBeam()

        if paneRefreshInFlight {
            paneRefreshPending = true
            return
        }
        guard paneViews.indices.contains(activeIndex) else { return }
        paneRefreshInFlight = true
        let requestedIndex = activeIndex
        let pane = paneViews[requestedIndex].pane
        let controller = self.controller
        Task.detached(priority: .utility) { [weak self] in
            let capture = controller.capture(pane)
            await MainActor.run {
                guard let self else { return }
                if self.paneViews.indices.contains(requestedIndex) {
                    self.paneViews[requestedIndex].applyCapture(capture)
                }
                let shouldRefreshAgain = self.paneRefreshPending
                self.paneRefreshPending = false
                self.paneRefreshInFlight = false
                if shouldRefreshAgain { self.refreshPaneOutputs() }
            }
        }
    }

    func refreshPaneMetadata() {
        let controller = self.controller
        Task.detached(priority: .utility) { [weak self] in
            let panes = controller.panes()
            let alive = Dictionary(uniqueKeysWithValues: panes.map {
                ($0.identifier, controller.agentProcessIsAlive($0))
            })
            await MainActor.run {
                guard let self else { return }
                let updates = Dictionary(uniqueKeysWithValues: panes.map { ($0.identifier, $0) })
                let present = Set(panes.map(\.index))
                var notes: [Int: String] = [:]
                for paneView in self.paneViews {
                    if let updated = updates[paneView.pane.identifier] { paneView.updateMetadata(updated) }
                    if let isAlive = alive[paneView.pane.identifier] {
                        paneView.updateProcessState(exited: !isAlive)
                    }
                    if !present.contains(paneView.pane.index) {
                        notes[paneView.pane.index] = "GONE"
                    } else if paneView.pane.isPaused {
                        notes[paneView.pane.index] = "PAUSED"
                    } else if paneView.agentProcessExited {
                        notes[paneView.pane.index] = "EXITED"
                    }
                }
                for index in self.missingAgents where !present.contains(index) {
                    notes[index] = "GONE"
                }
                self.sidebar.agentNotes = notes
            }
        }
    }

    func refreshSidebar() {
        Task.detached(priority: .userInitiated) {
            guard let raw = self.controller.room(["sidebar-data"]),
                  let data = SidebarData(raw: raw) else { return }
            await MainActor.run {
                self.latestData = data
                self.sidebar.update(data)
                // Give every pane the colour its role already has in tmux.
                let colors = Dictionary(uniqueKeysWithValues: data.agents.map { ($0.index, $0.color) })
                for paneView in self.paneViews {
                    if let code = colors[paneView.pane.index] {
                        paneView.accent = color256(code)
                    }
                }
            }
        }
    }

    func runRoomAsync(_ arguments: [String]) {
        Task.detached(priority: .userInitiated) {
            let result = self.controller.roomResult(arguments)
            await MainActor.run {
                guard let result, result.succeeded else {
                    let detail = result?.output.trimmingCharacters(in: .whitespacesAndNewlines) ?? "PaneShift could not start the requested operation."
                    self.showOperationError(detail)
                    return
                }
                self.refreshPaneMetadata()
                self.refreshPaneOutputs()
                self.refreshSidebar()
            }
        }
    }

    func confirmShelve() {
        guard controller.sshHost != nil else {
            showOperationError("This room is local. No OVH server action is available or permitted.")
            return
        }
        let alert = NSAlert()
        alert.messageText = "Économiser en suspendant le serveur ?"
        alert.informativeText = "PaneShift refusera si un agent travaille, sauvegardera toutes les mémoires, puis mettra l’instance OVH en shelve. Seul le snapshot restera facturé. L’app la réactivera au prochain lancement."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Sauvegarder et suspendre")
        alert.addButton(withTitle: "Annuler")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let helper = serverController
        let config = serverConfig
        Task.detached(priority: .userInitiated) {
            let result = shellCapture(helper, ["--config", config, "shelve"])
            await MainActor.run {
                guard result != nil else {
                    let failure = NSAlert()
                    failure.messageText = "Serveur conservé en ligne"
                    failure.informativeText = "La suspension a été refusée ou la configuration OVHcloud manque. Aucun agent n’a été interrompu."
                    failure.runModal()
                    return
                }
                NSApp.terminate(nil)
            }
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

        if agent.anthropicAvailable { providerItem("ANTHROPIC · Claude Code", "anthropic", agent.anthropicModels) }
        if agent.openaiAvailable { providerItem("OPENAI · Codex", "openai", agent.openaiModels) }
        if agent.grokAvailable { providerItem("GROK · Grok Build", "grok", agent.grokModels) }
        if agent.localAvailable { providerItem("LOCAL · configured CLI", "local", []) }

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
        let changed = activeIndex != index
        activeIndex = index
        paneViews.enumerated().forEach { offset, view in
            let selected = offset == index
            view.isHidden = !selected
            view.setActive(selected)
        }
        sidebar.selectedIndex = paneView.pane.index
        controller.focus(paneView.pane)
        paneView.focusInput()
        if changed { refreshPaneOutputs() }
    }

    func selectAgent(_ agentIndex: Int) {
        guard let paneView = paneViews.first(where: { $0.pane.index == agentIndex }) else { return }
        activate(paneView)
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

    func showOperationError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "PaneShift operation failed"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
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
let sshHost = argumentValue("--ssh")
let serverConfig = argumentValue("--server-config") ?? NSString(string: "~/.config/paneshift/server.conf").expandingTildeInPath
let serverController = argumentValue("--server-controller") ?? "paneshift-server"
// Diagnostic probe: shows exactly what CHAT would display for an agent, and
// which transcript file it is reading. This is the first thing to run when a
// pane looks empty — it separates "no session found" from "session found but
// empty" without guessing.
if CommandLine.arguments.contains("--transcript-probe") {
    let controller = TmuxController(session: session, sshHost: sshHost)
    let requested = argumentValue("--agent").flatMap(Int.init)
    let panes = controller.panes().filter { requested == nil || $0.index == requested }
    guard !panes.isEmpty else {
        fputs("PaneShiftApp: no matching agent pane in \(session):agents\n", stderr)
        exit(1)
    }
    for pane in panes {
        let probe = TranscriptSession(provider: pane.provider, workingDirectory: pane.workingDirectory)
        let state = probe.pollBlocking(terminalIsBusy: false)
        print("── \(pane.index) \(pane.title)")
        print("   dir:        \(pane.workingDirectory)")
        guard state.supportsTranscript else {
            print("   transcript: unsupported provider (TERM only)")
            continue
        }
        print("   transcript: \(state.transcriptPath ?? "NOT FOUND")")
        for turn in state.turns.suffix(4) {
            print("   [\(turn.state.diagnosticName)] › \(turn.prompt.prefix(60))")
            if !turn.response.isEmpty {
                print("       \(turn.response.prefix(120).replacingOccurrences(of: "\n", with: " ⏎ "))")
            }
        }
    }
    exit(0)
}
// End-to-end probe: submits a real prompt through the same TmuxController and
// TranscriptSession the GUI uses, then prints every state transition until the
// turn settles. Exercises the whole plumbing without AppKit.
if CommandLine.arguments.contains("--send-probe"),
   let index = argumentValue("--agent").flatMap(Int.init),
   let prompt = argumentValue("--prompt") {
    let controller = TmuxController(session: session, sshHost: sshHost)
    guard let pane = controller.panes().first(where: { $0.index == index }) else {
        fputs("PaneShiftApp: agent \(index) not found\n", stderr)
        exit(1)
    }
    let probe = TranscriptSession(provider: pane.provider, workingDirectory: pane.workingDirectory)
    // Establish the baseline so prior turns are not mistaken for this one.
    let baseline = probe.pollBlocking(terminalIsBusy: false)
    guard baseline.supportsTranscript else {
        fputs("PaneShiftApp: agent \(index) has no readable transcript (TERM-only provider)\n", stderr)
        exit(1)
    }
    let priorTurns = baseline.turns.count
    print("agent \(index) \(pane.title)")
    print("transcript: \(baseline.transcriptPath ?? "NOT FOUND")")

    let id = TurnID()
    probe.registerSubmission(id: id, prompt: prompt)
    print("[\(id)] submitting: \(prompt)")
    switch controller.sendLine(prompt, into: pane) {
    case .sent:
        break
    case .agentExited:
        probe.failSubmission(id: id, reason: "agent CLI exited")
        print("[\(id)] FAILED: this agent's CLI has exited (pane is a bare shell) — nothing was sent")
        exit(4)
    case .tmuxFailed:
        probe.failSubmission(id: id, reason: "tmux refused the keystrokes")
        print("[\(id)] FAILED: tmux refused the keystrokes")
        exit(1)
    }

    var lastReported = ""
    let deadline = Date().addingTimeInterval(120)
    while Date() < deadline {
        Thread.sleep(forTimeInterval: 1.0)
        let busy = terminalIsBusy(controller.capture(pane))
        let state = probe.pollBlocking(terminalIsBusy: busy)
        guard let turn = state.turns.dropFirst(priorTurns).first else { continue }
        let phase = turn.state.diagnosticName
        if phase != lastReported {
            lastReported = phase
            print("[\(id)] \(phase)\(busy ? " (terminal busy)" : "")")
        }
        if turn.state.isTerminal {
            print("--- response ---")
            print(turn.response.isEmpty ? "(empty)" : turn.response)
            exit(turn.state == .completed ? 0 : 2)
        }
    }
    print("[\(id)] TIMED OUT after 120s")
    exit(3)
}
if CommandLine.arguments.contains("--check") {
    let controller = TmuxController(session: session, sshHost: sshHost)
    let panes = controller.panes()
    let expectedCount = controller.agentCount()
    guard panes.count >= expectedCount else {
        fputs("PaneShiftApp: expected \(expectedCount) panes in \(session):agents, found \(panes.count)\n", stderr)
        exit(1)
    }
    print(panes.prefix(expectedCount).map { "\($0.index):\($0.identifier)" }.joined(separator: " "))
    exit(0)
}
let app = NSApplication.shared
let delegate = AppDelegate(session: session, sshHost: sshHost, serverConfig: serverConfig, serverController: serverController)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()

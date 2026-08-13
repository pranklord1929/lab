import Foundation

// MARK: - Provider

public enum Provider: String, Sendable, CaseIterable {
    case anthropic
    case openai
    case grok

    public init?(roomValue: String) {
        switch roomValue.lowercased() {
        case "anthropic", "claude": self = .anthropic
        case "openai", "codex": self = .openai
        case "grok", "xai": self = .grok
        default: return nil
        }
    }
}

// MARK: - Transcript events

public struct TranscriptEntry: Equatable, Sendable {
    public enum Role: String, Sendable {
        case user
        case assistant
    }

    public let role: Role
    public let text: String
    public let timestamp: Date?

    public init(role: Role, text: String, timestamp: Date? = nil) {
        self.role = role
        self.text = text
        self.timestamp = timestamp
    }
}

// A provider's session log is read as an ordered event stream rather than a
// rendered screen. Each provider signals turn boundaries explicitly, so CHAT no
// longer has to guess when an answer started or finished.
public enum TranscriptEvent: Equatable, Sendable {
    case message(TranscriptEntry)
    case turnStarted
    case turnEnded(outcome: TurnOutcome)
}

public enum TurnOutcome: String, Equatable, Sendable {
    case completed
    case aborted
}

// MARK: - Parsing helpers

enum JSONLine {
    /// Providers append to their logs while we read them, so the final line of a
    /// poll is regularly a partial write. Returning nil for unparsable lines lets
    /// the tailer retry the same bytes on the next pass instead of losing a turn.
    static func object(_ line: Substring) -> [String: Any]? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func date(_ value: Any?) -> Date? {
        guard let string = value as? String else { return nil }
        return TranscriptDate.parse(string)
    }
}

/// `ISO8601DateFormatter` is a non-Sendable class, so it cannot be shared across
/// the polling tasks. `Date.ISO8601FormatStyle` is a Sendable value type.
public enum TranscriptDate {
    private static let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let withoutFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: false)

    public static func parse(_ value: String) -> Date? {
        (try? withFraction.parse(value)) ?? (try? withoutFraction.parse(value))
    }

    public static func string(from date: Date) -> String {
        withFraction.format(date)
    }
}

/// The CLIs inject reminders, tool results and environment preambles into the
/// same `user` role as real prompts. Only genuine keystrokes belong in CHAT.
enum PromptText {
    static func stripReminders(_ text: String) -> String {
        var result = text
        for tag in ["system-reminder", "user_info", "env", "command-message", "command-name", "local-command-stdout"] {
            result = result.replacingOccurrences(
                of: "<\(tag)>.*?</\(tag)>",
                with: "",
                options: [.regularExpression, .caseInsensitive])
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Grok wraps the operator's actual keystrokes in `<user_query>`.
    static func unwrapQuery(_ text: String) -> String? {
        guard let range = text.range(of: "<user_query>"),
              let end = text.range(of: "</user_query>", range: range.upperBound ..< text.endIndex)
        else { return nil }
        return String(text[range.upperBound ..< end.lowerBound])
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func concatenatedText(_ content: Any?) -> String {
        if let string = content as? String { return string }
        guard let blocks = content as? [[String: Any]] else { return "" }
        return blocks
            .filter { ($0["type"] as? String) == "text" }
            .compactMap { $0["text"] as? String }
            .joined(separator: "\n")
    }

    static func containsToolResult(_ content: Any?) -> Bool {
        guard let blocks = content as? [[String: Any]] else { return false }
        return blocks.contains { ($0["type"] as? String) == "tool_result" }
    }
}

// MARK: - Adapters

public protocol TranscriptAdapter: Sendable {
    /// Parses a chunk of newly appended log text into ordered events.
    func events(from chunk: String) -> [TranscriptEvent]
    /// Extra files that must be tailed alongside the main transcript.
    func companionEvents(from chunk: String) -> [TranscriptEvent]
}

public extension TranscriptAdapter {
    func companionEvents(from chunk: String) -> [TranscriptEvent] { [] }
}

// Claude Code — `~/.claude/projects/<mangled-cwd>/<session>.jsonl`.
// Turn end is authoritative: an assistant entry whose `stop_reason` is
// `end_turn`. Sidechain entries belong to sub-agents and never reach CHAT.
public struct ClaudeAdapter: TranscriptAdapter {
    public init() {}

    public func events(from chunk: String) -> [TranscriptEvent] {
        var events: [TranscriptEvent] = []
        for line in chunk.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let object = JSONLine.object(line) else { continue }
            guard (object["isSidechain"] as? Bool) != true else { continue }
            let type = object["type"] as? String
            let message = object["message"] as? [String: Any]
            let timestamp = JSONLine.date(object["timestamp"])

            switch type {
            case "user":
                // Tool results are replayed under the user role; they are machine
                // traffic, not something the operator typed.
                guard object["toolUseResult"] == nil,
                      !PromptText.containsToolResult(message?["content"]) else { continue }
                let text = PromptText.stripReminders(PromptText.concatenatedText(message?["content"]))
                guard !text.isEmpty else { continue }
                events.append(.turnStarted)
                events.append(.message(TranscriptEntry(role: .user, text: text, timestamp: timestamp)))
            case "assistant":
                let text = PromptText.concatenatedText(message?["content"]).trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty {
                    events.append(.message(TranscriptEntry(role: .assistant, text: text, timestamp: timestamp)))
                }
                // Any stop_reason ends the turn except the two that mean "more is
                // coming". Closing only on `end_turn` left CHAT spinning until
                // the response timeout: live quota answers arrive with
                // `stop_sequence`, and a truncated one with `max_tokens`.
                if let stop = message?["stop_reason"] as? String,
                   stop != "tool_use", stop != "pause_turn" {
                    events.append(.turnEnded(outcome: .completed))
                }
            default:
                continue
            }
        }
        return events
    }
}

// Codex — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
// `task_started` / `task_complete` bracket every turn exactly.
public struct CodexAdapter: TranscriptAdapter {
    public init() {}

    public func events(from chunk: String) -> [TranscriptEvent] {
        var events: [TranscriptEvent] = []
        for line in chunk.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let object = JSONLine.object(line),
                  (object["type"] as? String) == "event_msg",
                  let payload = object["payload"] as? [String: Any] else { continue }
            let timestamp = JSONLine.date(object["timestamp"])

            switch payload["type"] as? String {
            case "user_message":
                let text = PromptText.stripReminders((payload["message"] as? String) ?? "")
                guard !text.isEmpty else { continue }
                events.append(.message(TranscriptEntry(role: .user, text: text, timestamp: timestamp)))
            case "agent_message":
                let text = ((payload["message"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                events.append(.message(TranscriptEntry(role: .assistant, text: text, timestamp: timestamp)))
            case "task_started":
                events.append(.turnStarted)
            case "task_complete":
                events.append(.turnEnded(outcome: .completed))
            case "turn_aborted":
                events.append(.turnEnded(outcome: .aborted))
            default:
                continue
            }
        }
        return events
    }
}

// Grok — `~/.grok/sessions/<percent-encoded cwd>/<session>/`.
// Messages live in `chat_history.jsonl`, turn boundaries in `events.jsonl`.
public struct GrokAdapter: TranscriptAdapter {
    public init() {}

    public func events(from chunk: String) -> [TranscriptEvent] {
        var events: [TranscriptEvent] = []
        for line in chunk.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let object = JSONLine.object(line) else { continue }
            // Grok keys the speaker on `type`, not `role`; `reasoning` entries
            // carry a null content and are internal.
            let role = object["type"] as? String
            let content = object["content"]

            switch role {
            case "user":
                // Only `<user_query>` blocks are real keystrokes; everything else
                // under this role is injected context.
                let raw = PromptText.concatenatedText(content)
                guard let text = PromptText.unwrapQuery(raw), !text.isEmpty else { continue }
                events.append(.message(TranscriptEntry(role: .user, text: text)))
            case "assistant":
                let text = PromptText.concatenatedText(content).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                events.append(.message(TranscriptEntry(role: .assistant, text: text)))
            default:
                continue
            }
        }
        return events
    }

    public func companionEvents(from chunk: String) -> [TranscriptEvent] {
        var events: [TranscriptEvent] = []
        for line in chunk.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let object = JSONLine.object(line) else { continue }
            switch object["type"] as? String {
            case "turn_started":
                events.append(.turnStarted)
            case "turn_ended":
                let outcome = (object["outcome"] as? String) == "completed" ? TurnOutcome.completed : .aborted
                events.append(.turnEnded(outcome: outcome))
            default:
                continue
            }
        }
        return events
    }
}

public func adapter(for provider: Provider) -> TranscriptAdapter {
    switch provider {
    case .anthropic: return ClaudeAdapter()
    case .openai: return CodexAdapter()
    case .grok: return GrokAdapter()
    }
}

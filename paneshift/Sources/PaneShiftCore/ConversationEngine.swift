import Foundation

// MARK: - Turn model

public struct TurnID: Hashable, Sendable, CustomStringConvertible {
    private let value: UUID
    public init() { value = UUID() }
    public var description: String { value.uuidString.prefix(8).lowercased() }
}

public enum TurnState: Equatable, Sendable {
    /// Keystrokes were handed to tmux; the provider has not recorded the prompt yet.
    case submitting
    /// The provider wrote our prompt into its own transcript. This is the real
    /// acknowledgement that replaces the old fixed 120 ms sleep.
    case running
    case completed
    /// The provider is alive but cannot answer (quota, interactive menu).
    case blocked(reason: String)
    case failed(reason: String, retryable: Bool)
    case cancelled

    public var isTerminal: Bool {
        switch self {
        case .submitting, .running: return false
        case .completed, .blocked, .failed, .cancelled: return true
        }
    }
}

public struct Turn: Identifiable, Equatable, Sendable {
    public let id: TurnID
    public var prompt: String
    public var response: String
    public var state: TurnState
    /// False for turns typed straight into the real terminal in TERM mode. They
    /// are still displayed, so CHAT always mirrors what actually happened.
    public var isLocal: Bool
    public var startedAt: Date

    public init(
        id: TurnID = TurnID(),
        prompt: String,
        response: String = "",
        state: TurnState = .running,
        isLocal: Bool = false,
        startedAt: Date = Date()
    ) {
        self.id = id
        self.prompt = prompt
        self.response = response
        self.state = state
        self.isLocal = isLocal
        self.startedAt = startedAt
    }
}

// MARK: - Provider availability

public enum ProviderHealth: Equatable, Sendable {
    case ready
    case working
    case blocked(reason: String)

    public var label: String {
        switch self {
        case .ready: return "ready"
        case .working: return "working"
        case .blocked(let reason): return "blocked · \(reason)"
        }
    }
}

/// A provider that answers with a quota or authentication error is alive but
/// unusable. The sidebar must not count it as a working agent.
public func blockReason(in response: String) -> String? {
    let lowered = response.lowercased()
    let signatures: [(String, String)] = [
        ("monthly spend limit", "spend limit reached"),
        ("usage limit reached", "usage limit reached"),
        ("rate limit", "rate limited"),
        ("/rate-limit-options", "rate limited"),
        ("quota exceeded", "quota exceeded"),
        ("insufficient credit", "out of credit"),
        ("please run /login", "not signed in"),
        ("authentication_error", "authentication failed"),
        ("invalid api key", "invalid API key")
    ]
    for (needle, label) in signatures where lowered.contains(needle) {
        return label
    }
    return nil
}

// MARK: - Engine

/// Folds a provider's transcript event stream into a conversation, and tracks
/// the acknowledgement of prompts submitted by PaneShift itself.
///
/// The engine is deliberately free of AppKit and of any wall-clock reads it does
/// not receive as arguments, so every scenario in the acceptance list is
/// reproducible in a unit test.
public final class ConversationEngine {
    public private(set) var turns: [Turn] = []
    public private(set) var health: ProviderHealth = .ready

    /// Prompt handed to tmux and still waiting to appear in the transcript.
    private struct PendingSubmission {
        let id: TurnID
        let prompt: String
        let sentAt: Date
        var retries: Int
    }
    private var pending: PendingSubmission?

    public var submissionTimeout: TimeInterval = 12
    /// A provider that records the prompt but produces nothing for this long is
    /// reported instead of spinning forever.
    public var responseTimeout: TimeInterval = 900
    public var historyLimit = 200

    public init() {}

    public var activeTurn: Turn? {
        turns.last(where: { !$0.state.isTerminal })
    }

    public var isBusy: Bool { activeTurn != nil }

    // MARK: Submission

    /// Registers a prompt as sent. The turn stays `.submitting` until the
    /// provider echoes it into its own transcript.
    @discardableResult
    public func registerSubmission(id: TurnID = TurnID(), prompt: String, now: Date = Date()) -> TurnID {
        pending = PendingSubmission(id: id, prompt: prompt, sentAt: now, retries: 0)
        turns.append(Turn(id: id, prompt: prompt, state: .submitting, isLocal: true, startedAt: now))
        trimHistory()
        return id
    }

    /// tmux itself refused the keystrokes — no need to wait for a transcript ack.
    public func failSubmission(_ id: TurnID, reason: String) {
        guard let index = turns.firstIndex(where: { $0.id == id }) else { return }
        turns[index].state = .failed(reason: reason, retryable: true)
        if pending?.id == id { pending = nil }
    }

    public func cancelActiveTurn() {
        guard let index = turns.lastIndex(where: { !$0.state.isTerminal }) else { return }
        turns[index].state = .cancelled
        if pending?.id == turns[index].id { pending = nil }
    }

    public func clear() {
        turns.removeAll()
        pending = nil
        health = .ready
    }

    /// History replayed from disk can end on a turn that was interrupted before
    /// the app started. Nothing will ever complete it, so it must not present as
    /// an in-flight turn.
    public func closeOpenTurnsFromHistory() {
        for index in turns.indices where !turns[index].state.isTerminal {
            // A turn PaneShift submitted in this session is live, not history.
            // Closing it here cancelled real prompts whenever the provider only
            // created its transcript file *after* the prompt was sent — the
            // first successful load then wiped the very turn it was waiting for.
            guard !turns[index].isLocal else { continue }
            if turns[index].response.isEmpty {
                turns[index].state = .cancelled
            } else if let reason = blockReason(in: turns[index].response) {
                turns[index].state = .blocked(reason: reason)
            } else {
                turns[index].state = .completed
            }
        }
        updateHealth()
    }

    // MARK: Ingestion

    public func ingest(_ events: [TranscriptEvent], now: Date = Date()) {
        for event in events {
            switch event {
            case .message(let entry) where entry.role == .user:
                acceptUserMessage(entry, now: now)
            case .message(let entry):
                acceptAssistantMessage(entry)
            case .turnStarted:
                continue
            case .turnEnded(let outcome):
                finishActiveTurn(outcome: outcome)
            }
        }
        trimHistory()
        updateHealth()
    }

    private func acceptUserMessage(_ entry: TranscriptEntry, now: Date) {
        // Our own prompt coming back from the provider: that is the ack.
        if let pending, matches(pending.prompt, entry.text),
           let index = turns.firstIndex(where: { $0.id == pending.id }) {
            turns[index].state = .running
            turns[index].startedAt = now
            self.pending = nil
            return
        }
        // A prompt typed directly into the real terminal. Mirror it so CHAT and
        // the terminal never tell different stories.
        turns.append(Turn(prompt: entry.text, state: .running, isLocal: false, startedAt: entry.timestamp ?? now))
    }

    private func acceptAssistantMessage(_ entry: TranscriptEntry) {
        guard let index = turns.lastIndex(where: { !$0.state.isTerminal }) else {
            // Output with no recorded prompt (resumed session, startup banner).
            if let reason = blockReason(in: entry.text) {
                turns.append(Turn(prompt: "", response: entry.text, state: .blocked(reason: reason), isLocal: false))
            } else {
                turns.append(Turn(prompt: "", response: entry.text, state: .completed, isLocal: false))
            }
            return
        }
        if turns[index].response.isEmpty {
            turns[index].response = entry.text
        } else {
            turns[index].response += "\n\n" + entry.text
        }
        // A prompt can be acknowledged by its answer alone when the provider
        // records assistant output before flushing the user entry.
        if case .submitting = turns[index].state {
            turns[index].state = .running
            if pending?.id == turns[index].id { pending = nil }
        }
        // Surface quota / auth failures as soon as the text arrives, even when
        // the provider never emits a clean turn-ended boundary.
        if let reason = blockReason(in: turns[index].response) {
            turns[index].state = .blocked(reason: reason)
            if pending?.id == turns[index].id { pending = nil }
        }
    }

    private func finishActiveTurn(outcome: TurnOutcome) {
        guard let index = turns.lastIndex(where: { !$0.state.isTerminal }) else { return }
        switch outcome {
        case .aborted:
            turns[index].state = .cancelled
        case .completed:
            if let reason = blockReason(in: turns[index].response) {
                turns[index].state = .blocked(reason: reason)
            } else {
                turns[index].state = .completed
            }
        }
        if pending?.id == turns[index].id { pending = nil }
    }

    // MARK: Timeouts

    /// Must be called on the refresh tick. Converts silence into a visible,
    /// retryable error rather than an endless spinner.
    public func tick(now: Date = Date(), terminalIsBusy: Bool) {
        if let pending, now.timeIntervalSince(pending.sentAt) >= submissionTimeout {
            if let index = turns.firstIndex(where: { $0.id == pending.id }) {
                turns[index].state = .failed(
                    reason: "The prompt never reached \(providerNoun). It may still be sitting in the terminal composer.",
                    retryable: true)
            }
            self.pending = nil
        }

        if let index = turns.lastIndex(where: { !$0.state.isTerminal }),
           case .running = turns[index].state,
           !terminalIsBusy,
           now.timeIntervalSince(turns[index].startedAt) >= responseTimeout {
            turns[index].state = .failed(reason: "No answer received before the timeout.", retryable: true)
        }
        updateHealth()
    }

    private var providerNoun: String { "the agent" }

    private func updateHealth() {
        if let last = turns.last, case .blocked(let reason) = last.state {
            health = .blocked(reason: reason)
        } else if isBusy {
            health = .working
        } else {
            health = .ready
        }
    }

    // MARK: Helpers

    /// Providers re-wrap and re-indent prompts. Compare on collapsed whitespace,
    /// and accept a prefix so a truncated echo still acknowledges the turn.
    private func matches(_ sent: String, _ recorded: String) -> Bool {
        let left = Self.normalise(sent)
        let right = Self.normalise(recorded)
        guard !left.isEmpty, !right.isEmpty else { return false }
        if left == right { return true }
        let shortest = min(left.count, right.count)
        guard shortest >= 8 else { return false }
        return left.hasPrefix(String(right.prefix(shortest))) || right.hasPrefix(String(left.prefix(shortest)))
    }

    static func normalise(_ value: String) -> String {
        value.split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
            .lowercased()
    }

    private func trimHistory() {
        guard turns.count > historyLimit else { return }
        turns.removeFirst(turns.count - historyLimit)
    }
}

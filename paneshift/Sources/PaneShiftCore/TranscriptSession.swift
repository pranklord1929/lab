import Foundation

/// Immutable view of a conversation, safe to hand to the UI thread.
public struct ConversationSnapshot: Sendable {
    public let turns: [Turn]
    public let health: ProviderHealth
    public let activeTurn: Turn?
    public let transcriptPath: String?
    public let isAttached: Bool
    /// False for a slot whose CLI writes no readable transcript.
    public let supportsTranscript: Bool

    public var isBusy: Bool { activeTurn != nil }

    static let unsupported = ConversationSnapshot(
        turns: [], health: .ready, activeTurn: nil,
        transcriptPath: nil, isAttached: false, supportsTranscript: false)
}

/// Binds one tmux pane to one provider transcript: locates the session file,
/// tails it incrementally, and folds new events into the conversation engine.
///
/// All mutable state is confined to one serial queue, and the UI only ever reads
/// an immutable published snapshot. Previously detached polling tasks mutated the
/// engine while the main thread read `turns` from it — an unsynchronised race
/// that could drop a turn or render a state that no longer existed.
public final class TranscriptSession: @unchecked Sendable {
    private let queue: DispatchQueue
    private let engine = ConversationEngine()

    private let locator: SessionLocator
    private var provider: Provider?
    private var workingDirectory: String
    private var parser: TranscriptAdapter?
    private let primaryTailer = TranscriptTailer()
    private let companionTailer = TranscriptTailer()
    private var location: TranscriptLocation?
    private var lastLocationLookup = Date.distantPast
    private var hasLoadedHistory = false

    private let snapshotLock = NSLock()
    private var publishedSnapshot: ConversationSnapshot

    /// Re-resolving the newest session file on every tick is wasteful; the file
    /// only changes when the provider restarts.
    private let locationRefreshInterval: TimeInterval = 5

    /// - Parameter provider: nil for a slot whose CLI has no readable transcript
    ///   (a `local` command). CHAT then says so plainly instead of silently
    ///   reading another provider's history.
    public init(provider: Provider?, workingDirectory: String, locator: SessionLocator = SessionLocator()) {
        self.provider = provider
        self.workingDirectory = workingDirectory
        self.locator = locator
        self.parser = provider.map(adapter(for:))
        self.queue = DispatchQueue(label: "paneshift.transcript", qos: .utility)
        self.publishedSnapshot = ConversationSnapshot(
            turns: [], health: .ready, activeTurn: nil,
            transcriptPath: nil, isAttached: false, supportsTranscript: provider != nil)
    }

    /// Never blocks: returns the last state published by the polling queue.
    public func snapshot() -> ConversationSnapshot {
        snapshotLock.lock()
        defer { snapshotLock.unlock() }
        return publishedSnapshot
    }

    // MARK: Mutations, all serialised on `queue`

    /// Records a prompt as sent. The turn stays `submitting` until the provider
    /// echoes it into its own transcript.
    public func registerSubmission(id: TurnID, prompt: String) {
        queue.async {
            self.engine.registerSubmission(id: id, prompt: prompt)
            self.publish()
        }
    }

    public func failSubmission(id: TurnID, reason: String) {
        queue.async {
            self.engine.failSubmission(id, reason: reason)
            self.publish()
        }
    }

    public func cancelActiveTurn() {
        queue.async {
            self.engine.cancelActiveTurn()
            self.publish()
        }
    }

    /// Called after a provider switch: the previous conversation belongs to a
    /// session that no longer exists and must not be shown under the new one.
    public func rebind(provider: Provider?, workingDirectory: String) {
        queue.async {
            self.provider = provider
            self.workingDirectory = workingDirectory
            self.parser = provider.map(adapter(for:))
            self.primaryTailer.reset()
            self.companionTailer.reset()
            self.location = nil
            self.lastLocationLookup = .distantPast
            self.hasLoadedHistory = false
            self.engine.clear()
            self.publish()
        }
    }

    /// Reads whatever the provider appended since the last call. `onChange` fires
    /// only when the conversation actually changed.
    public func poll(terminalIsBusy: Bool, onChange: (@Sendable (ConversationSnapshot) -> Void)? = nil) {
        queue.async {
            let changed = self.pollOnQueue(now: Date(), terminalIsBusy: terminalIsBusy)
            let snapshot = self.publish()
            if changed { onChange?(snapshot) }
        }
    }

    /// Synchronous variant for the CLI probes, which have no run loop to wait on.
    @discardableResult
    public func pollBlocking(now: Date = Date(), terminalIsBusy: Bool) -> ConversationSnapshot {
        queue.sync {
            _ = self.pollOnQueue(now: now, terminalIsBusy: terminalIsBusy)
            return self.publish()
        }
    }

    // MARK: Queue-confined implementation

    private func pollOnQueue(now: Date, terminalIsBusy: Bool) -> Bool {
        guard let parser else { return false }
        refreshLocationIfNeeded(now: now)
        let before = engine.turns

        if !hasLoadedHistory, let location {
            // Only mark history as loaded when the file actually yielded bytes.
            // A brand-new empty rollout would otherwise leave CHAT permanently
            // blind: every later poll would skip the history path and only
            // tail from offset 0 after a manual rebind.
            if loadExistingHistory(location, parser: parser, now: now) {
                hasLoadedHistory = true
            }
        } else {
            var events: [TranscriptEvent] = []
            if let chunk = primaryTailer.poll(location?.primary) {
                events += parser.events(from: chunk)
            }
            if let companion = location?.companion, let chunk = companionTailer.poll(companion) {
                events += parser.companionEvents(from: chunk)
            }
            // Primary messages then companion boundaries: for Codex and Claude
            // there is a single stream, and for Grok `turn_ended` arriving after
            // the messages of the same poll is what live sessions actually show.
            if !events.isEmpty { engine.ingest(events, now: now) }
        }

        engine.tick(now: now, terminalIsBusy: terminalIsBusy)
        return engine.turns != before
    }

    /// Rebuilds the visible conversation after an app restart, so CHAT shows the
    /// real session instead of an empty pane.
    /// - Returns: true when the file had content to ingest (even if zero events).
    @discardableResult
    private func loadExistingHistory(_ location: TranscriptLocation, parser: TranscriptAdapter, now: Date) -> Bool {
        guard let chunk = primaryTailer.poll(location.primary) else { return false }
        var events = parser.events(from: chunk)
        if let companion = location.companion, let companionChunk = companionTailer.poll(companion) {
            events += parser.companionEvents(from: companionChunk)
        }
        engine.ingest(events, now: now)
        // Anything already on disk is finished history; nothing there is still
        // streaming towards us — except a live local submission, which
        // closeOpenTurnsFromHistory now preserves.
        engine.closeOpenTurnsFromHistory()
        return true
    }

    private func refreshLocationIfNeeded(now: Date) {
        // A pane with no session yet (a CLI that has never run a task) must keep
        // looking, but locating a Codex rollout means scanning its session tree —
        // too expensive to repeat on every 1.2 s tick.
        let interval = location == nil ? 2 : locationRefreshInterval
        if now.timeIntervalSince(lastLocationLookup) < interval { return }
        lastLocationLookup = now
        guard let provider else { return }
        let resolved = locator.locate(provider: provider, workingDirectory: workingDirectory)
        guard resolved != location else { return }
        if location != nil, resolved?.primary != location?.primary {
            // The provider started a new session (restart, /clear, respawn).
            primaryTailer.reset()
            companionTailer.reset()
            hasLoadedHistory = false
        }
        location = resolved
    }

    @discardableResult
    private func publish() -> ConversationSnapshot {
        let snapshot = ConversationSnapshot(
            turns: engine.turns,
            health: engine.health,
            activeTurn: engine.activeTurn,
            transcriptPath: location?.primary.path,
            isAttached: location != nil,
            supportsTranscript: parser != nil)
        snapshotLock.lock()
        publishedSnapshot = snapshot
        snapshotLock.unlock()
        return snapshot
    }
}

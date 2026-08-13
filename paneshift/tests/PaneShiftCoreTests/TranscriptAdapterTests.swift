import XCTest
@testable import PaneShiftCore

/// Fixtures mirror the exact record shapes emitted by the installed CLIs
/// (verified against live session logs on 2026-07-31). If a provider changes its
/// format, these fail loudly instead of CHAT silently going blank.
final class TranscriptAdapterTests: XCTestCase {

    // MARK: Claude Code

    private let claudeChunk = """
    {"type":"user","isSidechain":false,"timestamp":"2026-07-31T12:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"deux et deux ?"}]}}
    {"type":"assistant","isSidechain":false,"timestamp":"2026-07-31T12:00:01.000Z","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"text","text":"Je vérifie."}]}}
    {"type":"user","isSidechain":false,"timestamp":"2026-07-31T12:00:02.000Z","toolUseResult":{"ok":true},"message":{"role":"user","content":[{"type":"tool_result","content":"4"}]}}
    {"type":"assistant","isSidechain":false,"timestamp":"2026-07-31T12:00:03.000Z","message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"Quatre."}]}}
    """

    func testClaudeExtractsPromptAndAnswerAndIgnoresToolTraffic() {
        let events = ClaudeAdapter().events(from: claudeChunk)
        let messages = events.compactMap { event -> TranscriptEntry? in
            if case .message(let entry) = event { return entry }
            return nil
        }
        // The tool_result replayed under the user role must not look like a prompt.
        XCTAssertEqual(messages.filter { $0.role == .user }.map(\.text), ["deux et deux ?"])
        XCTAssertEqual(messages.filter { $0.role == .assistant }.map(\.text), ["Je vérifie.", "Quatre."])
        XCTAssertEqual(events.filter { $0 == .turnEnded(outcome: .completed) }.count, 1)
    }

    /// Audit 2026-07-31 C4: both live Claude sessions ended every assistant
    /// message with `stop_sequence`, never `end_turn`. Closing the turn only on
    /// `end_turn` left CHAT spinning until the 900 s timeout on an answer that
    /// was already fully written to the transcript.
    func testClaudeEndsTheTurnOnAnyTerminalStopReason() {
        for reason in ["end_turn", "stop_sequence", "max_tokens", "refusal"] {
            let chunk = """
            {"type":"assistant","isSidechain":false,"message":{"role":"assistant","stop_reason":"\(reason)","content":[{"type":"text","text":"fini"}]}}
            """
            XCTAssertTrue(
                ClaudeAdapter().events(from: chunk).contains(.turnEnded(outcome: .completed)),
                "stop_reason \(reason) must end the turn")
        }
    }

    func testClaudeKeepsTheTurnOpenWhileToolsRun() {
        for reason in ["tool_use", "pause_turn"] {
            let chunk = """
            {"type":"assistant","isSidechain":false,"message":{"role":"assistant","stop_reason":"\(reason)","content":[{"type":"text","text":"je vérifie"}]}}
            """
            XCTAssertFalse(
                ClaudeAdapter().events(from: chunk).contains(.turnEnded(outcome: .completed)),
                "stop_reason \(reason) means the turn continues")
        }
    }

    func testClaudeIgnoresSubagentOutput() {
        let chunk = """
        {"type":"assistant","isSidechain":true,"message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"sous-agent"}]}}
        """
        XCTAssertTrue(ClaudeAdapter().events(from: chunk).isEmpty)
    }

    func testClaudeStripsSystemReminders() {
        let chunk = """
        {"type":"user","isSidechain":false,"message":{"role":"user","content":[{"type":"text","text":"<system-reminder>bruit</system-reminder>vrai prompt"}]}}
        """
        let events = ClaudeAdapter().events(from: chunk)
        guard case .message(let entry)? = events.first(where: { if case .message = $0 { return true }; return false })
        else { return XCTFail("no message parsed") }
        XCTAssertEqual(entry.text, "vrai prompt")
    }

    // MARK: Codex

    private let codexChunk = """
    {"type":"event_msg","timestamp":"2026-07-31T12:00:00.000Z","payload":{"type":"task_started"}}
    {"type":"event_msg","timestamp":"2026-07-31T12:00:00.100Z","payload":{"type":"user_message","message":"salut"}}
    {"type":"response_item","payload":{"type":"reasoning","content":[]}}
    {"type":"event_msg","timestamp":"2026-07-31T12:00:02.000Z","payload":{"type":"agent_message","message":"Salut 👋"}}
    {"type":"event_msg","timestamp":"2026-07-31T12:00:02.100Z","payload":{"type":"task_complete"}}
    """

    func testCodexUsesTaskBoundaries() {
        let events = CodexAdapter().events(from: codexChunk)
        XCTAssertEqual(events.first, .turnStarted)
        XCTAssertEqual(events.last, .turnEnded(outcome: .completed))
        let messages = events.compactMap { event -> TranscriptEntry? in
            if case .message(let entry) = event { return entry }
            return nil
        }
        XCTAssertEqual(messages.map(\.text), ["salut", "Salut 👋"])
    }

    // MARK: Grok

    private let grokChunk = """
    {"type":"system","content":"You are Grok."}
    {"type":"user","content":[{"type":"text","text":"<system-reminder>contexte</system-reminder>"}]}
    {"type":"user","content":[{"type":"text","text":"<user_query>\\nyo\\n</user_query>"}],"prompt_index":0}
    {"type":"reasoning","content":null}
    {"type":"assistant","content":"Yo. What are we working on?"}
    """

    func testGrokKeysOnTypeAndOnlyKeepsUserQueries() {
        let messages = GrokAdapter().events(from: grokChunk).compactMap { event -> TranscriptEntry? in
            if case .message(let entry) = event { return entry }
            return nil
        }
        // Injected context shares the `user` type and must not become a prompt.
        XCTAssertEqual(messages.map(\.role), [.user, .assistant])
        XCTAssertEqual(messages.map(\.text), ["yo", "Yo. What are we working on?"])
    }

    func testGrokReadsTurnBoundariesFromCompanionEvents() {
        let events = GrokAdapter().companionEvents(from: """
        {"ts":"2026-07-31T12:56:43.380Z","type":"phase_changed","phase":"streaming_text"}
        {"ts":"2026-07-31T12:56:43.467Z","type":"turn_ended","outcome":"completed"}
        """)
        XCTAssertEqual(events, [.turnEnded(outcome: .completed)])
    }

    // MARK: Robustness

    func testPartiallyWrittenLineIsSkippedNotCrashed() {
        // Providers append while we read; a truncated final line is normal.
        let chunk = codexChunk + "\n{\"type\":\"event_msg\",\"payl"
        XCTAssertEqual(CodexAdapter().events(from: chunk).last, .turnEnded(outcome: .completed))
    }

    // MARK: Session location

    func testClaudeProjectNameMatchesInstalledLayout() {
        XCTAssertEqual(
            SessionLocator.claudeProjectName("/Users/x/Desktop/02_DEV/PANESHIFT-WORKTREES/claude-1"),
            "-Users-x-Desktop-02-DEV-PANESHIFT-WORKTREES-claude-1")
    }

    func testGrokDirectoryKeyMatchesInstalledLayout() {
        XCTAssertEqual(
            SessionLocator.grokDirectoryKey("/Users/x/Desktop/02_DEV/PANESHIFT-WORKTREES/grok-1"),
            "%2FUsers%2Fx%2FDesktop%2F02_DEV%2FPANESHIFT-WORKTREES%2Fgrok-1")
    }
}

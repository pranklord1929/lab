import XCTest
@testable import PaneShiftCore

/// These cover the acceptance scenarios from the 2026-07-31 audit — the ones the
/// old CHAT failed in production with no test able to catch it.
final class ConversationEngineTests: XCTestCase {

    private func userEvent(_ text: String) -> TranscriptEvent {
        .message(TranscriptEntry(role: .user, text: text))
    }

    private func assistantEvent(_ text: String) -> TranscriptEvent {
        .message(TranscriptEntry(role: .assistant, text: text))
    }

    // MARK: Two consecutive turns — the bug that always came back on message two

    func testTwoConsecutiveTurnsBothComplete() {
        let engine = ConversationEngine()

        engine.registerSubmission(prompt: "premier")
        XCTAssertEqual(engine.activeTurn?.state, .submitting)
        engine.ingest([userEvent("premier"), assistantEvent("un"), .turnEnded(outcome: .completed)])
        XCTAssertNil(engine.activeTurn, "the first turn must release the input")

        engine.registerSubmission(prompt: "second")
        engine.ingest([userEvent("second"), assistantEvent("deux"), .turnEnded(outcome: .completed)])

        XCTAssertNil(engine.activeTurn)
        XCTAssertEqual(engine.turns.count, 2)
        XCTAssertEqual(engine.turns.map(\.response), ["un", "deux"])
        XCTAssertTrue(engine.turns.allSatisfy { $0.state == .completed })
    }

    // MARK: Acknowledgement

    func testPromptStaysSubmittingUntilTheProviderRecordsIt() {
        let engine = ConversationEngine()
        engine.registerSubmission(prompt: "coucou")
        engine.ingest([])
        XCTAssertEqual(engine.activeTurn?.state, .submitting)

        engine.ingest([userEvent("coucou")])
        XCTAssertEqual(engine.activeTurn?.state, .running)
    }

    func testAcknowledgementToleratesReflowedWhitespace() {
        let engine = ConversationEngine()
        engine.registerSubmission(prompt: "explique   moi\nle  bug")
        engine.ingest([userEvent("explique moi le bug")])
        XCTAssertEqual(engine.activeTurn?.state, .running)
    }

    /// A prompt left sitting in the composer, exactly like CODEX-2 during the
    /// audit: the terminal accepted the keystrokes but the CLI never took it.
    func testUnacknowledgedPromptFailsInsteadOfSpinningForever() {
        let engine = ConversationEngine()
        let start = Date()
        engine.registerSubmission(prompt: "yo", now: start)

        engine.tick(now: start.addingTimeInterval(5), terminalIsBusy: false)
        XCTAssertEqual(engine.activeTurn?.state, .submitting)

        engine.tick(now: start.addingTimeInterval(13), terminalIsBusy: false)
        XCTAssertNil(engine.activeTurn, "a stuck draft must not keep the spinner alive")
        guard case .failed(_, let retryable)? = engine.turns.last?.state else {
            return XCTFail("expected a failed turn, got \(String(describing: engine.turns.last?.state))")
        }
        XCTAssertTrue(retryable)
    }

    // MARK: Long answers

    /// The old CHAT finalised a turn after 1.5 s of stable text, truncating any
    /// answer that paused mid-stream.
    func testLongPauseDoesNotTruncateTheAnswer() {
        let engine = ConversationEngine()
        let start = Date()
        engine.registerSubmission(prompt: "raconte", now: start)
        engine.ingest([userEvent("raconte"), assistantEvent("Premier paragraphe.")], now: start)

        // Nine seconds of silence while the model keeps thinking.
        engine.tick(now: start.addingTimeInterval(9), terminalIsBusy: true)
        XCTAssertEqual(engine.activeTurn?.state, .running)

        engine.ingest([assistantEvent("Second paragraphe."), .turnEnded(outcome: .completed)])
        XCTAssertEqual(engine.turns.last?.response, "Premier paragraphe.\n\nSecond paragraphe.")
        XCTAssertEqual(engine.turns.last?.state, .completed)
    }

    // MARK: Provider unavailable

    func testQuotaAnswerIsReportedAsBlockedNotAsASuccess() {
        let engine = ConversationEngine()
        engine.registerSubmission(prompt: "yo")
        engine.ingest([
            userEvent("yo"),
            assistantEvent("You've hit your monthly spend limit · raise it at claude.ai/settings/usage"),
            .turnEnded(outcome: .completed)
        ])
        guard case .blocked(let reason)? = engine.turns.last?.state else {
            return XCTFail("expected blocked, got \(String(describing: engine.turns.last?.state))")
        }
        XCTAssertEqual(reason, "spend limit reached")
        XCTAssertEqual(engine.health, .blocked(reason: "spend limit reached"))
        XCTAssertNil(engine.activeTurn, "a blocked provider must still release the input")
    }

    /// Quota text alone (no turnEnded) must still free the input — Claude live
    /// often never emits a clean boundary after a spend-limit message.
    func testQuotaTextBlocksWithoutTurnEndedBoundary() {
        let engine = ConversationEngine()
        engine.registerSubmission(prompt: "yo")
        engine.ingest([
            userEvent("yo"),
            assistantEvent("You've hit your monthly spend limit · raise it at claude.ai/settings/usage")
        ])
        guard case .blocked = engine.turns.last?.state else {
            return XCTFail("expected blocked from assistant text alone, got \(String(describing: engine.turns.last?.state))")
        }
        XCTAssertNil(engine.activeTurn)
    }

    // MARK: Cancellation and transport failure

    func testCancelReleasesTheInput() {
        let engine = ConversationEngine()
        engine.registerSubmission(prompt: "trop long")
        engine.ingest([userEvent("trop long")])
        engine.cancelActiveTurn()
        XCTAssertNil(engine.activeTurn)
        XCTAssertEqual(engine.turns.last?.state, .cancelled)
    }

    func testTmuxRefusalIsSurfacedImmediately() {
        let engine = ConversationEngine()
        let id = engine.registerSubmission(prompt: "salut")
        engine.failSubmission(id, reason: "tmux refused this prompt.")
        XCTAssertNil(engine.activeTurn)
        guard case .failed = engine.turns.last?.state else { return XCTFail("expected failed") }
    }

    // MARK: Terminal-typed turns

    /// Anything typed straight into TERM must appear in CHAT too, so the two
    /// views never tell different stories.
    func testTurnsTypedInTheRealTerminalAreMirrored() {
        let engine = ConversationEngine()
        engine.ingest([userEvent("tapé dans le terminal"), assistantEvent("ok"), .turnEnded(outcome: .completed)])
        XCTAssertEqual(engine.turns.count, 1)
        XCTAssertFalse(engine.turns[0].isLocal)
        XCTAssertEqual(engine.turns[0].prompt, "tapé dans le terminal")
    }

    // MARK: Provider switch isolation

    func testClearRemovesTheTranscriptOfThePreviousProvider() {
        let engine = ConversationEngine()
        engine.registerSubmission(prompt: "ancien")
        engine.ingest([userEvent("ancien"), assistantEvent("ancienne réponse")])
        engine.clear()
        XCTAssertTrue(engine.turns.isEmpty)
        XCTAssertNil(engine.activeTurn, "a switch must not inherit the previous spinner")
        XCTAssertEqual(engine.health, .ready)
    }

    // MARK: Restart

    /// Audit 2026-07-31 C2, reproduced live on CODEX-2: the transcript file did
    /// not exist yet when the prompt was submitted. The moment the provider
    /// created it, the history replay treated the in-flight local turn as an
    /// abandoned one and cancelled it — while the CLI went on to answer.
    func testFirstHistoryLoadDoesNotCancelALivePrompt() {
        let engine = ConversationEngine()
        engine.registerSubmission(prompt: "Réponds exactement: CODEX2_OK")

        // The session file appears and its existing history is replayed.
        engine.closeOpenTurnsFromHistory()
        XCTAssertNotNil(engine.activeTurn, "a prompt submitted by PaneShift is live, not history")

        // The provider then records the prompt and answers it.
        engine.ingest([
            userEvent("Réponds exactement: CODEX2_OK"),
            assistantEvent("CODEX2_OK"),
            .turnEnded(outcome: .completed)
        ])
        XCTAssertEqual(engine.turns.count, 1)
        XCTAssertEqual(engine.turns.last?.response, "CODEX2_OK")
        XCTAssertEqual(engine.turns.last?.state, .completed)
    }

    func testHistoryReplayNeverLeavesATurnRunning() {
        let engine = ConversationEngine()
        // The app restarted mid-answer: nothing will ever close this turn.
        engine.ingest([userEvent("avant le redémarrage"), assistantEvent("réponse partielle")])
        XCTAssertNotNil(engine.activeTurn)

        engine.closeOpenTurnsFromHistory()
        XCTAssertNil(engine.activeTurn)
        XCTAssertEqual(engine.turns.last?.state, .completed)
    }
}

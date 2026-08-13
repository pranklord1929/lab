// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OracleAdapter
/// @notice Admin-controlled oracle that stores match results and Polymarket odds.
///         The odds (winnerOddsBps) are fetched from Polymarket before kickoff and
///         stored alongside the final score so PayoutDistributor can compute upsets.
contract OracleAdapter {

    // ── Types ─────────────────────────────────────────────────────────────────

    struct MatchResult {
        uint8  homeGoals;
        uint8  awayGoals;
        uint32 winnerOddsBps; // implied probability of the ACTUAL winner at kickoff
                               // e.g. Germany 63.5% → 6350. Used for upset bonus.
        bool   resolved;
    }

    // ── State ─────────────────────────────────────────────────────────────────

    address public immutable admin;

    mapping(uint32 => MatchResult) private _results;

    // Human-readable label stored off-chain via event (e.g. "fifwc-ger-civ-2026-06-20")
    mapping(uint32 => string) public matchSlugs;

    // ── Events ────────────────────────────────────────────────────────────────

    event MatchResolved(
        uint32  indexed matchId,
        string  slug,
        uint8   homeGoals,
        uint8   awayGoals,
        uint32  winnerOddsBps
    );

    event MatchRegistered(uint32 indexed matchId, string slug);

    // ── Errors ────────────────────────────────────────────────────────────────

    error NotAdmin();
    error AlreadyResolved();
    error NotResolved();
    error InvalidScore();
    error InvalidOdds();
    error SlugRequired();

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address admin_) {
        admin = admin_;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// @notice Register a match slug before the game (optional but useful for tracking).
    function registerMatch(uint32 matchId, string calldata slug) external {
        if (msg.sender != admin) revert NotAdmin();
        if (bytes(slug).length == 0) revert SlugRequired();
        matchSlugs[matchId] = slug;
        emit MatchRegistered(matchId, slug);
    }

    /// @notice Record the final result once the match is over.
    /// @param matchId       Internal ID (e.g. 1, 2, 3 …)
    /// @param homeGoals     Actual home team goals
    /// @param awayGoals     Actual away team goals
    /// @param winnerOddsBps Polymarket implied probability of the winner at kickoff × 10000
    ///                      For a draw, use the draw market price × 10000.
    function setResult(
        uint32 matchId,
        uint8  homeGoals,
        uint8  awayGoals,
        uint32 winnerOddsBps
    ) external {
        if (msg.sender != admin) revert NotAdmin();
        if (_results[matchId].resolved) revert AlreadyResolved();
        if (homeGoals > 20 || awayGoals > 20) revert InvalidScore();
        if (winnerOddsBps == 0 || winnerOddsBps > 10000) revert InvalidOdds();

        _results[matchId] = MatchResult({
            homeGoals:     homeGoals,
            awayGoals:     awayGoals,
            winnerOddsBps: winnerOddsBps,
            resolved:      true
        });

        emit MatchResolved(
            matchId,
            matchSlugs[matchId],
            homeGoals,
            awayGoals,
            winnerOddsBps
        );
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getResult(uint32 matchId)
        external view
        returns (uint8 homeGoals, uint8 awayGoals, uint32 winnerOddsBps)
    {
        MatchResult storage r = _results[matchId];
        if (!r.resolved) revert NotResolved();
        return (r.homeGoals, r.awayGoals, r.winnerOddsBps);
    }

    function isResolved(uint32 matchId) external view returns (bool) {
        return _results[matchId].resolved;
    }
}

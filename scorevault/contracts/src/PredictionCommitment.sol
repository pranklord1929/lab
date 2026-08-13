// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILeagueMembership {
    function hasJoined(address player) external view returns (bool);
}

/// @title PredictionCommitment
/// @notice Players submit score predictions before each match's lock time.
///         After lock, predictions are frozen and readable by PayoutDistributor.
contract PredictionCommitment {

    // ── Types ────────────────────────────────────────────────────────────────

    struct Match {
        uint256 lockTime;   // unix timestamp — predictions close at kickoff
        bool    registered;
    }

    struct Prediction {
        uint8 home;
        uint8 away;
        bool  submitted;
    }

    // ── State ────────────────────────────────────────────────────────────────

    address public immutable admin;
    ILeagueMembership public immutable leagueVault;

    mapping(uint32 => Match)                          public matches;
    mapping(address => mapping(uint32 => Prediction)) public predictions;

    // Track which players submitted for a match (for PayoutDistributor to iterate)
    mapping(uint32 => address[]) private _submitters;
    mapping(uint32 => mapping(address => bool)) private _hasSubmitted;

    // ── Events ───────────────────────────────────────────────────────────────

    event MatchRegistered(uint32 indexed matchId, uint256 lockTime);
    event PredictionSubmitted(address indexed player, uint32 indexed matchId, uint8 home, uint8 away);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotAdmin();
    error MatchNotRegistered();
    error MatchAlreadyRegistered();
    error PredictionsLocked();
    error LockTimeInPast();
    error InvalidScore();
    error NotLeaguePlayer();

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address admin_, address leagueVault_) {
        admin = admin_;
        leagueVault = ILeagueMembership(leagueVault_);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// @notice Register a match and set when predictions close (kickoff time).
    function registerMatch(uint32 matchId, uint256 lockTime) external {
        if (msg.sender != admin) revert NotAdmin();
        if (matches[matchId].registered) revert MatchAlreadyRegistered();
        if (lockTime <= block.timestamp) revert LockTimeInPast();

        matches[matchId] = Match({ lockTime: lockTime, registered: true });
        emit MatchRegistered(matchId, lockTime);
    }

    /// @notice Move a match's lock time earlier (e.g. kickoff brought forward).
    ///         Can only tighten the deadline, never extend it — prevents abuse.
    function tightenLock(uint32 matchId, uint256 newLockTime) external {
        if (msg.sender != admin) revert NotAdmin();
        if (!matches[matchId].registered) revert MatchNotRegistered();
        if (newLockTime >= matches[matchId].lockTime) revert LockTimeInPast();
        if (newLockTime <= block.timestamp) revert LockTimeInPast();

        matches[matchId].lockTime = newLockTime;
    }

    // ── Player ───────────────────────────────────────────────────────────────

    /// @notice Submit or update a prediction for a match. Scores capped at 20.
    function submitPrediction(uint32 matchId, uint8 predHome, uint8 predAway) external {
        Match storage m = matches[matchId];
        if (!m.registered) revert MatchNotRegistered();
        if (block.timestamp >= m.lockTime) revert PredictionsLocked();
        if (predHome > 20 || predAway > 20) revert InvalidScore();
        if (!leagueVault.hasJoined(msg.sender)) revert NotLeaguePlayer();

        // Track submitter list (only add once)
        if (!_hasSubmitted[matchId][msg.sender]) {
            _hasSubmitted[matchId][msg.sender] = true;
            _submitters[matchId].push(msg.sender);
        }

        predictions[msg.sender][matchId] = Prediction({
            home: predHome,
            away: predAway,
            submitted: true
        });

        emit PredictionSubmitted(msg.sender, matchId, predHome, predAway);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function isLocked(uint32 matchId) public view returns (bool) {
        return matches[matchId].registered && block.timestamp >= matches[matchId].lockTime;
    }

    function getPrediction(address player, uint32 matchId)
        external view
        returns (uint8 home, uint8 away, bool submitted)
    {
        Prediction memory p = predictions[player][matchId];
        return (p.home, p.away, p.submitted);
    }

    /// @notice Returns all players who submitted a prediction for a given match.
    ///         Used by PayoutDistributor to iterate and score everyone.
    function getSubmitters(uint32 matchId) external view returns (address[] memory) {
        return _submitters[matchId];
    }
}

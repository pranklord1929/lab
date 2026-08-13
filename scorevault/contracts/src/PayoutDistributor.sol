// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ── Minimal interfaces ────────────────────────────────────────────────────────

interface IScoreEngine {
    function calcPoints(
        uint8 predHome, uint8 predAway,
        uint8 realHome, uint8 realAway,
        uint32 oddsBps
    ) external pure returns (uint32);
}

interface IPredictionCommitment {
    function getPrediction(address player, uint32 matchId)
        external view returns (uint8 home, uint8 away, bool submitted);
    function getSubmitters(uint32 matchId) external view returns (address[] memory);
}

interface IOracleAdapter {
    function getResult(uint32 matchId)
        external view returns (uint8 homeGoals, uint8 awayGoals, uint32 winnerOddsBps);
    function isResolved(uint32 matchId) external view returns (bool);
}

interface ILeagueVault {
    function getPlayers() external view returns (address[] memory);
    function totalPool() external view returns (uint256);
    function distribute(address[] calldata recipients, uint256[] calldata amounts) external;
}

// ── Contract ──────────────────────────────────────────────────────────────────

/// @title PayoutDistributor
/// @notice Reads picks + results, accumulates points, computes prize payouts.
///         Handles ties: tied players merge their prize tiers and split equally.
contract PayoutDistributor {

    // ── State ─────────────────────────────────────────────────────────────────

    address public immutable admin;

    IScoreEngine           public immutable scoreEngine;
    IPredictionCommitment  public immutable predictions;
    IOracleAdapter         public immutable oracle;
    ILeagueVault           public immutable vault;

    // e.g. [6000, 3000, 1000] = 60 / 30 / 10 % — must sum to 10000
    uint16[3] public payoutBps;

    mapping(address => uint32) public totalPoints;
    mapping(uint32  => bool)   public matchProcessed;

    // ── Events ────────────────────────────────────────────────────────────────

    event MatchScored(uint32 indexed matchId, uint256 playersScored);
    event PayoutsReady(address[] players, uint256[] amounts);
    event PayoutsDistributed(address[] players, uint256[] amounts);

    // ── Errors ────────────────────────────────────────────────────────────────

    error NotAdmin();
    error MatchNotResolved();
    error AlreadyProcessed();
    error InvalidPayoutBps();
    error NoPlayers();

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address admin_,
        address scoreEngine_,
        address predictions_,
        address oracle_,
        address vault_,
        uint16[3] memory payoutBps_   // [6000, 3000, 1000]
    ) {
        uint256 sum = uint256(payoutBps_[0]) + payoutBps_[1] + payoutBps_[2];
        if (sum != 10000) revert InvalidPayoutBps();

        admin       = admin_;
        scoreEngine = IScoreEngine(scoreEngine_);
        predictions = IPredictionCommitment(predictions_);
        oracle      = IOracleAdapter(oracle_);
        vault       = ILeagueVault(vault_);
        payoutBps   = payoutBps_;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// @notice Process one match: score every player who submitted a prediction.
    ///         Call this once per match after the oracle has the result.
    function computeMatch(uint32 matchId) external {
        if (msg.sender != admin) revert NotAdmin();
        if (!oracle.isResolved(matchId)) revert MatchNotResolved();
        if (matchProcessed[matchId]) revert AlreadyProcessed();

        matchProcessed[matchId] = true;

        (uint8 realHome, uint8 realAway, uint32 winnerOddsBps) = oracle.getResult(matchId);
        address[] memory submitters = predictions.getSubmitters(matchId);

        for (uint256 i = 0; i < submitters.length; i++) {
            (uint8 predHome, uint8 predAway, bool submitted) =
                predictions.getPrediction(submitters[i], matchId);

            if (!submitted) continue;

            uint32 pts = scoreEngine.calcPoints(
                predHome, predAway,
                realHome, realAway,
                winnerOddsBps
            );

            totalPoints[submitters[i]] += pts;
        }

        emit MatchScored(matchId, submitters.length);
    }

    /// @notice Compute final payouts and release the vault pool in one transaction.
    ///         Admin controls timing, but payout amounts are derived from on-chain points.
    function distributeComputedPayouts() external {
        if (msg.sender != admin) revert NotAdmin();

        (address[] memory players, uint256[] memory amounts) = _computePayouts();
        vault.distribute(players, amounts);

        emit PayoutsDistributed(players, amounts);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    /// @notice Returns all vault players sorted by total points (descending).
    function getLeaderboard()
        external view
        returns (address[] memory players, uint32[] memory points)
    {
        players = vault.getPlayers();
        uint256 n = players.length;
        points = new uint32[](n);

        for (uint256 i = 0; i < n; i++) {
            points[i] = totalPoints[players[i]];
        }

        _sortDesc(players, points);
    }

    /// @notice Compute the payout arrays ready to pass directly to LeagueVault.distribute().
    ///         Ties are handled: tied players merge their prize tiers and split equally.
    function computePayouts()
        external view
        returns (address[] memory players, uint256[] memory amounts)
    {
        return _computePayouts();
    }

    function _computePayouts()
        internal view
        returns (address[] memory players, uint256[] memory amounts)
    {
        players = vault.getPlayers();
        uint256 n = players.length;
        if (n == 0) revert NoPlayers();

        uint256 pool = vault.totalPool();
        amounts = new uint256[](n);

        // Build parallel points array and sort both descending
        uint32[] memory pts = new uint32[](n);
        for (uint256 ii = 0; ii < n; ii++) {
            pts[ii] = totalPoints[players[ii]];
        }
        _sortDesc(players, pts);

        uint256 tierIdx   = 0; // which payout tier we're assigning next
        uint256 i         = 0; // player index
        uint256 totalPaid = 0;

        while (i < n && tierIdx < 3) {
            // Find the end of the tied group starting at i
            uint256 j = i + 1;
            while (j < n && pts[j] == pts[i]) j++;

            uint256 groupSize = j - i;

            // Sum tiers consumed by this group (cap at remaining tiers)
            uint256 groupBps = 0;
            uint256 tiersConsumed = 0;
            for (uint256 k = tierIdx; k < tierIdx + groupSize && k < 3; k++) {
                groupBps += payoutBps[k];
                tiersConsumed++;
            }

            // Total prize for the group, split equally
            uint256 groupTotal = (pool * groupBps) / 10000;
            uint256 perPlayer  = groupTotal / groupSize;

            for (uint256 k = i; k < j; k++) {
                amounts[k] = perPlayer;
                totalPaid += perPlayer;
            }

            tierIdx += tiersConsumed;
            i        = j;
        }

        // Rounding dust → first place (winner always gets at least as much as expected)
        if (totalPaid < pool && n > 0) {
            amounts[0] += pool - totalPaid;
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// @dev Insertion sort — descending by pts. Fine for n ≤ 50 players.
    function _sortDesc(address[] memory addrs, uint32[] memory pts) internal pure {
        uint256 n = addrs.length;
        for (uint256 i = 1; i < n; i++) {
            uint32  keyPts  = pts[i];
            address keyAddr = addrs[i];
            int256  j       = int256(i) - 1;
            while (j >= 0 && pts[uint256(j)] < keyPts) {
                pts[uint256(j + 1)]  = pts[uint256(j)];
                addrs[uint256(j + 1)] = addrs[uint256(j)];
                j--;
            }
            pts[uint256(j + 1)]  = keyPts;
            addrs[uint256(j + 1)] = keyAddr;
        }
    }
}

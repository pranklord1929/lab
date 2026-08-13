// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ScoreEngine
/// @notice Pure scoring logic for ScoreVault predictions. No storage, no funds — just maths.
contract ScoreEngine {
    // Points constants (same values as the JS demo)
    uint32 public constant EXACT_SCORE_BONUS = 3;   // predicted exact scoreline
    uint32 public constant CORRECT_RESULT_BASE = 1; // got win/draw/loss right
    uint32 public constant UPSET_BONUS_BPS_THRESHOLD = 6500; // odds > 65% = not an upset

    /// @notice Calculate points for a single prediction.
    /// @param predHome  Predicted goals for home team (0-99)
    /// @param predAway  Predicted goals for away team (0-99)
    /// @param realHome  Actual goals for home team
    /// @param realAway  Actual goals for away team
    /// @param oddsBps   Implied probability from Polymarket × 10000
    ///                  (e.g. 54% → 5400, meaning the predicted winner was 54% favourite)
    /// @return pts      Total points earned
    function calcPoints(
        uint8 predHome,
        uint8 predAway,
        uint8 realHome,
        uint8 realAway,
        uint32 oddsBps
    ) public pure returns (uint32 pts) {
        // Determine predicted and actual outcomes: 0=home win, 1=draw, 2=away win
        uint8 predOutcome = _outcome(predHome, predAway);
        uint8 realOutcome = _outcome(realHome, realAway);

        // No points if the result direction is wrong
        if (predOutcome != realOutcome) return 0;

        // Base point for correct result
        pts = CORRECT_RESULT_BASE;

        // Bonus for exact scoreline
        if (predHome == realHome && predAway == realAway) {
            pts += EXACT_SCORE_BONUS;
        }

        // Upset bonus: predicted winner was the underdog (odds < 65%)
        // oddsBps is the probability of the ACTUAL winner — if low, it was an upset
        if (oddsBps < UPSET_BONUS_BPS_THRESHOLD) {
            // Scale bonus: lower odds = bigger bonus (max +3 at near-0%, min +0 at 65%)
            // Formula: bonus = (6500 - oddsBps) / 2166  → gives 0-3 range
            pts += uint32((UPSET_BONUS_BPS_THRESHOLD - oddsBps) / 2166);
        }
    }

    /// @notice Batch version: compute points for multiple predictions at once.
    function calcPointsBatch(
        uint8[] calldata predHomes,
        uint8[] calldata predAways,
        uint8[] calldata realHomes,
        uint8[] calldata realAways,
        uint32[] calldata oddsBpsArr
    ) external pure returns (uint32[] memory results) {
        uint256 n = predHomes.length;
        results = new uint32[](n);
        for (uint256 i = 0; i < n; i++) {
            results[i] = calcPoints(
                predHomes[i], predAways[i],
                realHomes[i], realAways[i],
                oddsBpsArr[i]
            );
        }
    }

    function _outcome(uint8 home, uint8 away) internal pure returns (uint8) {
        if (home > away) return 0; // home win
        if (home == away) return 1; // draw
        return 2; // away win
    }
}

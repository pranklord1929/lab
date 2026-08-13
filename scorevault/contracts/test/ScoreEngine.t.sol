// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ScoreEngine.sol";

contract ScoreEngineTest is Test {
    ScoreEngine engine;

    function setUp() public {
        engine = new ScoreEngine();
    }

    // Wrong result → 0 points
    function test_wrongResult() public view {
        // Predicted home win (2-1), actual draw (1-1)
        assertEq(engine.calcPoints(2, 1, 1, 1, 5000), 0);
    }

    // Correct result, wrong score → 1 point
    function test_correctResultWrongScore() public view {
        // Predicted home win (2-1), actual home win (3-0)
        assertEq(engine.calcPoints(2, 1, 3, 0, 7000), 1);
    }

    // Exact score, favourite wins → 1 + 3 = 4 points
    function test_exactScoreFavourite() public view {
        // Predicted 2-1, actual 2-1, home team was 70% favourite
        assertEq(engine.calcPoints(2, 1, 2, 1, 7000), 4);
    }

    // Exact score, underdog wins (35% odds) → 1 + 3 + upset_bonus
    function test_exactScoreUpset() public view {
        // (6500 - 3500) / 2166 = 3000/2166 = 1
        // total = 1 (correct) + 3 (exact) + 1 (upset) = 5
        assertEq(engine.calcPoints(1, 2, 1, 2, 3500), 5);
    }

    // Big upset (15% odds), correct result but wrong score → 1 + 2 = 3 points
    function test_bigUpset() public view {
        // (6500 - 1500) / 2166 = 5000/2166 = 2
        // total = 1 (correct) + 2 (upset) = 3
        // Predicted 1-2 (away win), actual 0-1 (away win) — correct result, not exact
        assertEq(engine.calcPoints(1, 2, 0, 1, 1500), 3);
    }

    // Correct result, wrong score, above upset threshold → 1 point
    function test_correctDraw() public view {
        // Draw at 70% implied prob → no upset bonus
        assertEq(engine.calcPoints(1, 1, 0, 0, 7000), 1);
    }

    // Exact draw with upset odds → 1 + 3 + 1 = 5 points
    function test_exactDraw() public view {
        // (6500 - 3500) / 2166 = 1
        assertEq(engine.calcPoints(1, 1, 1, 1, 3500), 5);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/OracleAdapter.sol";

contract OracleAdapterTest is Test {
    OracleAdapter oracle;

    address admin = address(0xA);
    address rando = address(0x1);

    uint32 constant MATCH_GER_CIV = 1;

    function setUp() public {
        oracle = new OracleAdapter(admin);

        vm.prank(admin);
        oracle.registerMatch(MATCH_GER_CIV, "fifwc-ger-civ-2026-06-20");
    }

    // ── Register ──────────────────────────────────────────────────────────────

    function test_registerSlugStored() public view {
        assertEq(oracle.matchSlugs(MATCH_GER_CIV), "fifwc-ger-civ-2026-06-20");
    }

    function test_nonAdminRegisterReverts() public {
        vm.prank(rando);
        vm.expectRevert(OracleAdapter.NotAdmin.selector);
        oracle.registerMatch(2, "fifwc-foo-bar-2026-06-21");
    }

    // ── setResult ─────────────────────────────────────────────────────────────

    function test_setResult() public {
        // Germany wins 2-1, odds were 63.5% → 6350 bps
        vm.prank(admin);
        oracle.setResult(MATCH_GER_CIV, 2, 1, 6350);

        (uint8 h, uint8 a, uint32 odds) = oracle.getResult(MATCH_GER_CIV);
        assertEq(h, 2);
        assertEq(a, 1);
        assertEq(odds, 6350);
        assertTrue(oracle.isResolved(MATCH_GER_CIV));
    }

    function test_setResultTwiceReverts() public {
        vm.prank(admin);
        oracle.setResult(MATCH_GER_CIV, 2, 1, 6350);

        vm.prank(admin);
        vm.expectRevert(OracleAdapter.AlreadyResolved.selector);
        oracle.setResult(MATCH_GER_CIV, 3, 0, 6350);
    }

    function test_nonAdminSetResultReverts() public {
        vm.prank(rando);
        vm.expectRevert(OracleAdapter.NotAdmin.selector);
        oracle.setResult(MATCH_GER_CIV, 2, 1, 6350);
    }

    function test_invalidScoreReverts() public {
        vm.prank(admin);
        vm.expectRevert(OracleAdapter.InvalidScore.selector);
        oracle.setResult(MATCH_GER_CIV, 25, 0, 6350);
    }

    function test_invalidOddsReverts() public {
        vm.prank(admin);
        vm.expectRevert(OracleAdapter.InvalidOdds.selector);
        oracle.setResult(MATCH_GER_CIV, 2, 1, 0); // 0 odds is invalid
    }

    function test_invalidOddsOver10000Reverts() public {
        vm.prank(admin);
        vm.expectRevert(OracleAdapter.InvalidOdds.selector);
        oracle.setResult(MATCH_GER_CIV, 2, 1, 10001);
    }

    // ── getResult before resolution ───────────────────────────────────────────

    function test_getResultUnresolvedReverts() public {
        vm.expectRevert(OracleAdapter.NotResolved.selector);
        oracle.getResult(MATCH_GER_CIV);
    }

    // ── upset scenario (Côte d'Ivoire wins at 16.5%) ─────────────────────────

    function test_upsetResult() public {
        // Côte d'Ivoire wins 1-0, odds were 16.5% → 1650 bps
        vm.prank(admin);
        oracle.setResult(MATCH_GER_CIV, 0, 1, 1650);

        (, , uint32 odds) = oracle.getResult(MATCH_GER_CIV);
        assertEq(odds, 1650); // upset — low implied probability
    }
}

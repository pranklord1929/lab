// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PredictionCommitment.sol";

contract MockLeagueMembership {
    mapping(address => bool) public hasJoined;

    function setJoined(address player, bool joined) external {
        hasJoined[player] = joined;
    }
}

contract PredictionCommitmentTest is Test {
    PredictionCommitment pc;
    MockLeagueMembership membership;

    address admin = address(0xA);
    address alice = address(0x1);
    address bob   = address(0x2);
    address eve   = address(0x3);

    uint32  constant MATCH_1 = 1;
    uint256 lockTime;

    function setUp() public {
        membership = new MockLeagueMembership();
        membership.setJoined(alice, true);
        membership.setJoined(bob, true);

        pc = new PredictionCommitment(admin, address(membership));
        lockTime = block.timestamp + 1 hours;

        vm.prank(admin);
        pc.registerMatch(MATCH_1, lockTime);
    }

    // ── Register ──────────────────────────────────────────────────────────────

    function test_registerMatch() public view {
        (uint256 lt, bool registered) = pc.matches(MATCH_1);
        assertTrue(registered);
        assertEq(lt, lockTime);
    }

    function test_registerDuplicateReverts() public {
        vm.prank(admin);
        vm.expectRevert(PredictionCommitment.MatchAlreadyRegistered.selector);
        pc.registerMatch(MATCH_1, lockTime + 1 hours);
    }

    function test_registerPastLockReverts() public {
        vm.prank(admin);
        vm.expectRevert(PredictionCommitment.LockTimeInPast.selector);
        pc.registerMatch(2, block.timestamp - 1);
    }

    function test_nonAdminRegisterReverts() public {
        vm.prank(alice);
        vm.expectRevert(PredictionCommitment.NotAdmin.selector);
        pc.registerMatch(2, lockTime);
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    function test_submitPrediction() public {
        vm.prank(alice);
        pc.submitPrediction(MATCH_1, 2, 1);

        (uint8 h, uint8 a, bool sub) = pc.getPrediction(alice, MATCH_1);
        assertEq(h, 2);
        assertEq(a, 1);
        assertTrue(sub);
    }

    function test_updatePredictionBeforeLock() public {
        vm.prank(alice);
        pc.submitPrediction(MATCH_1, 2, 1);

        vm.prank(alice);
        pc.submitPrediction(MATCH_1, 0, 0); // change mind to 0-0

        (uint8 h, uint8 a,) = pc.getPrediction(alice, MATCH_1);
        assertEq(h, 0);
        assertEq(a, 0);
    }

    function test_submitAfterLockReverts() public {
        vm.warp(lockTime); // advance time to lock moment
        vm.prank(alice);
        vm.expectRevert(PredictionCommitment.PredictionsLocked.selector);
        pc.submitPrediction(MATCH_1, 1, 0);
    }

    function test_invalidScoreReverts() public {
        vm.prank(alice);
        vm.expectRevert(PredictionCommitment.InvalidScore.selector);
        pc.submitPrediction(MATCH_1, 25, 0); // no one scores 25
    }

    function test_submitUnregisteredMatchReverts() public {
        vm.prank(alice);
        vm.expectRevert(PredictionCommitment.MatchNotRegistered.selector);
        pc.submitPrediction(99, 1, 0);
    }

    function test_nonLeaguePlayerCannotSubmit() public {
        vm.prank(eve);
        vm.expectRevert(PredictionCommitment.NotLeaguePlayer.selector);
        pc.submitPrediction(MATCH_1, 1, 0);
    }

    // ── Submitters list ───────────────────────────────────────────────────────

    function test_getSubmitters() public {
        vm.prank(alice); pc.submitPrediction(MATCH_1, 2, 1);
        vm.prank(bob);   pc.submitPrediction(MATCH_1, 1, 1);

        // Alice updates — should NOT appear twice
        vm.prank(alice); pc.submitPrediction(MATCH_1, 3, 0);

        address[] memory subs = pc.getSubmitters(MATCH_1);
        assertEq(subs.length, 2);
        assertEq(subs[0], alice);
        assertEq(subs[1], bob);
    }

    // ── isLocked ─────────────────────────────────────────────────────────────

    function test_isLockedBeforeAndAfter() public {
        assertFalse(pc.isLocked(MATCH_1));
        vm.warp(lockTime);
        assertTrue(pc.isLocked(MATCH_1));
    }

    // ── tightenLock ───────────────────────────────────────────────────────────

    function test_tightenLock() public {
        uint256 earlierLock = lockTime - 30 minutes;
        vm.prank(admin);
        pc.tightenLock(MATCH_1, earlierLock);

        (uint256 lt,) = pc.matches(MATCH_1);
        assertEq(lt, earlierLock);
    }

    function test_tightenLockExtendReverts() public {
        vm.prank(admin);
        vm.expectRevert(PredictionCommitment.LockTimeInPast.selector);
        pc.tightenLock(MATCH_1, lockTime + 1 hours); // trying to extend
    }
}

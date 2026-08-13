// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/LeagueFactory.sol";
import "../src/LeagueVault.sol";
import "../src/PredictionCommitment.sol";
import "../src/OracleAdapter.sol";
import "../src/PayoutDistributor.sol";

contract LeagueFactoryTest is Test {
    LeagueFactory factory;

    address alice = address(0x1);
    address bob   = address(0x2);
    address usdc  = address(0xDEAD); // placeholder — vault address only, not called here

    uint256 deadline;
    LeagueFactory.CreateLeagueParams params;

    function setUp() public {
        factory  = new LeagueFactory();
        deadline = block.timestamp + 7 days;

        params = LeagueFactory.CreateLeagueParams({
            usdc:        usdc,
            entryFee:    10_000_000,
            maxPlayers:  10,
            joinDeadline: deadline,
            payoutBps:   [uint16(6000), uint16(3000), uint16(1000)]
        });
    }

    // ── Deployment ────────────────────────────────────────────────────────────

    function test_scoreEngineShared() public view {
        // ScoreEngine deployed once in constructor
        assertTrue(address(factory.scoreEngine()) != address(0));
    }

    function test_createLeague() public {
        vm.prank(alice);
        uint256 id = factory.createLeague(params);

        assertEq(id, 0);
        assertEq(factory.leagueCount(), 1);
    }

    function test_leagueAddressesNonZero() public {
        vm.prank(alice);
        uint256 id = factory.createLeague(params);

        LeagueFactory.League memory league = factory.getLeague(id);

        assertTrue(league.vault       != address(0));
        assertTrue(league.predictions != address(0));
        assertTrue(league.oracle      != address(0));
        assertTrue(league.distributor != address(0));
        assertEq(league.admin, alice);
    }

    function test_adminWiredCorrectly() public {
        vm.prank(alice);
        uint256 id = factory.createLeague(params);
        LeagueFactory.League memory league = factory.getLeague(id);

        // Check alice is admin in each contract
        assertEq(LeagueVault(league.vault).admin(),            alice);
        assertEq(LeagueVault(league.vault).distributor(),      league.distributor);
        assertEq(PredictionCommitment(league.predictions).admin(), alice);
        assertEq(address(PredictionCommitment(league.predictions).leagueVault()), league.vault);
        assertEq(OracleAdapter(league.oracle).admin(),         alice);
        assertEq(PayoutDistributor(league.distributor).admin(), alice);
    }

    function test_scoreEngineSharedAcrossLeagues() public {
        vm.prank(alice);
        uint256 id1 = factory.createLeague(params);

        vm.prank(bob);
        uint256 id2 = factory.createLeague(params);

        LeagueFactory.League memory l1 = factory.getLeague(id1);
        LeagueFactory.League memory l2 = factory.getLeague(id2);

        // Each league has its own vault/predictions/oracle/distributor
        assertTrue(l1.vault != l2.vault);
        assertTrue(l1.predictions != l2.predictions);

        // But both distributors point to the same shared ScoreEngine
        assertEq(
            address(PayoutDistributor(l1.distributor).scoreEngine()),
            address(PayoutDistributor(l2.distributor).scoreEngine())
        );
        assertEq(
            address(PayoutDistributor(l1.distributor).scoreEngine()),
            address(factory.scoreEngine())
        );
    }

    function test_multipleLeaguesIncrementId() public {
        vm.prank(alice);
        uint256 id1 = factory.createLeague(params);

        vm.prank(bob);
        uint256 id2 = factory.createLeague(params);

        assertEq(id1, 0);
        assertEq(id2, 1);
        assertEq(factory.leagueCount(), 2);
    }

    function test_vaultParamsCorrect() public {
        vm.prank(alice);
        uint256 id = factory.createLeague(params);
        LeagueFactory.League memory league = factory.getLeague(id);

        LeagueVault vault = LeagueVault(league.vault);
        assertEq(vault.entryFee(),    10_000_000);
        assertEq(vault.maxPlayers(),  10);
        assertEq(vault.joinDeadline(), deadline);
    }

    function test_payoutBpsWiredCorrectly() public {
        vm.prank(alice);
        uint256 id = factory.createLeague(params);
        LeagueFactory.League memory league = factory.getLeague(id);

        PayoutDistributor dist = PayoutDistributor(league.distributor);
        (uint16 a, uint16 b, uint16 c) = (dist.payoutBps(0), dist.payoutBps(1), dist.payoutBps(2));
        assertEq(a, 6000);
        assertEq(b, 3000);
        assertEq(c, 1000);
    }

    // ── Guards ────────────────────────────────────────────────────────────────

    function test_pastDeadlineReverts() public {
        params.joinDeadline = block.timestamp; // already passed
        vm.prank(alice);
        vm.expectRevert(LeagueFactory.InvalidDeadline.selector);
        factory.createLeague(params);
    }

    function test_zeroMaxPlayersReverts() public {
        params.maxPlayers = 0;
        vm.prank(alice);
        vm.expectRevert(LeagueFactory.InvalidMaxPlayers.selector);
        factory.createLeague(params);
    }

    function test_getLeagueOutOfBoundsReverts() public {
        vm.expectRevert(LeagueFactory.LeagueNotFound.selector);
        factory.getLeague(0); // no leagues created yet
    }

    function test_invalidPayoutBpsReverts() public {
        params.payoutBps = [uint16(5000), uint16(3000), uint16(1000)]; // sums to 9000
        vm.prank(alice);
        vm.expectRevert(PayoutDistributor.InvalidPayoutBps.selector);
        factory.createLeague(params);
    }
}

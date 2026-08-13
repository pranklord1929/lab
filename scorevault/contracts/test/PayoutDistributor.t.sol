// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ScoreEngine.sol";
import "../src/OracleAdapter.sol";
import "../src/PredictionCommitment.sol";
import "../src/PayoutDistributor.sol";

// ── Minimal vault mock ────────────────────────────────────────────────────────

contract MockVault {
    address[] private _players;
    uint256   public  entryFee;
    mapping(address => bool) public hasJoined;
    bool public distributed;
    address[] public lastRecipients;
    uint256[] public lastAmounts;

    constructor(uint256 fee_) { entryFee = fee_; }

    function addPlayer(address p) external {
        _players.push(p);
        hasJoined[p] = true;
    }
    function getPlayers() external view returns (address[] memory) { return _players; }
    function totalPool()  external view returns (uint256) { return _players.length * entryFee; }
    function distribute(address[] calldata recipients, uint256[] calldata amounts) external {
        distributed = true;
        delete lastRecipients;
        delete lastAmounts;
        for (uint256 i = 0; i < recipients.length; i++) {
            lastRecipients.push(recipients[i]);
            lastAmounts.push(amounts[i]);
        }
    }
}

// ── Test ──────────────────────────────────────────────────────────────────────

contract PayoutDistributorTest is Test {
    ScoreEngine           engine;
    OracleAdapter         oracle;
    PredictionCommitment  pc;
    MockVault             vault;
    PayoutDistributor     dist;

    address admin   = address(0xA);
    address alice   = address(0x1); // will come 1st
    address bob     = address(0x2); // will come 2nd
    address charlie = address(0x3); // will come 3rd
    address diana   = address(0x4); // no points

    uint32 constant MATCH_1 = 1;
    uint32 constant MATCH_2 = 2;
    uint256 lockTime;

    uint256 constant ENTRY = 10_000_000; // 10 USDC

    function setUp() public {
        engine = new ScoreEngine();
        oracle = new OracleAdapter(admin);
        vault  = new MockVault(ENTRY);
        pc     = new PredictionCommitment(admin, address(vault));

        uint16[3] memory tiers = [uint16(6000), uint16(3000), uint16(1000)];
        dist = new PayoutDistributor(
            admin,
            address(engine),
            address(pc),
            address(oracle),
            address(vault),
            tiers
        );

        // Register players in vault
        vault.addPlayer(alice);
        vault.addPlayer(bob);
        vault.addPlayer(charlie);
        vault.addPlayer(diana);

        // Register matches
        lockTime = block.timestamp + 1 hours;
        vm.startPrank(admin);
        pc.registerMatch(MATCH_1, lockTime);
        pc.registerMatch(MATCH_2, lockTime);
        oracle.registerMatch(MATCH_1, "fifwc-ger-civ-2026-06-20");
        oracle.registerMatch(MATCH_2, "fifwc-fra-esp-2026-06-21");
        vm.stopPrank();

        // Players submit predictions before lock
        // MATCH 1: Germany vs CIV (real: 2-1, Germany wins, odds 6350)
        vm.prank(alice);   pc.submitPrediction(MATCH_1, 2, 1); // exact → 4 pts
        vm.prank(bob);     pc.submitPrediction(MATCH_1, 3, 0); // correct result → 1 pt
        vm.prank(charlie); pc.submitPrediction(MATCH_1, 0, 1); // wrong → 0 pts
        // diana submits nothing for match 1

        // MATCH 2: France vs Spain (real: 1-1 draw, draw odds 3000)
        vm.prank(alice);   pc.submitPrediction(MATCH_2, 1, 1); // exact draw → 5 pts (1+3+1 upset)
        vm.prank(bob);     pc.submitPrediction(MATCH_2, 0, 0); // correct draw → 2 pts (1+1 upset)
        vm.prank(charlie); pc.submitPrediction(MATCH_2, 2, 0); // wrong → 0 pts
        vm.prank(diana);   pc.submitPrediction(MATCH_2, 1, 1); // exact draw → 5 pts

        // Advance past lock
        vm.warp(lockTime + 1);

        // Oracle: set results
        vm.startPrank(admin);
        oracle.setResult(MATCH_1, 2, 1, 6350); // Germany wins, was 63.5% fav
        oracle.setResult(MATCH_2, 1, 1, 3000); // Draw at 30% odds → upset bonus
        vm.stopPrank();
    }

    // ── computeMatch ──────────────────────────────────────────────────────────

    function test_computeMatch1() public {
        vm.prank(admin);
        dist.computeMatch(MATCH_1);

        // Alice: exact 2-1, fav wins (6350 > 6500 threshold) → 1 + 3 = 4
        assertEq(dist.totalPoints(alice), 4);
        // Bob: correct result (Germany wins) only → 1
        assertEq(dist.totalPoints(bob), 1);
        // Charlie: wrong result → 0
        assertEq(dist.totalPoints(charlie), 0);
        // Diana: no submission → 0
        assertEq(dist.totalPoints(diana), 0);
    }

    function test_computeMatch2() public {
        vm.prank(admin); dist.computeMatch(MATCH_1);
        vm.prank(admin); dist.computeMatch(MATCH_2);

        // Match 2: draw at 3000 bps (< 6500 threshold) → upset bonus = (6500-3000)/2166 = 1
        // Alice: exact draw 1-1 → 1 + 3 + 1 = 5 pts.  Total: 4 + 5 = 9
        assertEq(dist.totalPoints(alice), 9);
        // Bob: correct draw 0-0 → 1 + 1 = 2 pts.  Total: 1 + 2 = 3
        assertEq(dist.totalPoints(bob), 3);
        // Charlie: wrong both matches → 0
        assertEq(dist.totalPoints(charlie), 0);
        // Diana: exact draw → 5.  Total: 5
        assertEq(dist.totalPoints(diana), 5);
    }

    function test_processedTwiceReverts() public {
        vm.prank(admin); dist.computeMatch(MATCH_1);
        vm.prank(admin);
        vm.expectRevert(PayoutDistributor.AlreadyProcessed.selector);
        dist.computeMatch(MATCH_1);
    }

    function test_unresolvedMatchReverts() public {
        vm.prank(admin);
        vm.expectRevert(PayoutDistributor.MatchNotResolved.selector);
        dist.computeMatch(99); // never resolved
    }

    // ── getLeaderboard ────────────────────────────────────────────────────────

    function test_leaderboardSorted() public {
        vm.prank(admin); dist.computeMatch(MATCH_1);
        vm.prank(admin); dist.computeMatch(MATCH_2);

        // Expected order: Alice (9) > Diana (5) > Bob (3) > Charlie (0)
        (address[] memory players, uint32[] memory points) = dist.getLeaderboard();
        assertEq(players[0], alice);   assertEq(points[0], 9);
        assertEq(players[1], diana);   assertEq(points[1], 5);
        assertEq(players[2], bob);     assertEq(points[2], 3);
        assertEq(players[3], charlie); assertEq(points[3], 0);
    }

    // ── computePayouts ────────────────────────────────────────────────────────

    function test_payoutsNoTie() public {
        vm.prank(admin); dist.computeMatch(MATCH_1);
        vm.prank(admin); dist.computeMatch(MATCH_2);

        // Pool = 4 players × 10 USDC = 40_000_000
        // Tiers: 60% / 30% / 10%
        // Alice (1st):   40M × 60% = 24_000_000
        // Diana (2nd):   40M × 30% = 12_000_000
        // Bob   (3rd):   40M × 10% =  4_000_000
        // Charlie (4th): 0
        (, uint256[] memory amounts) = dist.computePayouts();
        assertEq(amounts[0], 24_000_000);
        assertEq(amounts[1], 12_000_000);
        assertEq(amounts[2],  4_000_000);
        assertEq(amounts[3],          0);

        // Total = full pool
        assertEq(amounts[0] + amounts[1] + amounts[2] + amounts[3], vault.totalPool());
    }

    // ── Tie scenario ──────────────────────────────────────────────────────────

    function test_payoutsTie() public {
        // Only process match 2 — alice and diana both get 5 pts, bob gets 2, charlie 0
        vm.prank(admin); dist.computeMatch(MATCH_2);

        // Points: Alice=5, Diana=5, Bob=2, Charlie=0
        // Alice & Diana tied at 1st → merge tiers 0+1 = 60%+30% = 90% → 18M each
        // Bob   3rd → tier 2 = 10% → 4M
        // Charlie → 0
        // Pool = 40M

        (, uint256[] memory amounts) = dist.computePayouts();

        // Find alice and diana (order between tied players may vary)
        uint256 aliceAmt   = amounts[0]; // both could be index 0 or 1
        uint256 dianaAmt   = amounts[1];
        uint256 bobAmt     = amounts[2];
        uint256 charlieAmt = amounts[3];

        // Tied players: each gets 18_000_000 (90% of 40M / 2)
        // But due to integer division: (40_000_000 * 9000) / 10000 = 36_000_000 / 2 = 18_000_000
        // Bob: (40_000_000 * 1000) / 10000 = 4_000_000
        assertEq(aliceAmt,   18_000_000);
        assertEq(dianaAmt,   18_000_000);
        assertEq(bobAmt,      4_000_000);
        assertEq(charlieAmt,          0);

        assertEq(aliceAmt + dianaAmt + bobAmt + charlieAmt, vault.totalPool());
    }

    function test_distributeComputedPayouts() public {
        vm.prank(admin); dist.computeMatch(MATCH_1);
        vm.prank(admin); dist.computeMatch(MATCH_2);

        vm.prank(admin);
        dist.distributeComputedPayouts();

        assertTrue(vault.distributed());
        assertEq(vault.lastRecipients(0), alice);
        assertEq(vault.lastAmounts(0), 24_000_000);
        assertEq(vault.lastRecipients(1), diana);
        assertEq(vault.lastAmounts(1), 12_000_000);
    }

    function test_nonAdminCannotDistributeComputedPayouts() public {
        vm.prank(alice);
        vm.expectRevert(PayoutDistributor.NotAdmin.selector);
        dist.distributeComputedPayouts();
    }

    function test_invalidPayoutBpsReverts() public {
        uint16[3] memory bad = [uint16(5000), uint16(3000), uint16(1000)]; // sums to 9000
        vm.expectRevert(PayoutDistributor.InvalidPayoutBps.selector);
        new PayoutDistributor(admin, address(engine), address(pc), address(oracle), address(vault), bad);
    }
}

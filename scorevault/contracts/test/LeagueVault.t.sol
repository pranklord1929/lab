// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/LeagueVault.sol";

// Minimal ERC20 we mint freely in tests — stands in for real USDC
contract MockUSDC is IERC20 {
    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allow;

    function mint(address to, uint256 amt) external { _bal[to] += amt; }

    function balanceOf(address a) external view returns (uint256) { return _bal[a]; }
    function totalSupply() external pure returns (uint256) { return 0; }
    function transfer(address to, uint256 amt) external returns (bool) {
        _bal[msg.sender] -= amt; _bal[to] += amt; return true;
    }
    function allowance(address o, address s) external view returns (uint256) { return _allow[o][s]; }
    function approve(address s, uint256 amt) external returns (bool) {
        _allow[msg.sender][s] = amt; return true;
    }
    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        _allow[from][msg.sender] -= amt; _bal[from] -= amt; _bal[to] += amt; return true;
    }
}

contract LeagueVaultTest is Test {
    MockUSDC usdc;
    LeagueVault vault;

    address admin   = address(0xA);
    address distributor = address(0xD);
    address alice   = address(0x1);
    address bob     = address(0x2);
    address charlie = address(0x3);

    uint256 constant ENTRY = 10_000_000; // 10 USDC (6 decimals)
    uint256 deadline;

    function setUp() public {
        usdc = new MockUSDC();
        deadline = block.timestamp + 7 days;
        vault = new LeagueVault(address(usdc), ENTRY, 10, deadline, admin);

        // Give each player 10 USDC and approve the vault
        address[3] memory players = [alice, bob, charlie];
        for (uint256 i = 0; i < players.length; i++) {
            usdc.mint(players[i], ENTRY);
            vm.prank(players[i]);
            usdc.approve(address(vault), ENTRY);
        }
    }

    // ── Join ─────────────────────────────────────────────────────────────────

    function test_joinSuccess() public {
        vm.prank(alice);
        vault.join();

        assertEq(vault.playerCount(), 1);
        assertTrue(vault.hasJoined(alice));
        assertEq(usdc.balanceOf(address(vault)), ENTRY);
    }

    function test_joinTwiceReverts() public {
        vm.prank(alice);
        vault.join();

        vm.prank(alice);
        vm.expectRevert(LeagueVault.AlreadyJoined.selector);
        vault.join();
    }

    function test_joinAfterDeadlineReverts() public {
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(LeagueVault.DeadlinePassed.selector);
        vault.join();
    }

    // ── Start ─────────────────────────────────────────────────────────────────

    function test_startLeague() public {
        vm.prank(alice); vault.join();
        vm.prank(bob);   vault.join();

        vm.prank(admin);
        vault.startLeague();

        assertEq(uint(vault.status()), uint(LeagueVault.Status.Active));
        assertEq(vault.totalPool(), 2 * ENTRY);
    }

    function test_startWithNoPlayersReverts() public {
        vm.prank(admin);
        vm.expectRevert(LeagueVault.ZeroPlayers.selector);
        vault.startLeague();
    }

    // ── Distribute ────────────────────────────────────────────────────────────

    function test_distributeWinnings() public {
        vm.prank(alice); vault.join();
        vm.prank(bob);   vault.join();
        vm.prank(admin); vault.setDistributor(distributor);
        vm.prank(admin); vault.startLeague();

        address[] memory recipients = new address[](2);
        uint256[] memory amounts    = new uint256[](2);
        recipients[0] = alice; amounts[0] = 15_000_000; // 15 USDC (wins 5)
        recipients[1] = bob;   amounts[1] =  5_000_000; // 5 USDC (loses 5)

        vm.prank(distributor);
        vault.distribute(recipients, amounts);

        assertEq(usdc.balanceOf(alice), 15_000_000);
        assertEq(usdc.balanceOf(bob),    5_000_000);
        assertEq(uint(vault.status()), uint(LeagueVault.Status.Settled));
    }

    function test_distributeWrongTotalReverts() public {
        vm.prank(alice); vault.join();
        vm.prank(admin); vault.setDistributor(distributor);
        vm.prank(admin); vault.startLeague();

        address[] memory recipients = new address[](1);
        uint256[] memory amounts    = new uint256[](1);
        recipients[0] = alice; amounts[0] = 5_000_000; // less than pool

        vm.prank(distributor);
        vm.expectRevert(LeagueVault.PayoutMismatch.selector);
        vault.distribute(recipients, amounts);
    }

    function test_distributeToNonPlayerReverts() public {
        vm.prank(alice); vault.join();
        vm.prank(admin); vault.setDistributor(distributor);
        vm.prank(admin); vault.startLeague();

        address[] memory recipients = new address[](1);
        uint256[] memory amounts    = new uint256[](1);
        recipients[0] = bob; amounts[0] = ENTRY;

        vm.prank(distributor);
        vm.expectRevert(LeagueVault.RecipientNotPlayer.selector);
        vault.distribute(recipients, amounts);
    }

    function test_distributeDuplicateRecipientReverts() public {
        vm.prank(alice); vault.join();
        vm.prank(bob);   vault.join();
        vm.prank(admin); vault.setDistributor(distributor);
        vm.prank(admin); vault.startLeague();

        address[] memory recipients = new address[](2);
        uint256[] memory amounts    = new uint256[](2);
        recipients[0] = alice; amounts[0] = ENTRY;
        recipients[1] = alice; amounts[1] = ENTRY;

        vm.prank(distributor);
        vm.expectRevert(LeagueVault.DuplicateRecipient.selector);
        vault.distribute(recipients, amounts);
    }

    function test_setDistributorOnce() public {
        vm.prank(admin);
        vault.setDistributor(distributor);

        assertEq(vault.distributor(), distributor);

        vm.prank(admin);
        vm.expectRevert(LeagueVault.DistributorAlreadySet.selector);
        vault.setDistributor(address(0xE));
    }

    // ── Cancel ────────────────────────────────────────────────────────────────

    function test_cancelRefundsAll() public {
        vm.prank(alice); vault.join();
        vm.prank(bob);   vault.join();

        vm.prank(admin);
        vault.cancel();

        assertEq(usdc.balanceOf(alice), ENTRY);
        assertEq(usdc.balanceOf(bob),   ENTRY);
        assertEq(uint(vault.status()), uint(LeagueVault.Status.Cancelled));
    }

    function test_nonDistributorCannotDistribute() public {
        vm.prank(alice); vault.join();
        vm.prank(admin); vault.setDistributor(distributor);
        vm.prank(admin); vault.startLeague();

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = alice; a[0] = ENTRY;

        vm.prank(alice);
        vm.expectRevert(LeagueVault.NotDistributor.selector);
        vault.distribute(r, a);
    }
}

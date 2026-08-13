// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title LeagueVault
/// @notice Holds USDC entry fees for a single league. Admin distributes winnings or refunds.
contract LeagueVault {
    using SafeERC20 for IERC20;

    // ── State ────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    uint256 public immutable entryFee;    // in USDC units (6 decimals), e.g. 10 USDC = 10_000_000
    uint256 public immutable maxPlayers;
    uint256 public immutable joinDeadline; // unix timestamp — no new entries after this
    address public immutable admin;        // controls distribute / cancel
    address public immutable configurator; // deployment helper allowed to wire distributor once
    address public distributor;            // PayoutDistributor allowed to release funds

    enum Status { Open, Active, Settled, Cancelled }
    Status public status;

    address[] private _players;
    mapping(address => bool) public hasJoined;

    // ── Events ───────────────────────────────────────────────────────────────

    event PlayerJoined(address indexed player, uint256 fee);
    event LeagueStarted(uint256 playerCount, uint256 totalPool);
    event DistributorSet(address indexed distributor);
    event Distributed(address indexed recipient, uint256 amount);
    event Cancelled(uint256 refundedPlayers);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotAdmin();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error LeagueNotOpen();
    error LeagueNotActive();
    error AlreadyJoined();
    error LeagueFull();
    error PayoutMismatch();
    error ZeroPlayers();
    error RecipientNotPlayer();
    error DuplicateRecipient();
    error NotDistributor();
    error DistributorAlreadySet();
    error ZeroAddress();

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address usdc_,
        uint256 entryFee_,
        uint256 maxPlayers_,
        uint256 joinDeadline_,
        address admin_
    ) {
        usdc = IERC20(usdc_);
        entryFee = entryFee_;
        maxPlayers = maxPlayers_;
        joinDeadline = joinDeadline_;
        admin = admin_;
        configurator = msg.sender;
        status = Status.Open;
    }

    // ── Player actions ───────────────────────────────────────────────────────

    /// @notice Pay the entry fee and join the league.
    /// @dev Player must have approved this contract to spend `entryFee` USDC first.
    function join() external {
        if (status != Status.Open) revert LeagueNotOpen();
        if (block.timestamp > joinDeadline) revert DeadlinePassed();
        if (hasJoined[msg.sender]) revert AlreadyJoined();
        if (_players.length >= maxPlayers) revert LeagueFull();

        hasJoined[msg.sender] = true;
        _players.push(msg.sender);

        usdc.safeTransferFrom(msg.sender, address(this), entryFee);
        emit PlayerJoined(msg.sender, entryFee);
    }

    // ── Admin actions ────────────────────────────────────────────────────────

    /// @notice Lock the league — no more joins. Call this after the deadline.
    function startLeague() external {
        if (msg.sender != admin) revert NotAdmin();
        if (status != Status.Open) revert LeagueNotOpen();
        if (_players.length == 0) revert ZeroPlayers();

        status = Status.Active;
        emit LeagueStarted(_players.length, totalPool());
    }

    /// @notice Set the payout distributor once, after deployment.
    function setDistributor(address distributor_) external {
        if (msg.sender != admin && msg.sender != configurator) revert NotAdmin();
        if (distributor != address(0)) revert DistributorAlreadySet();
        if (distributor_ == address(0)) revert ZeroAddress();

        distributor = distributor_;
        emit DistributorSet(distributor_);
    }

    /// @notice Send winnings to each player. Amounts must add up to exactly the pool.
    /// @param recipients  List of winner addresses (can be a subset of players)
    /// @param amounts     USDC amount for each recipient (same order)
    function distribute(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        if (msg.sender != distributor) revert NotDistributor();
        if (status != Status.Active) revert LeagueNotActive();
        if (recipients.length != amounts.length) revert PayoutMismatch();

        // Verify amounts sum equals the pool (no money left behind, no overpay)
        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (!hasJoined[recipients[i]]) revert RecipientNotPlayer();
            for (uint256 j = 0; j < i; j++) {
                if (recipients[j] == recipients[i]) revert DuplicateRecipient();
            }
            total += amounts[i];
        }
        if (total != totalPool()) revert PayoutMismatch();

        status = Status.Settled;

        for (uint256 i = 0; i < recipients.length; i++) {
            usdc.safeTransfer(recipients[i], amounts[i]);
            emit Distributed(recipients[i], amounts[i]);
        }
    }

    /// @notice Cancel the league and refund every player their entry fee.
    function cancel() external {
        if (msg.sender != admin) revert NotAdmin();
        if (status == Status.Settled || status == Status.Cancelled) revert LeagueNotOpen();

        status = Status.Cancelled;

        address[] memory players = _players;
        for (uint256 i = 0; i < players.length; i++) {
            usdc.safeTransfer(players[i], entryFee);
        }
        emit Cancelled(players.length);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function totalPool() public view returns (uint256) {
        return _players.length * entryFee;
    }

    function playerCount() external view returns (uint256) {
        return _players.length;
    }

    function getPlayers() external view returns (address[] memory) {
        return _players;
    }
}

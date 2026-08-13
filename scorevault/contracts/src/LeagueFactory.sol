// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ScoreEngine.sol";
import "./LeagueVault.sol";
import "./PredictionCommitment.sol";
import "./OracleAdapter.sol";
import "./PayoutDistributor.sol";

/// @title LeagueFactory
/// @notice Deploys a complete ScoreVault league in one transaction.
///         ScoreEngine is deployed once by the factory and shared across all leagues.
contract LeagueFactory {

    // ── Types ─────────────────────────────────────────────────────────────────

    struct League {
        address vault;
        address predictions;
        address oracle;
        address distributor;
        address admin;
        uint256 createdAt;
    }

    struct CreateLeagueParams {
        address usdc;           // USDC token address on this network
        uint256 entryFee;       // in USDC units (e.g. 10 USDC = 10_000_000)
        uint256 maxPlayers;
        uint256 joinDeadline;   // unix timestamp — entry closes at this time
        uint16[3] payoutBps;    // prize split, must sum to 10000
    }

    // ── State ─────────────────────────────────────────────────────────────────

    ScoreEngine public immutable scoreEngine;

    mapping(uint256 => League) private _leagues;
    uint256 public leagueCount;

    // ── Events ────────────────────────────────────────────────────────────────

    event LeagueCreated(
        uint256 indexed leagueId,
        address indexed admin,
        address vault,
        address predictions,
        address oracle,
        address distributor
    );

    // ── Errors ────────────────────────────────────────────────────────────────

    error LeagueNotFound();
    error InvalidDeadline();
    error InvalidMaxPlayers();

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        scoreEngine = new ScoreEngine();
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /// @notice Deploy a complete league. The caller becomes the admin of all contracts.
    /// @return leagueId  Index to look up this league later via getLeague()
    function createLeague(CreateLeagueParams calldata p)
        external
        returns (uint256 leagueId)
    {
        if (p.joinDeadline <= block.timestamp) revert InvalidDeadline();
        if (p.maxPlayers == 0) revert InvalidMaxPlayers();

        address admin = msg.sender;

        // Deploy contracts in dependency order
        LeagueVault vault = new LeagueVault(
            p.usdc,
            p.entryFee,
            p.maxPlayers,
            p.joinDeadline,
            admin
        );

        PredictionCommitment predictions = new PredictionCommitment(admin, address(vault));

        OracleAdapter oracle = new OracleAdapter(admin);

        PayoutDistributor distributor = new PayoutDistributor(
            admin,
            address(scoreEngine),
            address(predictions),
            address(oracle),
            address(vault),
            p.payoutBps
        );

        vault.setDistributor(address(distributor));

        leagueId = leagueCount++;

        _leagues[leagueId] = League({
            vault:       address(vault),
            predictions: address(predictions),
            oracle:      address(oracle),
            distributor: address(distributor),
            admin:       admin,
            createdAt:   block.timestamp
        });

        emit LeagueCreated(
            leagueId,
            admin,
            address(vault),
            address(predictions),
            address(oracle),
            address(distributor)
        );
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getLeague(uint256 leagueId) external view returns (League memory) {
        if (leagueId >= leagueCount) revert LeagueNotFound();
        return _leagues[leagueId];
    }
}

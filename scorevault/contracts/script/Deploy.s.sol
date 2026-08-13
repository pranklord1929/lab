// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/LeagueFactory.sol";
import "../src/mocks/MockUSDC.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Mock USDC (testnet only — replace with real USDC on mainnet)
        MockUSDC usdc = new MockUSDC();

        // 2. Factory — also deploys the shared ScoreEngine
        LeagueFactory factory = new LeagueFactory();

        // 3. First league: WC2026, 5 USDC entry, 20 players max, 7-day join window
        LeagueFactory.CreateLeagueParams memory p = LeagueFactory.CreateLeagueParams({
            usdc:         address(usdc),
            entryFee:     5_000_000,    // 5 USDC (6 decimals)
            maxPlayers:   20,
            joinDeadline: block.timestamp + 7 days,
            payoutBps:    [uint16(6000), uint16(3000), uint16(1000)]
        });

        uint256 leagueId = factory.createLeague(p);
        LeagueFactory.League memory league = factory.getLeague(leagueId);

        // 4. Mint 100 USDC to the deployer wallet for testing
        usdc.mint(deployer, 100_000_000);

        vm.stopBroadcast();

        // ── Log everything ────────────────────────────────────────────────────
        console.log("=== ScoreVault - Base Sepolia ===");
        console.log("");
        console.log("Deployer:      ", deployer);
        console.log("MockUSDC:      ", address(usdc));
        console.log("ScoreEngine:   ", address(factory.scoreEngine()));
        console.log("LeagueFactory: ", address(factory));
        console.log("");
        console.log("--- League #0 ---");
        console.log("Vault:         ", league.vault);
        console.log("Predictions:   ", league.predictions);
        console.log("Oracle:        ", league.oracle);
        console.log("Distributor:   ", league.distributor);

        // ── Save addresses to JSON for the frontend ───────────────────────────
        string memory json = string.concat(
            '{\n',
            '  "chainId": 84532,\n',
            '  "mockUSDC": "',       vm.toString(address(usdc)),       '",\n',
            '  "scoreEngine": "',    vm.toString(address(factory.scoreEngine())), '",\n',
            '  "leagueFactory": "',  vm.toString(address(factory)),    '",\n',
            '  "leagues": [\n',
            '    {\n',
            '      "id": 0,\n',
            '      "vault": "',       vm.toString(league.vault),       '",\n',
            '      "predictions": "', vm.toString(league.predictions), '",\n',
            '      "oracle": "',      vm.toString(league.oracle),      '",\n',
            '      "distributor": "', vm.toString(league.distributor), '"\n',
            '    }\n',
            '  ]\n',
            '}'
        );

        vm.writeFile("../app/lib/contracts.json", json);
        console.log("");
        console.log("Addresses saved to app/lib/contracts.json");
    }
}

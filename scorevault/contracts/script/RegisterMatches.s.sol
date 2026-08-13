// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PredictionCommitment.sol";

// Run: forge script script/RegisterMatches.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key $PRIVATE_KEY
contract RegisterMatches is Script {
    // ← paste the predictions address from app/lib/contracts.json
    address constant PREDICTIONS = 0x0088DdfaaDBb00A10c500936a6727684ae2085df;

    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);

        PredictionCommitment pc = PredictionCommitment(PREDICTIONS);

        // Lock times = 1 hour before each kickoff (all in the future for demo)
        uint256 base = block.timestamp + 8 hours;

        pc.registerMatch(0, base);          // Ghana vs Panama     8:00 PM
        pc.registerMatch(1, base + 3 hours); // Uzbekistan vs Colombia 11:00 PM
        pc.registerMatch(2, base + 6 hours); // Czechia vs South Africa 2:00 AM
        pc.registerMatch(3, base + 9 hours); // Switzerland vs Bosnia  5:00 AM

        console.log("Matches 0-3 registered, lock times set.");
        vm.stopBroadcast();
    }
}

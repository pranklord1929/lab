export const VAULT_ABI = [
  { type: "function", name: "entryFee",    inputs: [],                                                outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalPool",   inputs: [],                                                outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "playerCount", inputs: [],                                                outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "maxPlayers",  inputs: [],                                                outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "status",      inputs: [],                                                outputs: [{ type: "uint8"   }], stateMutability: "view" },
  { type: "function", name: "hasJoined",   inputs: [{ name: "", type: "address" }],                  outputs: [{ type: "bool"    }], stateMutability: "view" },
  { type: "function", name: "getPlayers",  inputs: [],                                                outputs: [{ type: "address[]"}], stateMutability: "view" },
  { type: "function", name: "join",        inputs: [],                                                outputs: [],                    stateMutability: "nonpayable" },
] as const;

export const USDC_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve",   inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

export const PREDICTIONS_ABI = [
  { type: "function", name: "submitPrediction", inputs: [{ name: "matchId", type: "uint32" }, { name: "predHome", type: "uint8" }, { name: "predAway", type: "uint8" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "getPrediction",    inputs: [{ name: "player", type: "address" }, { name: "matchId", type: "uint32" }], outputs: [{ name: "home", type: "uint8" }, { name: "away", type: "uint8" }, { name: "submitted", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "isLocked",         inputs: [{ name: "matchId", type: "uint32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "matches",          inputs: [{ name: "", type: "uint32" }], outputs: [{ name: "lockTime", type: "uint256" }, { name: "registered", type: "bool" }], stateMutability: "view" },
] as const;

export const ORACLE_ABI = [
  { type: "function", name: "getResult",  inputs: [{ name: "matchId", type: "uint32" }], outputs: [{ name: "homeGoals", type: "uint8" }, { name: "awayGoals", type: "uint8" }, { name: "winnerOddsBps", type: "uint32" }], stateMutability: "view" },
  { type: "function", name: "isResolved", inputs: [{ name: "matchId", type: "uint32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const;

export const DISTRIBUTOR_ABI = [
  { type: "function", name: "getLeaderboard", inputs: [], outputs: [{ name: "players", type: "address[]" }, { name: "points", type: "uint32[]" }], stateMutability: "view" },
] as const;

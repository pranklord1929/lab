// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fake USDC for Base Sepolia testnet. Anyone can mint — for testing only.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin (Test)", "USDC") {}

    // 6 decimals like real USDC
    function decimals() public pure override returns (uint8) { return 6; }

    /// @notice Mint test USDC to any address. No auth — testnet only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

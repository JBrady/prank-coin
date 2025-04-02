// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // Optional: To restrict future minting if needed

/**
 * @title PrankCoin (PRNK) - Basic Placeholder Token
 * @dev Minimal ERC20 implementation for initial deployment to secure the symbol.
 * Does NOT include tax, burn, or reflection features.
 * Total supply is minted to the deployer upon construction.
 */
contract PrankCoin is ERC20, Ownable {
    // Define the total supply (69,420,000,000,000) with 18 decimals
    uint256 public constant TOTAL_SUPPLY = 69_420_000_000_000 * (10**18);

    constructor(address initialOwner) ERC20("Prank coin", "PRNK") Ownable(initialOwner) {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    // Override decimals to ensure compatibility (default is 18)
    // function decimals() public view virtual override returns (uint8) {
    //     return 18;
    // }

    // Optional: Add functions later if needed, e.g., for burning
    // function burn(uint256 amount) public virtual {
    //     _burn(msg.sender, amount);
    // }
}

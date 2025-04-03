// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol"; // For MAX_UINT256 if needed, though direct literal works

/**
 * @title PrankCoinV2 (PRNK)
 * @dev ERC20 token with tax features: Reflections, Prank Fund, Auto-Burn.
 * Uses the _update hook for tax and reflection logic.
 */
contract PrankCoinV2 is ERC20, Ownable {
    using Math for uint256;

    // --- Constants ---
    uint256 public constant TOTAL_SUPPLY = 69_420_000_000_000 * (10**18);
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD; // Standard burn address
    uint256 private constant MAX = ~uint256(0); // Same as type(uint256).max

    // --- State Variables ---

    // Reflection related storage
    mapping(address => uint256) private _rOwned; // Reflected balance for each address
    mapping(address => bool) public isExcludedFromReflections; // Addresses excluded from receiving reflections
    uint256 private _rTotal; // Total reflected supply, decreases with exclusions and reflection tax
    // _tOwned is the standard ERC20 _balances mapping
    // _tTotal is the standard ERC20 _totalSupply variable

    // Tax rates (basis points, e.g., 50 = 0.5%)
    uint16 public reflectionTaxRateBps = 50; // 0.5%
    uint16 public prankFundTaxRateBps = 100; // 1.0%
    uint16 public burnTaxRateBps = 50;       // 0.5%
    uint16 public totalTaxRateBps = reflectionTaxRateBps + prankFundTaxRateBps + burnTaxRateBps; // 200 = 2.0%
    uint16 public constant MAX_TAX_RATE_BPS = 1000; // Max tax 10% (example limit)
    uint16 public constant BPS_DIVISOR = 10000; // Basis points divisor

    // Prank Fund wallet address - needs to be set!
    address public prankFundWallet;

    // Mapping to exclude addresses from tax (e.g., owner, contract, pair, prank fund)
    mapping(address => bool) public isExcludedFromTax;

    // Flag to prevent re-entrancy in tax calculation within _update
    bool private _isProcessingTax;

    // --- Events ---
    event TaxesUpdated(uint16 reflectionBps, uint16 prankFundBps, uint16 burnBps);
    event PrankFundWalletUpdated(address indexed newWallet);
    event ExcludedFromTax(address indexed account, bool isExcluded);
    event ExcludedFromReflections(address indexed account, bool isExcluded); // New event
    event TaxPaid(address indexed from, address indexed to, uint256 reflectionAmount, uint256 prankFundAmount, uint256 burnAmount);
    event LogBalanceOf(address indexed account, bool isExcluded, uint256 rOwned, uint256 tOwned, uint256 rate);
    event LogExclusion(address indexed account, bool excluded, uint256 tOwned, uint256 rOwnedAfter, uint256 rTotalAfter);
    event LogTransferStandard(address indexed sender, address indexed recipient, uint256 tAmount, uint256 senderTOwned, uint256 rate);

    // --- Constructor ---
    constructor(
        address initialOwner,
        address _prankFundWallet // Require Prank Fund wallet at deployment
    ) ERC20("Prank coin V2", "PRNK") Ownable(initialOwner) {
        require(_prankFundWallet != address(0), "Prank Fund wallet cannot be zero address");
        prankFundWallet = _prankFundWallet;

        // Initialize reflection supply calculations
        // _tTotal is implicitly TOTAL_SUPPLY via the _update call below
        _rTotal = (MAX - (MAX % TOTAL_SUPPLY)); // Reduce MAX slightly to be divisible by TOTAL_SUPPLY for precision

        // Exclude owner, this contract, and prank fund from tax initially
        isExcludedFromTax[initialOwner] = true;
        isExcludedFromTax[address(this)] = true;
        isExcludedFromTax[prankFundWallet] = true;
        isExcludedFromTax[DEAD_ADDRESS] = true; // Exclude burn address

        // Exclude standard addresses from reflections (important!)
        // Exclude self, dead address, and prank fund wallet by default
        // Use internal function _excludeFromReflections which correctly updates _rOwned and _rTotal
        _excludeFromReflections(address(this), true); // Exclude contract address
        _excludeFromReflections(DEAD_ADDRESS, true);   // Exclude burn address
        _excludeFromReflections(prankFundWallet, true); // Exclude prank fund wallet

        // Mint the total supply to the deployer
        // Use _update which calls _transferStandard to handle initial mint and reflection accounting
        _update(address(0), initialOwner, TOTAL_SUPPLY);
    }

    // --- Core Logic (Override Hook) ---

    /**
     * @dev Overrides the _update hook to implement tax logic on token transfers.
     * This hook is called by _transfer, _mint, and _burn.
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        // Prevent re-entrancy during tax processing
        if (_isProcessingTax) {
            // If re-entering, just perform the basic ERC20 update. Reflections handled by initial call.
            super._update(from, to, value);
            return;
        }

        // Use the helper for standard minting/burning (will handle reflections correctly for recipient/sender)
        if (from == address(0) || to == address(0)) {
            _transferStandard(from, to, value);
            return;
        }

        // Check if tax should be applied
        bool takeTax = !isExcludedFromTax[from] && !isExcludedFromTax[to];

        if (takeTax && value > 0 && totalTaxRateBps > 0) { // Added check for totalTaxRateBps > 0
            _isProcessingTax = true; // Set flag

            // --- Calculate Taxes ---
            uint256 reflectionTaxAmount = (value * reflectionTaxRateBps) / BPS_DIVISOR;
            uint256 prankFundTaxAmount = (value * prankFundTaxRateBps) / BPS_DIVISOR;
            uint256 burnTaxAmount = (value * burnTaxRateBps) / BPS_DIVISOR;
            // Note: totalTaxAmount might not be needed explicitly if we process each part
            uint256 amountAfterTax = value - reflectionTaxAmount - prankFundTaxAmount - burnTaxAmount;

            require(amountAfterTax <= value, "Tax calculation overflow"); // Sanity check

            // --- Apply Taxes & Reflections ---

            // 1. Distribute Reflection Tax (reduce _rTotal)
            if (reflectionTaxAmount > 0) {
                uint256 rReflectionTax = reflectionFromToken(reflectionTaxAmount);
                // Ensure _rTotal doesn't underflow (shouldn't happen with valid rate)
                _rTotal = (_rTotal > rReflectionTax) ? _rTotal - rReflectionTax : 0;
            }

            // 2. Transfer Burn Tax (using helper)
            if (burnTaxAmount > 0) {
                _transferStandard(from, DEAD_ADDRESS, burnTaxAmount);
            }

            // 3. Transfer Prank Fund Tax (using helper)
            if (prankFundTaxAmount > 0) {
                _transferStandard(from, prankFundWallet, prankFundTaxAmount);
            }

            // Emit TaxPaid event (includes reflection amount for logging)
            emit TaxPaid(from, to, reflectionTaxAmount, prankFundTaxAmount, burnTaxAmount);

            // 4. Transfer Actual Amount (using helper)
            if (amountAfterTax > 0) {
                _transferStandard(from, to, amountAfterTax);
            }

            _isProcessingTax = false; // Clear flag

        } else {
            // No tax applied or zero value transfer, proceed with standard update
            _transferStandard(from, to, value); // Use helper here too
        }
    }

    // --- Internal Reflection Helper ---

    /**
     * @dev Internal function to handle a standard transfer, updating both
     * the underlying ERC20 balance (_tOwned) and the reflected balance (_rOwned).
     */
    function _transferStandard(address sender, address recipient, uint256 tAmount) internal {
        // Logging for debugging
        uint256 senderBalance = (sender == address(0)) ? 0 : _requireOwned(sender);
        uint256 currentRate = _getRate(); // Cache rate
        emit LogTransferStandard(sender, recipient, tAmount, senderBalance, currentRate);

        // Ensure sender has enough balance for transfers (mints skip this)
        if (sender != address(0)) { require(senderBalance >= tAmount, "ERC20: transfer amount exceeds balance"); }

        // Update underlying ERC20 balances/supply using the parent's _update
        super._update(sender, recipient, tAmount);

        // Optimization/Precision fix for initial mint:
        // If sender is address(0), this is a mint.
        // If the total supply is being minted (tAmount == TOTAL_SUPPLY),
        // directly assign _rTotal to the recipient's _rOwned.
        if (sender == address(0) && tAmount == TOTAL_SUPPLY) {
            require(recipient == owner(), "Initial supply must go to owner"); // Sanity check
            _rOwned[recipient] = _rTotal;
            // No change to _rTotal needed as this represents the full initial amount.
            return; // Skip standard reflection logic for this specific case
        }

        // Calculate corresponding reflected amount IF rate is valid
        uint256 tSupply = totalSupply();
        if (tSupply == 0 || _rTotal == 0) return; // Rate is effectively zero

        // Use reflectionFromToken for potentially better precision and consistency
        // This implicitly uses the rate calculated via _getRate
        uint256 rAmount = reflectionFromToken(tAmount);

        // If rAmount calculated to 0 (e.g., tAmount was tiny), no reflection updates needed
        if (rAmount == 0) return;

        // Update reflected balances only for non-excluded accounts
        if (!isExcludedFromReflections[sender]) {
            uint256 senderROwned = _rOwned[sender];
            // Ensure sender has enough reflected balance (can happen in edge cases, like manual exclusion messing things up)
            if (senderROwned >= rAmount) {
                _rOwned[sender] = senderROwned - rAmount;
            } else {
                // Sender doesn't have enough rOwned, adjust _rTotal and zero out sender's rOwned
                _rTotal -= (rAmount - senderROwned); // Reduce overall reflection supply by the deficit
                _rOwned[sender] = 0;
            }
        }
        if (!isExcludedFromReflections[recipient]) {
            _rOwned[recipient] = _rOwned[recipient] + rAmount;
            // Sanity check: Ensure recipient rOwned doesn't exceed _rTotal. This *shouldn't* happen.
            // require(_rOwned[recipient] <= _rTotal, "Recipient rOwned exceeds rTotal");
        }
    }

    // --- Owner Functions ---

    /**
     * @dev Excludes or includes an account from receiving reflections. Restricted to owner.
     * @param _account The account to modify.
     * @param _isExcluded True to exclude, false to include.
     */
    function setExcludedFromReflections(address _account, bool _isExcluded) external onlyOwner {
        require(_account != address(0), "Account cannot be zero address");
        _excludeFromReflections(_account, _isExcluded);
    }

    // --- Reflection Helper Functions ---

    /**
     * @dev Calculates the actual token amount from a reflected amount.
     */
    function tokenFromReflection(uint256 rAmount) internal view returns (uint256) {
        uint256 currentRate = _getRate();
        if (currentRate == 0) return 0; // Handle case where rate is zero
        return rAmount / currentRate;
    }

    /**
     * @dev Calculates the reflected amount from an actual token amount.
     */
    function reflectionFromToken(uint256 tAmount) internal view returns (uint256) {
        uint256 currentRate = _getRate();
        return tAmount * currentRate;
    }

    /**
     * @dev Internal function to calculate the current reflection rate.
     */
    function _getRate() internal view returns (uint256) {
        uint256 tSupply = totalSupply(); // Use totalSupply() to account for burned tokens
        if (tSupply == 0 || _rTotal == 0) return 0; // Avoid division by zero if total supply is burned or _rTotal is 0
        return _rTotal / tSupply;
    }

    /**
     * @dev Internal function to handle exclusion/inclusion from reflections.
     * Updates the _rOwned mapping and adjusts _rTotal accordingly.
     */
    function _excludeFromReflections(address account, bool excluded) internal {
        require(isExcludedFromReflections[account] != excluded, "Account already in desired state");

        if (excluded) {
            // Exclude: Transfer _tOwned to _rOwned if not already there, then remove _rOwned from _rTotal
            uint256 tOwned = _requireOwned(account); // Get current actual balance
            uint256 rOwnedToSet = 0;
            if (tOwned > 0) {
                uint256 currentRate = _getRate();
                rOwnedToSet = (currentRate > 0) ? tOwned * currentRate : 0;
            }
            _rOwned[account] = rOwnedToSet;
            _rTotal = _rTotal - _rOwned[account]; // Use subtraction with underflow check
            isExcludedFromReflections[account] = true;
            emit LogExclusion(account, true, tOwned, _rOwned[account], _rTotal);
        } else {
            // If including, recalculate rOwned based on current tOwned and current rate
            uint256 currentTOwned = super.balanceOf(account);
            uint256 recalculatedROwned = 0;
            if (currentTOwned > 0) {
                uint256 currentRate = _getRate();
                if (currentRate > 0) { // Avoid issues if rate is zero
                    recalculatedROwned = currentTOwned * currentRate;
                }
            }
            // Update the stored rOwned value
            _rOwned[account] = recalculatedROwned;
            // Set the exclusion flag to false
            isExcludedFromReflections[account] = false;
            emit LogExclusion(account, false, currentTOwned, recalculatedROwned, _rTotal);
        }
    }

    /**
     * @dev Updates the tax rates. Restricted to the owner.
     * @param _reflectionBps New reflection tax rate in basis points.
     * @param _prankFundBps New prank fund tax rate in basis points.
     * @param _burnBps New burn tax rate in basis points.
     */
    function setTaxRates(uint16 _reflectionBps, uint16 _prankFundBps, uint16 _burnBps) external onlyOwner {
        uint16 newTotalBps = _reflectionBps + _prankFundBps + _burnBps;
        require(newTotalBps <= MAX_TAX_RATE_BPS, "Total tax rate exceeds maximum allowed");

        reflectionTaxRateBps = _reflectionBps;
        prankFundTaxRateBps = _prankFundBps;
        burnTaxRateBps = _burnBps;
        totalTaxRateBps = newTotalBps;

        emit TaxesUpdated(_reflectionBps, _prankFundBps, _burnBps);
    }

    /**
     * @dev Updates the Prank Fund wallet address. Restricted to the owner.
     * @param _newWallet The address of the new Prank Fund wallet.
     */
    function setPrankFundWallet(address _newWallet) external onlyOwner {
        require(_newWallet != address(0), "New wallet cannot be zero address"); // Corrected revert message
        prankFundWallet = _newWallet;
        emit PrankFundWalletUpdated(_newWallet);
    }

    /**
     * @dev Excludes an account from tax. Restricted to the owner.
     * @param _account The account to exclude.
     */
    function excludeFromTax(address _account) external onlyOwner {
        require(_account != address(0), "Account cannot be zero address");
        if (!isExcludedFromTax[_account]) {
            isExcludedFromTax[_account] = true;
            emit ExcludedFromTax(_account, true);
        }
    }

    /**
     * @dev Includes an account in tax (removes exclusion). Restricted to the owner.
     * @param _account The account to include.
     */
    function includeInTax(address _account) external onlyOwner {
        require(_account != address(0), "Account cannot be zero address");
        if (isExcludedFromTax[_account]) {
            isExcludedFromTax[_account] = false;
            emit ExcludedFromTax(_account, false);
        }
    }

    // --- Overridden ERC20 View Functions ---

    /**
     * @dev See {IERC20-balanceOf}.
     * Returns the actual token balance calculated from the reflected balance.
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        bool excluded = isExcludedFromReflections[account];
        uint256 rOwned = _rOwned[account]; // Get rOwned for require check
        if (excluded) {
            // If excluded, balance is the directly tracked _tOwned via super.balanceOf
            uint256 tOwned = _requireOwned(account);
            // emit LogBalanceOf(account, true, rOwned, tOwned, rate); // REMOVED: Cannot emit in view function
            return tOwned;
        } else {
            // If included, balance is calculated from reflected balance _rOwned
            require(rOwned <= _rTotal, "Amount exceeds reflected supply");
            uint256 tOwned = tokenFromReflection(rOwned); // Use internal helper
            // emit LogBalanceOf(account, false, rOwned, tOwned, rate); // REMOVED: Cannot emit in view function
            return tOwned;
        }
    }

    /**
     * @dev Returns the underlying token balance stored in the ERC20 contract.
     * Needed internally for reflection calculations when excluding.
     */
    function _requireOwned(address account) internal view returns (uint256) {
        return super.balanceOf(account); // Directly access the original _balances mapping
    }

    // --- Public View Functions ---

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    // --- Public View Functions for Debugging/Info ---
    function getRTotal() public view returns (uint256) {
        return _rTotal;
    }
}

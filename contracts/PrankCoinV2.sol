// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

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
    uint256 private constant MAX = ~uint256(0);

    // --- State Variables ---

    // Reflection related storage
    mapping(address => uint256) private _rOwned; // Reflected balance for each address
    mapping(address => bool) public isExcludedFromReflections; // Addresses excluded from receiving reflections
    address[] private _excludedFromReflectionsList; // List of excluded addresses for rate calculation

    uint256 private _rTotal; // Total reflected supply, decreases with reflection tax
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
    event ExcludedFromReflections(address indexed account, bool isExcluded);
    event TaxPaid(address indexed from, address indexed to, uint256 reflectionAmount, uint256 prankFundAmount, uint256 burnAmount);
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
        _rTotal = (MAX - (MAX % TOTAL_SUPPLY));

        // Exclude owner, this contract, and prank fund from tax initially
        isExcludedFromTax[initialOwner] = true;
        isExcludedFromTax[address(this)] = true;
        isExcludedFromTax[prankFundWallet] = true;
        isExcludedFromTax[DEAD_ADDRESS] = true; // Exclude burn address

        // Exclude standard addresses from reflections
        _excludeFromReflections(address(this), true);
        _excludeFromReflections(DEAD_ADDRESS, true);
        _excludeFromReflections(prankFundWallet, true);

        // Mint the total supply to the deployer
        // Use _update which calls _transferStandard to handle initial mint and reflection accounting
        _update(address(0), initialOwner, TOTAL_SUPPLY);
    }

    // --- Core Logic (Override Hook) ---

    function _update(address from, address to, uint256 value) internal virtual override {
        // Prevent re-entrancy during tax processing
        if (_isProcessingTax) {
            super._update(from, to, value);
            return;
        }

        if (from == address(0) || to == address(0)) {
            _transferStandard(from, to, value);
            return;
        }

        // Check if tax should be applied
        bool takeTax = !isExcludedFromTax[from] && !isExcludedFromTax[to];

        if (takeTax && value > 0 && totalTaxRateBps > 0) {
            _isProcessingTax = true;

            // --- Calculate Taxes ---
            uint256 reflectionTaxAmount = (value * reflectionTaxRateBps) / BPS_DIVISOR;
            uint256 prankFundTaxAmount = (value * prankFundTaxRateBps) / BPS_DIVISOR;
            uint256 burnTaxAmount = (value * burnTaxRateBps) / BPS_DIVISOR;
            uint256 amountAfterTax = value - reflectionTaxAmount - prankFundTaxAmount - burnTaxAmount;

            require(amountAfterTax <= value, "Tax calculation overflow");

            // --- Apply Taxes & Reflections ---

            // 1. Distribute Reflection Tax (reduce _rTotal)
            if (reflectionTaxAmount > 0) {
                uint256 rReflectionTax = reflectionFromToken(reflectionTaxAmount);
                _rTotal = (_rTotal > rReflectionTax) ? _rTotal - rReflectionTax : 0;
            }

            // 2. Transfer Burn Tax
            if (burnTaxAmount > 0) {
                _transferStandard(from, DEAD_ADDRESS, burnTaxAmount);
            }

            // 3. Transfer Prank Fund Tax
            if (prankFundTaxAmount > 0) {
                _transferStandard(from, prankFundWallet, prankFundTaxAmount);
            }

            emit TaxPaid(from, to, reflectionTaxAmount, prankFundTaxAmount, burnTaxAmount);

            // 4. Transfer Actual Amount
            if (amountAfterTax > 0) {
                _transferStandard(from, to, amountAfterTax);
            }

            _isProcessingTax = false;

        } else {
            _transferStandard(from, to, value);
        }
    }

    // --- Internal Reflection Helper ---

    function _transferStandard(address sender, address recipient, uint256 tAmount) internal {
        uint256 senderBalance = (sender == address(0)) ? 0 : _requireOwned(sender);
        uint256 currentRate = _getRate();
        emit LogTransferStandard(sender, recipient, tAmount, senderBalance, currentRate);

        if (sender != address(0)) { require(senderBalance >= tAmount, "ERC20: transfer amount exceeds balance"); }

        super._update(sender, recipient, tAmount);

        // Initial Mint
        if (sender == address(0) && tAmount == TOTAL_SUPPLY) {
            require(recipient == owner(), "Initial supply must go to owner");
            _rOwned[recipient] = _rTotal;
            return;
        }

        uint256 tSupply = totalSupply();
        if (tSupply == 0 || _rTotal == 0) return;

        uint256 rAmount = tAmount * currentRate;

        if (rAmount == 0) return;

        // Update reflected balances for ALL accounts.
        // Excluded accounts need accurate _rOwned because it is subtracted in _getCurrentSupply.
        uint256 senderROwned = _rOwned[sender];
        if (senderROwned >= rAmount) {
            _rOwned[sender] = senderROwned - rAmount;
        } else {
            // Should not happen if state is consistent, but safety check
            _rTotal -= (rAmount - senderROwned);
            _rOwned[sender] = 0;
        }

        _rOwned[recipient] = _rOwned[recipient] + rAmount;
    }

    // --- Owner Functions ---

    function setExcludedFromReflections(address _account, bool _isExcluded) external onlyOwner {
        require(_account != address(0), "Account cannot be zero address");
        _excludeFromReflections(_account, _isExcluded);
    }

    // --- Reflection Helper Functions ---

    function tokenFromReflection(uint256 rAmount) internal view returns (uint256) {
        uint256 currentRate = _getRate();
        if (currentRate == 0) return 0;
        return rAmount / currentRate;
    }

    function reflectionFromToken(uint256 tAmount) internal view returns (uint256) {
        uint256 currentRate = _getRate();
        return tAmount * currentRate;
    }

    function _getRate() internal view returns (uint256) {
        (uint256 rSupply, uint256 tSupply) = _getCurrentSupply();
        if (tSupply == 0) return 0;
        return rSupply / tSupply;
    }

    function _getCurrentSupply() public view returns (uint256, uint256) {
        uint256 rSupply = _rTotal;
        uint256 tSupply = totalSupply(); // Total supply from ERC20

        // If total supply is zero, we can't calculate a rate or supply. Return current state.
        if (tSupply == 0) return (_rTotal, 0);

        // Subtract the balances of excluded accounts to get the "circulating" reflection supply
        for (uint256 i = 0; i < _excludedFromReflectionsList.length; i++) {
            address account = _excludedFromReflectionsList[i];
            uint256 rBalance = _rOwned[account];
            uint256 tBalance = _requireOwned(account);

            if (rBalance > rSupply || tBalance > tSupply) {
                return (_rTotal, totalSupply()); // Logic break protection, return raw totals
            }
            rSupply -= rBalance;
            tSupply -= tBalance;
        }

        if (rSupply < _rTotal / totalSupply()) { // Prevent extremely small rate (dust error)
             return (_rTotal, totalSupply());
        }

        return (rSupply, tSupply);
    }

    function _excludeFromReflections(address account, bool excluded) internal {
        require(isExcludedFromReflections[account] != excluded, "Account already in desired state");

        if (excluded) {
            // Check if user has rOwned and verify validity
            if (_rOwned[account] > 0) {
                 // When excluding, we do NOT change _rTotal.
                 // We simply add them to the list, so they are subtracted in _getRate.
            }
            isExcludedFromReflections[account] = true;
            _excludedFromReflectionsList.push(account);
        } else {
            // If including, we need to set their rOwned to match their current tOwned at current rate
            // But we must do this BEFORE removing them from exclusion list so rate is calculated correctly (without them)
            // Actually, if we remove them from list first, _getRate includes them, which changes rate.
            // Standard approach:
            // 1. Calculate new rOwned based on current rate.
            // 2. Remove from list.

            for (uint256 i = 0; i < _excludedFromReflectionsList.length; i++) {
                if (_excludedFromReflectionsList[i] == account) {
                    _excludedFromReflectionsList[i] = _excludedFromReflectionsList[_excludedFromReflectionsList.length - 1];
                    _excludedFromReflectionsList.pop();
                    break;
                }
            }
            isExcludedFromReflections[account] = false;

            // Now they are included. We need to set their _rOwned so their balance matches.
            // But since they were excluded, they only had tOwned.
            // We need to give them rOwned = tOwned * currentRate.
            uint256 tOwned = _requireOwned(account);
            uint256 currentRate = _getRate();
            _rOwned[account] = tOwned * currentRate;
        }

        emit ExcludedFromReflections(account, excluded);
    }

    function setTaxRates(uint16 _reflectionBps, uint16 _prankFundBps, uint16 _burnBps) external onlyOwner {
        uint16 newTotalBps = _reflectionBps + _prankFundBps + _burnBps;
        require(newTotalBps <= MAX_TAX_RATE_BPS, "Total tax rate exceeds maximum allowed");

        reflectionTaxRateBps = _reflectionBps;
        prankFundTaxRateBps = _prankFundBps;
        burnTaxRateBps = _burnBps;
        totalTaxRateBps = newTotalBps;

        emit TaxesUpdated(_reflectionBps, _prankFundBps, _burnBps);
    }

    function setPrankFundWallet(address _newWallet) external onlyOwner {
        require(_newWallet != address(0), "New wallet cannot be zero address");
        prankFundWallet = _newWallet;
        emit PrankFundWalletUpdated(_newWallet);
    }

    function excludeFromTax(address _account) external onlyOwner {
        require(_account != address(0), "Account cannot be zero address");
        if (!isExcludedFromTax[_account]) {
            isExcludedFromTax[_account] = true;
            emit ExcludedFromTax(_account, true);
        }
    }

    function includeInTax(address _account) external onlyOwner {
        require(_account != address(0), "Account cannot be zero address");
        if (isExcludedFromTax[_account]) {
            isExcludedFromTax[_account] = false;
            emit ExcludedFromTax(_account, false);
        }
    }

    // --- Overridden ERC20 View Functions ---

    function balanceOf(address account) public view virtual override returns (uint256) {
        if (isExcludedFromReflections[account]) {
            return _requireOwned(account);
        }
        return tokenFromReflection(_rOwned[account]);
    }

    function _requireOwned(address account) internal view returns (uint256) {
        return super.balanceOf(account);
    }

    // --- Public View Functions ---

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    function getRTotal() public view returns (uint256) {
        return _rTotal;
    }
}

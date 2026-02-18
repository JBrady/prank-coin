// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PrankCoinV3
 * @notice Predictable ERC20 core with opt-in prank mechanics.
 */
contract PrankCoinV3 is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 69_420_000_000_000 * (10 ** 18);
    uint16 public constant BPS_DIVISOR = 10_000;
    uint16 public constant MAX_TOTAL_TAX_BPS = 1_000; // 10%
    uint16 public constant MAX_LUCKY_PAYOUT_BPS = 2_000; // 20%
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    enum PrankMode {
        OFF,
        CONFETTI,
        REVERSE_DAY,
        LUCKY_DROP
    }

    struct PrankParameters {
        uint32 confettiModulo;
        uint32 reverseDayModulo;
        uint32 luckyDropModulo;
        uint16 luckyPayoutBps;
        uint256 luckyMaxPayout;
        bool luckyRequiresWindow;
    }

    struct ScheduledMode {
        PrankMode mode;
        uint64 startTime;
        uint64 endTime;
        bool active;
    }

    uint16 public treasuryTaxRateBps = 80; // 0.8%
    uint16 public burnTaxRateBps = 40; // 0.4%
    uint16 public prankPotTaxRateBps = 30; // 0.3%
    uint16 public totalTaxRateBps = treasuryTaxRateBps + burnTaxRateBps + prankPotTaxRateBps;

    address public treasuryWallet;
    mapping(address => bool) public isExcludedFromTax;

    PrankMode private _configuredMode = PrankMode.OFF;
    ScheduledMode private _scheduledMode;
    PrankParameters private _prankParameters;

    bool private _isInternalTransfer;

    event TaxesUpdated(uint16 treasuryBps, uint16 burnBps, uint16 prankPotBps);
    event TreasuryWalletUpdated(address indexed newWallet);
    event ExcludedFromTax(address indexed account, bool isExcluded);
    event PrankModeUpdated(PrankMode indexed configuredMode, PrankMode indexed effectiveMode, bool scheduledActive);
    event PrankModeScheduled(PrankMode indexed mode, uint64 indexed startTime, uint64 indexed endTime);
    event PrankScheduleCleared();
    event PrankParametersUpdated(
        uint32 confettiModulo,
        uint32 reverseDayModulo,
        uint32 luckyDropModulo,
        uint16 luckyPayoutBps,
        uint256 luckyMaxPayout,
        bool luckyRequiresWindow
    );
    event TaxPaid(
        address indexed from,
        address indexed to,
        uint256 treasuryAmount,
        uint256 burnAmount,
        uint256 prankPotAmount
    );
    event PrankTriggered(PrankMode indexed mode, address indexed from, address indexed to, uint256 amount, bytes32 triggerId);
    event LuckyTransfer(address indexed recipient, uint256 payout, uint256 prankPotBalanceAfter);

    constructor(address initialOwner, address initialTreasuryWallet) ERC20("Prank coin V3", "PRNK") Ownable(initialOwner) {
        require(initialTreasuryWallet != address(0), "Treasury wallet cannot be zero address");

        treasuryWallet = initialTreasuryWallet;

        _prankParameters = PrankParameters({
            confettiModulo: 100,
            reverseDayModulo: 69,
            luckyDropModulo: 420,
            luckyPayoutBps: 50,
            luckyMaxPayout: 50_000 * (10 ** 18),
            luckyRequiresWindow: true
        });

        isExcludedFromTax[initialOwner] = true;
        isExcludedFromTax[address(this)] = true;
        isExcludedFromTax[treasuryWallet] = true;
        isExcludedFromTax[DEAD_ADDRESS] = true;

        _mint(initialOwner, TOTAL_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function setTaxRates(uint16 treasuryBps, uint16 burnBps, uint16 prankPotBps) external onlyOwner {
        uint16 newTotal = treasuryBps + burnBps + prankPotBps;
        require(newTotal <= MAX_TOTAL_TAX_BPS, "Total tax rate exceeds max");

        treasuryTaxRateBps = treasuryBps;
        burnTaxRateBps = burnBps;
        prankPotTaxRateBps = prankPotBps;
        totalTaxRateBps = newTotal;

        emit TaxesUpdated(treasuryBps, burnBps, prankPotBps);
    }

    function setTreasuryWallet(address newWallet) external onlyOwner {
        require(newWallet != address(0), "Treasury wallet cannot be zero address");
        treasuryWallet = newWallet;
        isExcludedFromTax[newWallet] = true;
        emit TreasuryWalletUpdated(newWallet);
    }

    function excludeFromTax(address account) external onlyOwner {
        require(account != address(0), "Account cannot be zero address");
        if (!isExcludedFromTax[account]) {
            isExcludedFromTax[account] = true;
            emit ExcludedFromTax(account, true);
        }
    }

    function includeInTax(address account) external onlyOwner {
        require(account != address(0), "Account cannot be zero address");
        if (isExcludedFromTax[account]) {
            isExcludedFromTax[account] = false;
            emit ExcludedFromTax(account, false);
        }
    }

    function setPrankMode(uint8 modeValue) external onlyOwner {
        require(modeValue <= uint8(PrankMode.LUCKY_DROP), "Invalid prank mode");
        _configuredMode = PrankMode(modeValue);

        (PrankMode effectiveMode, bool scheduledActive) = _effectivePrankMode();
        emit PrankModeUpdated(_configuredMode, effectiveMode, scheduledActive);
    }

    function schedulePrankMode(uint8 modeValue, uint64 startTime, uint64 endTime) external onlyOwner {
        require(modeValue <= uint8(PrankMode.LUCKY_DROP), "Invalid prank mode");
        require(endTime > startTime, "Invalid prank schedule");
        require(endTime > block.timestamp, "Prank schedule in past");

        _scheduledMode = ScheduledMode({
            mode: PrankMode(modeValue),
            startTime: startTime,
            endTime: endTime,
            active: true
        });

        emit PrankModeScheduled(_scheduledMode.mode, startTime, endTime);

        (PrankMode effectiveMode, bool scheduledActive) = _effectivePrankMode();
        emit PrankModeUpdated(_configuredMode, effectiveMode, scheduledActive);
    }

    function clearScheduledPrankMode() external onlyOwner {
        _scheduledMode.active = false;
        emit PrankScheduleCleared();

        (PrankMode effectiveMode, bool scheduledActive) = _effectivePrankMode();
        emit PrankModeUpdated(_configuredMode, effectiveMode, scheduledActive);
    }

    function setPrankParameters(
        uint32 confettiModulo,
        uint32 reverseDayModulo,
        uint32 luckyDropModulo,
        uint16 luckyPayoutBps,
        uint256 luckyMaxPayout,
        bool luckyRequiresWindow
    ) external onlyOwner {
        require(confettiModulo > 1, "Confetti modulo too small");
        require(reverseDayModulo > 1, "Reverse modulo too small");
        require(luckyDropModulo > 1, "Lucky modulo too small");
        require(luckyPayoutBps <= MAX_LUCKY_PAYOUT_BPS, "Lucky payout exceeds max");
        require(luckyMaxPayout > 0, "Lucky max payout must be > 0");

        _prankParameters = PrankParameters({
            confettiModulo: confettiModulo,
            reverseDayModulo: reverseDayModulo,
            luckyDropModulo: luckyDropModulo,
            luckyPayoutBps: luckyPayoutBps,
            luckyMaxPayout: luckyMaxPayout,
            luckyRequiresWindow: luckyRequiresWindow
        });

        emit PrankParametersUpdated(
            confettiModulo,
            reverseDayModulo,
            luckyDropModulo,
            luckyPayoutBps,
            luckyMaxPayout,
            luckyRequiresWindow
        );
    }

    function getPrankMode() external view returns (PrankMode configuredMode, PrankMode effectiveMode, bool scheduledActive) {
        (effectiveMode, scheduledActive) = _effectivePrankMode();
        return (_configuredMode, effectiveMode, scheduledActive);
    }

    function getPrankParameters() external view returns (PrankParameters memory) {
        return _prankParameters;
    }

    function isPrankWindowActive() public view returns (bool) {
        if (!_scheduledMode.active) {
            return false;
        }
        return block.timestamp >= _scheduledMode.startTime && block.timestamp <= _scheduledMode.endTime;
    }

    function scheduledPrankMode()
        external
        view
        returns (PrankMode mode, uint64 startTime, uint64 endTime, bool active)
    {
        return (_scheduledMode.mode, _scheduledMode.startTime, _scheduledMode.endTime, _scheduledMode.active);
    }

    function prankPotBalance() external view returns (uint256) {
        return balanceOf(address(this));
    }

    function _update(address from, address to, uint256 value) internal override {
        if (_isInternalTransfer || from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }

        bool applyTax = value > 0 && totalTaxRateBps > 0 && !isExcludedFromTax[from] && !isExcludedFromTax[to];

        if (!applyTax) {
            super._update(from, to, value);
            _handlePrank(from, to, value);
            return;
        }

        uint256 treasuryAmount = (value * treasuryTaxRateBps) / BPS_DIVISOR;
        uint256 burnAmount = (value * burnTaxRateBps) / BPS_DIVISOR;
        uint256 prankPotAmount = (value * prankPotTaxRateBps) / BPS_DIVISOR;
        uint256 netAmount = value - treasuryAmount - burnAmount - prankPotAmount;

        _isInternalTransfer = true;

        if (treasuryAmount > 0) {
            super._update(from, treasuryWallet, treasuryAmount);
        }
        if (burnAmount > 0) {
            super._update(from, DEAD_ADDRESS, burnAmount);
        }
        if (prankPotAmount > 0) {
            super._update(from, address(this), prankPotAmount);
        }
        if (netAmount > 0) {
            super._update(from, to, netAmount);
        }

        _isInternalTransfer = false;

        emit TaxPaid(from, to, treasuryAmount, burnAmount, prankPotAmount);

        _handlePrank(from, to, value);
    }

    function _handlePrank(address from, address to, uint256 amount) internal {
        (PrankMode mode, bool scheduledActive) = _effectivePrankMode();
        if (mode == PrankMode.OFF) {
            return;
        }

        PrankParameters memory params = _prankParameters;

        if (mode == PrankMode.CONFETTI && amount % params.confettiModulo == 0) {
            emit PrankTriggered(mode, from, to, amount, keccak256("CONFETTI"));
            return;
        }

        if (mode == PrankMode.REVERSE_DAY && amount % params.reverseDayModulo == 0) {
            emit PrankTriggered(mode, to, from, amount, keccak256("REVERSE_DAY"));
            return;
        }

        if (mode == PrankMode.LUCKY_DROP) {
            if (params.luckyRequiresWindow && !scheduledActive) {
                return;
            }
            if (amount % params.luckyDropModulo != 0) {
                return;
            }

            uint256 currentPrankPotBalance = balanceOf(address(this));
            if (currentPrankPotBalance == 0) {
                return;
            }

            uint256 payout = (amount * params.luckyPayoutBps) / BPS_DIVISOR;
            if (payout > params.luckyMaxPayout) {
                payout = params.luckyMaxPayout;
            }
            if (payout > currentPrankPotBalance) {
                payout = currentPrankPotBalance;
            }

            if (payout == 0) {
                return;
            }

            _isInternalTransfer = true;
            super._update(address(this), to, payout);
            _isInternalTransfer = false;

            emit LuckyTransfer(to, payout, balanceOf(address(this)));
            emit PrankTriggered(mode, from, to, amount, keccak256(abi.encodePacked("LUCKY_DROP", to, amount, payout)));
        }
    }

    function _effectivePrankMode() internal view returns (PrankMode mode, bool scheduledActive) {
        scheduledActive = isPrankWindowActive();
        if (scheduledActive) {
            return (_scheduledMode.mode, true);
        }
        return (_configuredMode, false);
    }
}

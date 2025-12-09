# Security Review: PrankCoinV2

## Executive Summary
A security review was conducted on `PrankCoinV2.sol`. Two **CRITICAL** severity issues were identified related to the reflection mechanism logic, along with one Low severity issue.

The Critical issues allow for massive artificial inflation of user balances and permanent distortion of the tokenomics state, rendering the contract unusable in its current form if exclusions are used.

## Findings

### 1. [CRITICAL] Artificial Balance Inflation via Exclusion
**Description:** The reflection rate calculation in `_getRate()` is incorrect. It divides the reflected total (`_rTotal`) by the *entire* total supply (`totalSupply()`), regardless of whether some accounts are excluded from reflections.
When an account is excluded, its `rOwned` tokens are removed from `_rTotal`, but its `tOwned` tokens remain in `totalSupply()`. This causes the `rate` (`_rTotal / totalSupply`) to decrease. Since user balances are calculated as `rOwned / rate`, a decrease in `rate` (denominator) causes an immediate increase in the calculated balance for all other users.
**Impact:** If a large holder (e.g., 50% supply) is excluded, all other users' balances will visually double. This can be exploited or accidentally triggered to break the token economy.
**Reproduction:** Confirmed via `test/reproduce_issue.js`.
**Recommendation:** The `rate` calculation must consider only the *circulating* supply that participates in reflections. Standard RFI implementations iterate over excluded accounts to subtract their `rOwned` and `tOwned` from the totals used in the rate calculation.

### 2. [CRITICAL] `_rTotal` Not Updated on Re-inclusion
**Description:** In `_excludeFromReflections`, when an account is re-included (`excluded == false`), their `rOwned` balance is recalculated and assigned. However, the `_rTotal` (total reflected supply) is **NOT** increased by this new `rOwned` amount.
**Impact:** `_rTotal` remains permanently lower. This permanently lowers the rate, inflating balances (as per finding #1) and "burning" the reflection capability for that amount. The state becomes inconsistent.
**Reproduction:** Confirmed via `test/reproduce_issue.js`.
**Recommendation:** When re-including an account, `_rTotal` must be increased by the calculated `rOwned` amount of that account.

### 3. [LOW] Missing Event Emission
**Description:** The `ExcludedFromReflections` event is defined but not emitted in the `_excludeFromReflections` function.
**Impact:** Off-chain indexers and UIs will not be able to track exclusions correctly.
**Recommendation:** Emit the event in `_excludeFromReflections`.

### 4. [INFORMATIONAL] Centralization Risk
**Description:** The `owner` has significant power:
- Can exclude/include any account from reflections (triggering the Critical bugs above).
- Can set tax rates up to 10%.
- Can change the Prank Fund wallet.
**Recommendation:** Use a MultiSig wallet for the owner address and consider renouncing ownership or using a TimeLock after initial setup.

## Next Steps
1.  **Refactor `_getRate()`:** Implement the standard RFI loop to calculate `rSupply` and `tSupply` dynamically by subtracting excluded accounts.
2.  **Fix `_excludeFromReflections`:** Ensure `_rTotal` is correctly managed, or rely on the dynamic loop approach which avoids modifying `_rTotal` statefully for exclusions.
3.  **Emit Events:** Add the missing event emission.
4.  **Retest:** Verify fixes with the reproduction script and full test suite.

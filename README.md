# PrankCoin

PrankCoin is an ERC20 token for Mantle with a predictable token core and an opt-in prank layer.

## Version
- Current deployment target: `PrankCoinV3`
- Legacy contract: `PrankCoinV2` (kept for migration compatibility)

## Features
- Bounded transfer taxes with immutable cap (`MAX_TOTAL_TAX_BPS = 10%`)
- Transparent tax destinations: treasury, burn address, and prank pot
- Deterministic prank modes (no hidden balance mutation)
  - `OFF`
  - `CONFETTI`
  - `REVERSE_DAY`
  - `LUCKY_DROP`
- Timelock-ready ownership model for governance

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example` and set deployment values.

Local compile/test does not require a deployer private key.

## Usage
- Compile:
  ```bash
  npm run compile
  ```
- Test:
  ```bash
  npm test
  ```
- Deploy V3 to Mantle Sepolia:
  ```bash
  npm run deploy:v3:mantle-testnet
  ```
- Deploy V3 to Mantle Mainnet:
  ```bash
  npm run deploy:v3:mantle-mainnet
  ```

## Governance and rollout
- Deploy `TimelockController` + `PrankCoinV3` via `scripts/deploy-v3.js`
- Use governance multisig as proposer/executor through timelock
- Follow migration process in `docs/migration-v2-to-v3.md`

## CI
GitHub Actions runs compile + tests on push and pull requests.

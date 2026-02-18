# PrankCoin V2 -> V3 Migration Runbook

## Scope
This runbook defines the operational migration from `PrankCoinV2` to `PrankCoinV3` on Mantle.

## Timeline (example)
- Announcement date: March 1, 2026
- V3 deployment date: March 8, 2026
- Migration window: March 8, 2026 to April 8, 2026
- V2 feature freeze: March 8, 2026
- V2 deprecation notice: April 8, 2026

## Contracts and verification links
Fill these before launch:

- Mantle Sepolia Timelock: `TBD`
- Mantle Sepolia PrankCoinV3: `TBD`
- Mantle Mainnet Timelock: `TBD`
- Mantle Mainnet PrankCoinV3: `TBD`

Verification links:
- Sepolia explorer: `https://sepolia.mantlescan.xyz`
- Mainnet explorer: `https://mantlescan.xyz`

## Governance model
- Token owner is the deployed `TimelockController`.
- Primary proposer/executor is the governance multisig.
- Timelock minimum delay defaults to 24 hours.

## Migration mechanism
1. Deploy `TimelockController` and `PrankCoinV3` using `scripts/deploy-v3.js`.
2. Publish deployment tx hashes, addresses, and verification links.
3. Seed migration liquidity/allocation wallet for 1:1 V2->V3 distribution.
4. Holders transfer V2 to migration vault and receive equal V3 amount.
5. After migration deadline, publish final migration stats.

## Operational decisions
- V2 remains transferable but receives no new feature updates after V3 deployment.
- All future economic and prank parameter changes happen through timelock governance on V3.
- Emergency communication path is governance multisig + project social channels.

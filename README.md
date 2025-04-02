# Meme Coin Project

This project contains the smart contract and deployment scripts for our awesome meme coin on the Mantle Network.

## Setup

1. Clone the repository.
2. Install dependencies: `npm install`
3. Create a `.env` file based on `.env.example` (you'll create this file later) and add your private key and RPC URLs.

## Usage

- Compile contracts: `npx hardhat compile`
- Run tests: `npx hardhat test`
- Deploy to Mantle Testnet: `npx hardhat run scripts/deploy.js --network mantleTestnet`
- Deploy to Mantle Mainnet: `npx hardhat run scripts/deploy.js --network mantleMainnet`

require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */

// Ensure that we have all the environment variables we need.
const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  throw new Error("Please set your PRIVATE_KEY in a .env file");
}

const mantleTestnetRpcUrl = process.env.MANTLE_TESTNET_RPC_URL;
if (!mantleTestnetRpcUrl) {
    // Use a public RPC if not set, but recommend setting your own
    console.warn("MANTLE_TESTNET_RPC_URL not set in .env, using public RPC. Consider getting your own from Alchemy, Infura, or the Mantle docs.");
}

const mantleMainnetRpcUrl = process.env.MANTLE_MAINNET_RPC_URL;
if (!mantleMainnetRpcUrl) {
    // Use a public RPC if not set, but recommend setting your own
    console.warn("MANTLE_MAINNET_RPC_URL not set in .env, using public RPC. Consider getting your own from Alchemy, Infura, or the Mantle docs.");
}


module.exports = {
  solidity: "0.8.24", // Use an appropriate Solidity version
  networks: {
    hardhat: {
        // Configuration for the local Hardhat Network
    },
    mantleTestnet: {
      url: mantleTestnetRpcUrl || "https://rpc.testnet.mantle.xyz", // Public RPC
      accounts: [`0x${privateKey}`],
      chainId: 5001
    },
    mantleMainnet: {
      url: mantleMainnetRpcUrl || "https://rpc.mantle.xyz", // Public RPC
      accounts: [`0x${privateKey}`],
      chainId: 5000
    }
  },
  etherscan: {
    // Optional: Add API key for contract verification on MantleScan
    apiKey: {
        mantleTestnet: process.env.MANTLESCAN_API_KEY, // Obtain from MantleScan
        mantleMainnet: process.env.MANTLESCAN_API_KEY // Obtain from MantleScan
    },
    customChains: [
        {
            network: "mantleTestnet",
            chainId: 5001,
            urls: {
                apiURL: "https://api.testnet.mantlescan.xyz/api",
                browserURL: "https://testnet.mantlescan.xyz"
            }
        },
        {
            network: "mantleMainnet",
            chainId: 5000,
            urls: {
                apiURL: "https://api.mantlescan.xyz/api",
                browserURL: "https://mantlescan.xyz"
            }
        }
    ]
  },
  sourcify: {
    // Optional: Enable contract verification via Sourcify
    enabled: true
  }
};

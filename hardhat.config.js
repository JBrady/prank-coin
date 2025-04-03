require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */

// Ensure that we have all the environment variables we need.
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!deployerPrivateKey) {
  throw new Error("Please set your DEPLOYER_PRIVATE_KEY in a .env file");
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
      accounts: [`0x${deployerPrivateKey}`],
      chainId: 5003 // Updated Chain ID for Mantle Sepolia Testnet
    },
    mantleMainnet: {
      url: mantleMainnetRpcUrl || "https://rpc.mantle.xyz", // Public RPC
      accounts: [`0x${deployerPrivateKey}`],
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
            chainId: 5003, // Updated Chain ID for Mantle Sepolia Testnet
            urls: {
               // TODO: Verify Mantle Sepolia Scan API and Browser URLs
               apiURL: "https://api.sepolia.mantlescan.xyz/api", // Likely URL - VERIFY!
               browserURL: "https://sepolia.mantlescan.xyz/" // Likely URL - VERIFY!
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

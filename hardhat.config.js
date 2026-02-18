require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || "";
const hasPrivateKey = /^[0-9a-fA-F]{64}$/.test(deployerPrivateKey);

if (!hasPrivateKey) {
  console.warn("DEPLOYER_PRIVATE_KEY is not set. Local compile/test works, but external deployments are disabled.");
}

const sharedAccounts = hasPrivateKey ? [`0x${deployerPrivateKey}`] : [];

module.exports = {
  solidity: "0.8.24",
  networks: {
    hardhat: {},
    mantleTestnet: {
      url: process.env.MANTLE_TESTNET_RPC_URL || "https://rpc.sepolia.mantle.xyz",
      accounts: sharedAccounts,
      chainId: 5003,
    },
    mantleMainnet: {
      url: process.env.MANTLE_MAINNET_RPC_URL || "https://rpc.mantle.xyz",
      accounts: sharedAccounts,
      chainId: 5000,
    },
  },
  etherscan: {
    apiKey: {
      mantleTestnet: process.env.MANTLESCAN_API_KEY || "",
      mantleMainnet: process.env.MANTLESCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "mantleTestnet",
        chainId: 5003,
        urls: {
          apiURL: "https://api-sepolia.mantlescan.xyz/api",
          browserURL: "https://sepolia.mantlescan.xyz",
        },
      },
      {
        network: "mantleMainnet",
        chainId: 5000,
        urls: {
          apiURL: "https://api.mantlescan.xyz/api",
          browserURL: "https://mantlescan.xyz",
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
  },
};

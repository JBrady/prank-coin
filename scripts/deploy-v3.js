const hre = require("hardhat");
require("dotenv").config();

function parseAddressList(value) {
  if (!value || !value.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function main() {
  const networkName = hre.network.name;
  if (networkName === "hardhat") {
    throw new Error("Refusing to run deploy-v3 on hardhat network. Use mantleTestnet or mantleMainnet.");
  }

  const treasuryWallet = process.env.PRANK_TREASURY_WALLET_ADDRESS;
  if (!treasuryWallet) {
    throw new Error("Missing PRANK_TREASURY_WALLET_ADDRESS in .env");
  }

  const governanceMultisig = process.env.GOVERNANCE_MULTISIG_ADDRESS;
  if (!governanceMultisig) {
    throw new Error("Missing GOVERNANCE_MULTISIG_ADDRESS in .env");
  }

  const timelockAdmin = process.env.TIMELOCK_ADMIN_ADDRESS || governanceMultisig;
  const timelockMinDelaySeconds = Number(process.env.TIMELOCK_MIN_DELAY_SECONDS || "86400");

  const proposerAddresses = parseAddressList(process.env.TIMELOCK_PROPOSERS || governanceMultisig);
  const executorAddresses = parseAddressList(process.env.TIMELOCK_EXECUTORS || governanceMultisig);

  if (!proposerAddresses.length || !executorAddresses.length) {
    throw new Error("TIMELOCK_PROPOSERS and TIMELOCK_EXECUTORS must resolve to at least one address");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying with ${deployer.address} on ${networkName}`);

  const TimelockController = await hre.ethers.getContractFactory("TimelockController");
  const timelock = await TimelockController.deploy(
    timelockMinDelaySeconds,
    proposerAddresses,
    executorAddresses,
    timelockAdmin
  );
  await timelock.waitForDeployment();

  const timelockAddress = await timelock.getAddress();
  console.log(`TimelockController deployed: ${timelockAddress}`);

  const PrankCoinV3 = await hre.ethers.getContractFactory("PrankCoinV3");
  const prankCoinV3 = await PrankCoinV3.deploy(timelockAddress, treasuryWallet);
  await prankCoinV3.waitForDeployment();

  const tokenAddress = await prankCoinV3.getAddress();
  console.log(`PrankCoinV3 deployed: ${tokenAddress}`);

  console.log("\nDeployment summary");
  console.log(`- network: ${networkName}`);
  console.log(`- timelock: ${timelockAddress}`);
  console.log(`- token: ${tokenAddress}`);
  console.log(`- treasury wallet: ${treasuryWallet}`);
  console.log(`- governance multisig: ${governanceMultisig}`);
  console.log(`- min delay (s): ${timelockMinDelaySeconds}`);

  console.log("\nVerify commands:");
  console.log(
    `npx hardhat verify --network ${networkName} ${timelockAddress} ${timelockMinDelaySeconds} \"[${proposerAddresses.map((a) => `\\\"${a}\\\"`).join(",")}]\" \"[${executorAddresses.map((a) => `\\\"${a}\\\"`).join(",")}]\" ${timelockAdmin}`
  );
  console.log(`npx hardhat verify --network ${networkName} ${tokenAddress} ${timelockAddress} ${treasuryWallet}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

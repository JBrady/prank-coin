const hre = require("hardhat");
require("dotenv").config(); // Load .env file variables

async function main() {
  // --- Configurable Values ---
  // Read Prank Fund wallet address from .env file
  const prankFundWalletAddress = process.env.PRANK_FUND_WALLET_ADDRESS;
  if (!prankFundWalletAddress) {
    console.error("Error: PRANK_FUND_WALLET_ADDRESS not found in .env file.");
    process.exit(1);
  }
  console.log("Using Prank Fund Wallet Address:", prankFundWalletAddress);

  const initialReflectionTaxBps = 100; // 1.00%
  const initialPrankFundTaxBps = 100;  // 1.00%
  const initialBurnTaxBps = 100;       // 1.00%
  // --------------------------

  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  const initialOwner = deployer.address; // The deployer will be the initial owner

  // Get the contract factory for PrankCoinV2
  const PrankCoinV2 = await hre.ethers.getContractFactory("PrankCoinV2");

  // Deploy the contract, passing the initial owner to the constructor
  console.log("Deploying PrankCoinV2...");
  const prankCoinV2 = await PrankCoinV2.deploy(
    initialOwner,           // Set the deployer as the initial owner
    prankFundWalletAddress  // Set the designated prank fund wallet
  );

  // Wait for the deployment transaction to be mined
  await prankCoinV2.waitForDeployment();

  const contractAddress = await prankCoinV2.getAddress();

  console.log(`\nPrankCoinV2 deployed to: ${contractAddress}`);

  // Set initial tax rates after deployment using the owner account
  console.log("\nSetting initial tax rates using setTaxRates()...");
  const setTaxTx = await prankCoinV2.connect(deployer).setTaxRates(
    initialReflectionTaxBps,
    initialPrankFundTaxBps,
    initialBurnTaxBps
  );
  await setTaxTx.wait();

  console.log(`Initial tax rates set: Reflection=${initialReflectionTaxBps}, PrankFund=${initialPrankFundTaxBps}, Burn=${initialBurnTaxBps} BPS`);

  console.log(`Verify on MantleScan (Mainnet): https://mantlescan.xyz/address/${contractAddress}`);
  console.log(`Verify on MantleScan (Testnet): https://testnet.mantlescan.xyz/address/${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  const initialOwner = deployer.address; // The deployer will be the initial owner

  // Get the contract factory
  const PrankCoin = await hre.ethers.getContractFactory("PrankCoin");

  // Deploy the contract, passing the initial owner to the constructor
  console.log("Deploying PrankCoin...");
  const prankCoin = await PrankCoin.deploy(initialOwner);

  // Wait for the deployment transaction to be mined
  await prankCoin.waitForDeployment();

  const contractAddress = await prankCoin.getAddress();

  console.log(`PrankCoin (PRNK) deployed to: ${contractAddress}`);
  console.log(`Verify on MantleScan (Mainnet): https://mantlescan.xyz/address/${contractAddress}`);
  console.log(`Verify on MantleScan (Testnet): https://testnet.mantlescan.xyz/address/${contractAddress}`);

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

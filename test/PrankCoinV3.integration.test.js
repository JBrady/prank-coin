const { expect } = require("chai");
const { ethers } = require("hardhat");

const hardhatConfig = require("../hardhat.config");

describe("PrankCoinV3 Integration", function () {
  it("supports timelock-owned governance path", async function () {
    const [deployer, governance, treasury] = await ethers.getSigners();
    const TimelockController = await ethers.getContractFactory("TimelockController");
    const timelock = await TimelockController.deploy(
      3600,
      [governance.address],
      [governance.address],
      governance.address
    );
    await timelock.waitForDeployment();

    const PrankCoinV3 = await ethers.getContractFactory("PrankCoinV3");
    const token = await PrankCoinV3.deploy(await timelock.getAddress(), treasury.address);
    await token.waitForDeployment();

    expect(await token.owner()).to.equal(await timelock.getAddress());
    await expect(token.connect(deployer).setPrankMode(1)).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount"
    );
  });

  it("uses concrete MantleScan verification endpoints", async function () {
    const chains = hardhatConfig.etherscan.customChains;
    const sepolia = chains.find((entry) => entry.network === "mantleTestnet");
    const mainnet = chains.find((entry) => entry.network === "mantleMainnet");

    expect(sepolia.urls.apiURL).to.equal("https://api-sepolia.mantlescan.xyz/api");
    expect(sepolia.urls.browserURL).to.equal("https://sepolia.mantlescan.xyz");
    expect(mainnet.urls.apiURL).to.equal("https://api.mantlescan.xyz/api");
    expect(mainnet.urls.browserURL).to.equal("https://mantlescan.xyz");
  });

  it("keeps external deployment networks configured", async function () {
    expect(hardhatConfig.networks.mantleTestnet.chainId).to.equal(5003);
    expect(hardhatConfig.networks.mantleMainnet.chainId).to.equal(5000);
  });

  it("rehearses a manual V2 -> V3 migration flow", async function () {
    const [owner, treasury, migrationVault, holder] = await ethers.getSigners();

    const PrankCoinV2 = await ethers.getContractFactory("PrankCoinV2");
    const v2 = await PrankCoinV2.deploy(owner.address, treasury.address);
    await v2.waitForDeployment();

    const PrankCoinV3 = await ethers.getContractFactory("PrankCoinV3");
    const v3 = await PrankCoinV3.deploy(owner.address, treasury.address);
    await v3.waitForDeployment();

    const migrateAmount = ethers.parseUnits("1000", 18);

    await v2.connect(owner).transfer(holder.address, migrateAmount);
    await v2.connect(owner).excludeFromTax(holder.address);
    await v2.connect(owner).excludeFromTax(migrationVault.address);

    await v3.connect(owner).transfer(migrationVault.address, migrateAmount);
    await v3.connect(owner).excludeFromTax(holder.address);
    await v3.connect(owner).excludeFromTax(migrationVault.address);

    await v2.connect(holder).transfer(migrationVault.address, migrateAmount);
    await v3.connect(migrationVault).transfer(holder.address, migrateAmount);

    expect(await v2.balanceOf(holder.address)).to.equal(0);
    expect(await v3.balanceOf(holder.address)).to.equal(migrateAmount);
  });
});

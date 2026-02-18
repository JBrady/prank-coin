const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("PrankCoinV3", function () {
  const DECIMALS = 18n;
  const TOTAL_SUPPLY = 69_420_000_000_000n * (10n ** DECIMALS);
  const BPS_DIVISOR = 10_000n;
  const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

  async function deployFixture() {
    const [owner, treasury, alice, bob, carol] = await ethers.getSigners();
    const PrankCoinV3 = await ethers.getContractFactory("PrankCoinV3");
    const token = await PrankCoinV3.deploy(owner.address, treasury.address);
    await token.waitForDeployment();

    return { token, owner, treasury, alice, bob, carol };
  }

  it("mints total supply to owner and sets defaults", async function () {
    const { token, owner, treasury } = await loadFixture(deployFixture);

    expect(await token.owner()).to.equal(owner.address);
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    expect(await token.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY);
    expect(await token.treasuryWallet()).to.equal(treasury.address);
    expect(await token.totalTaxRateBps()).to.equal(150n);
  });

  it("applies taxes to non-excluded transfers and preserves supply accounting", async function () {
    const { token, owner, treasury, alice, bob } = await loadFixture(deployFixture);

    await token.connect(owner).transfer(alice.address, ethers.parseUnits("10000", 18));

    const transferAmount = ethers.parseUnits("1000", 18);
    const treasuryTax = (transferAmount * 80n) / BPS_DIVISOR;
    const burnTax = (transferAmount * 40n) / BPS_DIVISOR;
    const prankPotTax = (transferAmount * 30n) / BPS_DIVISOR;
    const net = transferAmount - treasuryTax - burnTax - prankPotTax;

    await expect(token.connect(alice).transfer(bob.address, transferAmount))
      .to.emit(token, "TaxPaid")
      .withArgs(alice.address, bob.address, treasuryTax, burnTax, prankPotTax);

    expect(await token.balanceOf(bob.address)).to.equal(net);
    expect(await token.balanceOf(treasury.address)).to.equal(treasuryTax);
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(burnTax);
    expect(await token.balanceOf(await token.getAddress())).to.equal(prankPotTax);

    const trackedSum =
      (await token.balanceOf(owner.address)) +
      (await token.balanceOf(treasury.address)) +
      (await token.balanceOf(alice.address)) +
      (await token.balanceOf(bob.address)) +
      (await token.balanceOf(DEAD_ADDRESS)) +
      (await token.balanceOf(await token.getAddress()));
    expect(trackedSum).to.equal(await token.totalSupply());
  });

  it("enforces tax cap and prank parameter bounds", async function () {
    const { token, owner } = await loadFixture(deployFixture);

    await expect(token.connect(owner).setTaxRates(500, 500, 1)).to.be.revertedWith("Total tax rate exceeds max");
    await expect(token.connect(owner).setPrankParameters(100, 69, 420, 2001, 1, true)).to.be.revertedWith(
      "Lucky payout exceeds max"
    );
  });

  it("uses configured prank mode and emits deterministic events", async function () {
    const { token, owner, alice, bob } = await loadFixture(deployFixture);

    await token.connect(owner).transfer(alice.address, ethers.parseUnits("10000", 18));

    await token.connect(owner).setPrankParameters(10, 9, 7, 100, ethers.parseUnits("5", 18), false);

    await expect(token.connect(owner).setPrankMode(1))
      .to.emit(token, "PrankModeUpdated");

    await expect(token.connect(alice).transfer(bob.address, 1000))
      .to.emit(token, "PrankTriggered");

    await token.connect(owner).setPrankMode(2);
    await expect(token.connect(alice).transfer(bob.address, 900))
      .to.emit(token, "PrankTriggered");
  });

  it("runs lucky drop only when deterministic trigger matches", async function () {
    const { token, owner, alice, bob } = await loadFixture(deployFixture);

    await token.connect(owner).includeInTax(owner.address);
    await token.connect(owner).transfer(alice.address, ethers.parseUnits("20000", 18));

    // Seed prank pot through taxed transfer
    await token.connect(alice).transfer(bob.address, ethers.parseUnits("1000", 18));

    const now = await time.latest();
    await token.connect(owner).setPrankParameters(10, 9, 5, 500, ethers.parseUnits("20", 18), true);
    await token.connect(owner).setPrankMode(0);
    await token.connect(owner).schedulePrankMode(3, BigInt(now - 60), BigInt(now + 3600));

    const before = await token.balanceOf(bob.address);
    await expect(token.connect(alice).transfer(bob.address, 1000))
      .to.emit(token, "LuckyTransfer");
    const afterBal = await token.balanceOf(bob.address);
    expect(afterBal).to.be.gt(before);
  });

  it("exposes active prank window state", async function () {
    const { token, owner } = await loadFixture(deployFixture);

    const now = await time.latest();
    await token.connect(owner).schedulePrankMode(1, BigInt(now + 60), BigInt(now + 120));

    expect(await token.isPrankWindowActive()).to.equal(false);
    await time.increaseTo(now + 80);
    expect(await token.isPrankWindowActive()).to.equal(true);
  });

  it("supports randomized transfer invariants across prank modes", async function () {
    const { token, owner, treasury, alice, bob, carol } = await loadFixture(deployFixture);

    await token.connect(owner).includeInTax(owner.address);
    await token.connect(owner).setPrankParameters(13, 11, 7, 300, ethers.parseUnits("3", 18), false);

    const recipients = [alice, bob, carol];
    await token.connect(owner).transfer(alice.address, ethers.parseUnits("30000", 18));
    await token.connect(owner).transfer(bob.address, ethers.parseUnits("30000", 18));
    await token.connect(owner).transfer(carol.address, ethers.parseUnits("30000", 18));

    for (let i = 1; i <= 24; i++) {
      await token.connect(owner).setPrankMode(i % 4);
      const fromSigner = recipients[i % recipients.length];
      const toSigner = recipients[(i + 1) % recipients.length];
      const amount = BigInt(900 + i * 13);
      await token.connect(fromSigner).transfer(toSigner.address, amount);
    }

    const trackedSum =
      (await token.balanceOf(owner.address)) +
      (await token.balanceOf(treasury.address)) +
      (await token.balanceOf(alice.address)) +
      (await token.balanceOf(bob.address)) +
      (await token.balanceOf(carol.address)) +
      (await token.balanceOf(DEAD_ADDRESS)) +
      (await token.balanceOf(await token.getAddress()));

    expect(trackedSum).to.equal(await token.totalSupply());
  });
});

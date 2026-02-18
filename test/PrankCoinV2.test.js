const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// Helper function for calculating expected amounts after tax
// Note: Solidity performs integer division.
function calculateExpectedAmounts(amount, rates) {
    const reflectionTax = (amount * BigInt(rates.reflectionBps)) / BigInt(rates.divisor);
    const prankFundTax = (amount * BigInt(rates.prankFundBps)) / BigInt(rates.divisor);
    const burnTax = (amount * BigInt(rates.burnBps)) / BigInt(rates.divisor);
    const totalTax = reflectionTax + prankFundTax + burnTax;
    const amountAfterTax = amount - totalTax;
    return {
        reflectionTax,
        prankFundTax,
        burnTax,
        totalTax,
        amountAfterTax
    };
}

// Helper function for calculating expected amounts after tax
// Note: Solidity performs integer division.
const calculateTax = (amount, rateBps) => {
  if (!amount || !rateBps) return 0n; // Use BigInt literal 0n
  const BPS_DIVISOR = 10000n; // Use BigInt literal 10000n
  return (BigInt(amount) * BigInt(rateBps)) / BPS_DIVISOR;
};

// Fixture to deploy the contract fresh for each test scenario
async function deployPrankCoinV2Fixture() {
    const [owner, addr1, addr2, addr3, reflector1, reflector2, prankFundSigner] = await ethers.getSigners();
    const prankFundWalletAddr = prankFundSigner.address; // Use a signer for prank fund

    const PrankCoinV2 = await ethers.getContractFactory("PrankCoinV2");
    const initialReflectionBps = 100; // 1%
    const initialPrankFundBps = 100;  // 1%
    const initialBurnBps = 100;       // 1%

    const prankCoin = await PrankCoinV2.deploy(
      owner.address,
      prankFundWalletAddr
    );
    await prankCoin.waitForDeployment();

    // Set initial tax rates using the correct function
    await prankCoin.connect(owner).setTaxRates(initialReflectionBps, initialPrankFundBps, initialBurnBps);

    // Return everything needed for tests
    return { prankCoin, owner, addr1, addr2, addr3, reflector1, reflector2, prankFundSigner, prankFundWalletAddr, initialReflectionBps, initialPrankFundBps, initialBurnBps };
}

describe("PrankCoinV2", function () {
    let PrankCoinV2, prankCoinV2, owner, addr1, addr2, addr3, addr4, prankFundSigner, addrs;
    const decimals = 18n;
    const TOTAL_SUPPLY = 69_420_000_000_000n * (10n**decimals);
    const BPS_DIVISOR = 10000n;

    // Default tax rates for tests unless specified otherwise
    const DEFAULT_REFLECTION_BPS = 50n; // 0.5%
    const DEFAULT_PRANK_FUND_BPS = 100n; // 1.0%
    const DEFAULT_BURN_BPS = 50n;      // 0.5%
    let prankFundWallet; // Will store the address

    // Deploy the contract before each test
    beforeEach(async function () {
        PrankCoinV2 = await ethers.getContractFactory("PrankCoinV2");
        [owner, addr1, addr2, addr3, addr4, prankFundSigner, ...addrs] = await ethers.getSigners(); // Use prankFundSigner for the signer object

        // Assign the specified address to prankFundWallet for consistency in deployment args
        prankFundWallet = prankFundSigner.address;

        // Deploy the contract, providing the prankFundWallet's address
        prankCoinV2 = await PrankCoinV2.deploy(owner.address, prankFundWallet); // Pass the address here
        await prankCoinV2.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await prankCoinV2.owner()).to.equal(owner.address);
        });

        it("Should assign the total supply of tokens to the owner", async function () {
            const ownerBalance = await prankCoinV2.balanceOf(owner.address);
            expect(await prankCoinV2.totalSupply()).to.equal(TOTAL_SUPPLY);
            expect(ownerBalance).to.equal(TOTAL_SUPPLY);
        });

        it("Should set the correct name and symbol", async function () {
            expect(await prankCoinV2.name()).to.equal("Prank coin V2");
            expect(await prankCoinV2.symbol()).to.equal("PRNK");
        });

        it("Should set the correct decimals", async function () {
            expect(await prankCoinV2.decimals()).to.equal(decimals); // Using our BigInt version
        });

        it("Should set the correct initial tax rates", async function () {
            expect(await prankCoinV2.reflectionTaxRateBps()).to.equal(DEFAULT_REFLECTION_BPS);
            expect(await prankCoinV2.prankFundTaxRateBps()).to.equal(DEFAULT_PRANK_FUND_BPS);
            expect(await prankCoinV2.burnTaxRateBps()).to.equal(DEFAULT_BURN_BPS);
            expect(await prankCoinV2.totalTaxRateBps()).to.equal(
                DEFAULT_REFLECTION_BPS + DEFAULT_PRANK_FUND_BPS + DEFAULT_BURN_BPS
            );
        });

        it("Should set the correct Prank Fund wallet", async function () {
            expect(await prankCoinV2.prankFundWallet()).to.equal(prankFundWallet);
        });

        it("Should exclude owner, contract, prank fund, and dead address from tax by default", async function () {
            const contractAddress = await prankCoinV2.getAddress();
            expect(await prankCoinV2.isExcludedFromTax(owner.address)).to.be.true;
            expect(await prankCoinV2.isExcludedFromTax(contractAddress)).to.be.true;
            expect(await prankCoinV2.isExcludedFromTax(prankFundWallet)).to.be.true;
            expect(await prankCoinV2.isExcludedFromTax("0x000000000000000000000000000000000000dEaD")).to.be.true;
        });

        it("Should NOT exclude a random address from tax by default", async function () {
            expect(await prankCoinV2.isExcludedFromTax(addr1.address)).to.be.false;
        });
    });

    describe("Transactions", function () {
        let transferAmount;

        beforeEach(async function() {
            // Transfer some tokens from owner to addr1 for testing transfers
            transferAmount = ethers.parseUnits("10000", decimals); // 10,000 PRNK
            // Owner is excluded, so no tax on this initial transfer
            await prankCoinV2.connect(owner).transfer(addr1.address, transferAmount);
            expect(await prankCoinV2.balanceOf(addr1.address)).to.equal(transferAmount);
        });

        it("Should transfer tokens between accounts and apply tax", async function () {
            const amountToSend = ethers.parseUnits("1000", decimals);
            const expectedTaxes = calculateExpectedAmounts(amountToSend, { reflectionBps: DEFAULT_REFLECTION_BPS, prankFundBps: DEFAULT_PRANK_FUND_BPS, burnBps: DEFAULT_BURN_BPS, divisor: BPS_DIVISOR });

            const addr1BalanceBefore = await prankCoinV2.balanceOf(addr1.address);
            const addr2BalanceBefore = await prankCoinV2.balanceOf(addr2.address);
            const prankFundBalanceBefore = await prankCoinV2.balanceOf(prankFundWallet);
            const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
            const deadBalanceBefore = await prankCoinV2.balanceOf(DEAD_ADDRESS);

            // Perform the transfer from addr1 to addr2 (both non-excluded)
            const tx = await prankCoinV2.connect(addr1).transfer(addr2.address, amountToSend);
            await tx.wait(); // Wait for transaction receipt to check events

            // Check balances after transfer
            const prankFundBalanceAfter = await prankCoinV2.balanceOf(prankFundWallet);
            const deadBalanceAfter = await prankCoinV2.balanceOf(DEAD_ADDRESS);

            // Verify Prank Fund balance increased correctly by prankFundTax
            expect(prankFundBalanceAfter).to.equal(prankFundBalanceBefore + expectedTaxes.prankFundTax);

            // Verify Burn Address balance increased correctly by burnTax
            expect(deadBalanceAfter).to.equal(deadBalanceBefore + expectedTaxes.burnTax);

            // Verify TaxPaid event was emitted with correct values
            await expect(tx)
                .to.emit(prankCoinV2, "TaxPaid")
                .withArgs(addr1.address, addr2.address, expectedTaxes.reflectionTax, expectedTaxes.prankFundTax, expectedTaxes.burnTax);

            // Check main Transfer event to recipient
            await expect(tx)
                .to.emit(prankCoinV2, "Transfer")
                .withArgs(addr1.address, addr2.address, expectedTaxes.amountAfterTax);
        });

        it("Should transfer tokens without tax if sender is excluded", async function () {
            const amountToSend = ethers.parseUnits("500", decimals);
            const ownerBalanceBefore = await prankCoinV2.balanceOf(owner.address);
            const addr2BalanceBefore = await prankCoinV2.balanceOf(addr2.address);
            const prankFundBalanceBefore = await prankCoinV2.balanceOf(prankFundWallet);
            const deadBalanceBefore = await prankCoinV2.balanceOf("0x000000000000000000000000000000000000dEaD");

            // Perform transfer from owner (excluded) to addr2 (not excluded)
            const tx = await prankCoinV2.connect(owner).transfer(addr2.address, amountToSend);
            await tx.wait();

            // Check balances
            expect(await prankCoinV2.balanceOf(owner.address)).to.equal(ownerBalanceBefore - amountToSend);
            expect(await prankCoinV2.balanceOf(addr2.address)).to.equal(addr2BalanceBefore + amountToSend);
            // No tax should be sent
            expect(await prankCoinV2.balanceOf(prankFundWallet)).to.equal(prankFundBalanceBefore);
            expect(await prankCoinV2.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(deadBalanceBefore);

            // Check the single Transfer event
            await expect(tx)
                .to.emit(prankCoinV2, "Transfer")
                .withArgs(owner.address, addr2.address, amountToSend);
            // Balance checks above are sufficient to confirm no tax was taken.
        });

        it("Should transfer tokens without tax if recipient is excluded", async function () {
            const amountToSend = ethers.parseUnits("500", decimals);
            const addr1BalanceBefore = await prankCoinV2.balanceOf(addr1.address);
            const prankFundBalanceBefore = await prankCoinV2.balanceOf(prankFundWallet);
            const deadBalanceBefore = await prankCoinV2.balanceOf("0x000000000000000000000000000000000000dEaD");

            // Perform transfer from addr1 (not excluded) to prankFundWallet (excluded)
            const tx = await prankCoinV2.connect(addr1).transfer(prankFundWallet, amountToSend);
            await tx.wait();

            // Check balances
            // Allow for tiny dust difference due to reflection logic
            expect(await prankCoinV2.balanceOf(addr1.address)).to.be.closeTo(addr1BalanceBefore - amountToSend, ethers.parseUnits("0.000001", decimals));
            expect(await prankCoinV2.balanceOf(prankFundWallet)).to.equal(prankFundBalanceBefore + amountToSend);
            expect(await prankCoinV2.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(deadBalanceBefore);

            // Check the single Transfer event
            await expect(tx)
                .to.emit(prankCoinV2, "Transfer")
                .withArgs(addr1.address, prankFundWallet, amountToSend);
        });

        it("Should fail if sender doesn’t have enough tokens", async function () {
            const addr1Balance = await prankCoinV2.balanceOf(addr1.address); // Use actual balance
            const amountToSend = TOTAL_SUPPLY * 2n; // Try sending an impossible amount

            // Perform transfer from addr1 (non-excluded) to addr2 (non-excluded)
            await expect(prankCoinV2.connect(addr1).transfer(addr2.address, amountToSend))
                .to.be.revertedWith("ERC20: transfer amount exceeds balance"); // Matches our require string
        });

        it("Should handle zero value transfers correctly (no tax)", async function() {
            const addr1BalanceBefore = await prankCoinV2.balanceOf(addr1.address);
            const addr2BalanceBefore = await prankCoinV2.balanceOf(addr2.address);
            const prankFundBalanceBefore = await prankCoinV2.balanceOf(prankFundWallet);
            const deadBalanceBefore = await prankCoinV2.balanceOf("0x000000000000000000000000000000000000dEaD");

            const tx = await prankCoinV2.connect(addr1).transfer(addr2.address, 0);
            await tx.wait();

            expect(await prankCoinV2.balanceOf(addr1.address)).to.equal(addr1BalanceBefore);
            expect(await prankCoinV2.balanceOf(addr2.address)).to.equal(addr2BalanceBefore);
            expect(await prankCoinV2.balanceOf(prankFundWallet)).to.equal(prankFundBalanceBefore);
            expect(await prankCoinV2.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(deadBalanceBefore);

            // Should only emit one transfer event for zero value
            await expect(tx)
                .to.emit(prankCoinV2, "Transfer")
                .withArgs(addr1.address, addr2.address, 0);
        });

    });

    describe("Owner Functions", function () {
        it("Should allow owner to update tax rates", async function () {
            const newReflectionBps = 100; // 1.0%
            const newPrankFundBps = 150; // 1.5%
            const newBurnBps = 100;      // 1.0%
            const newTotalBps = newReflectionBps + newPrankFundBps + newBurnBps;

            await expect(prankCoinV2.connect(owner).setTaxRates(newReflectionBps, newPrankFundBps, newBurnBps))
                .to.emit(prankCoinV2, "TaxesUpdated")
                .withArgs(newReflectionBps, newPrankFundBps, newBurnBps);

            expect(await prankCoinV2.reflectionTaxRateBps()).to.equal(newReflectionBps);
            expect(await prankCoinV2.prankFundTaxRateBps()).to.equal(newPrankFundBps);
            expect(await prankCoinV2.burnTaxRateBps()).to.equal(newBurnBps);
            expect(await prankCoinV2.totalTaxRateBps()).to.equal(newTotalBps);
        });

        it("Should prevent non-owner from updating tax rates", async function () {
             await expect(prankCoinV2.connect(addr1).setTaxRates(10, 10, 10))
                .to.be.revertedWithCustomError(prankCoinV2, "OwnableUnauthorizedAccount")
                .withArgs(addr1.address);
        });

        it("Should prevent setting tax rates exceeding max limit", async function () {
            const maxRate = await prankCoinV2.MAX_TAX_RATE_BPS();
            await expect(prankCoinV2.connect(owner).setTaxRates(maxRate, 1, 0))
                .to.be.revertedWith("Total tax rate exceeds maximum allowed");
            await expect(prankCoinV2.connect(owner).setTaxRates(0, maxRate, 1))
                .to.be.revertedWith("Total tax rate exceeds maximum allowed");
            await expect(prankCoinV2.connect(owner).setTaxRates(0, 0, maxRate + 1n))
                .to.be.revertedWith("Total tax rate exceeds maximum allowed");
        });

        it("Should allow owner to update the Prank Fund wallet", async function () {
            const newWallet = addr2.address; // Use addr2 as the new prank fund wallet for test
            await expect(prankCoinV2.connect(owner).setPrankFundWallet(newWallet))
                .to.emit(prankCoinV2, "PrankFundWalletUpdated")
                .withArgs(newWallet);

            expect(await prankCoinV2.prankFundWallet()).to.equal(newWallet);
        });

        it("Should prevent non-owner from updating the Prank Fund wallet", async function () {
            await expect(prankCoinV2.connect(addr1).setPrankFundWallet(addr2.address))
                 .to.be.revertedWithCustomError(prankCoinV2, "OwnableUnauthorizedAccount")
                 .withArgs(addr1.address);
        });

        it("Should prevent setting Prank Fund wallet to the zero address", async function () {
            await expect(prankCoinV2.connect(owner).setPrankFundWallet(ethers.ZeroAddress))
                .to.be.revertedWith("New wallet cannot be zero address");
         });

        it("Should allow owner to exclude an address from tax", async function () {
            expect(await prankCoinV2.isExcludedFromTax(addr1.address)).to.be.false;
            await expect(prankCoinV2.connect(owner).excludeFromTax(addr1.address))
                .to.emit(prankCoinV2, "ExcludedFromTax")
                .withArgs(addr1.address, true);
            expect(await prankCoinV2.isExcludedFromTax(addr1.address)).to.be.true;
        });

         it("Should allow owner to include an address in tax", async function () {
            // Exclude first
            await prankCoinV2.connect(owner).excludeFromTax(addr1.address);
            expect(await prankCoinV2.isExcludedFromTax(addr1.address)).to.be.true;

            // Include
            await expect(prankCoinV2.connect(owner).includeInTax(addr1.address))
                .to.emit(prankCoinV2, "ExcludedFromTax")
                .withArgs(addr1.address, false);
            expect(await prankCoinV2.isExcludedFromTax(addr1.address)).to.be.false;
        });

        it("Should prevent non-owner from excluding an address from tax", async function () {
            await expect(prankCoinV2.connect(addr1).excludeFromTax(addr2.address))
                 .to.be.revertedWithCustomError(prankCoinV2, "OwnableUnauthorizedAccount")
                 .withArgs(addr1.address);
        });

         it("Should prevent non-owner from including an address in tax", async function () {
            await expect(prankCoinV2.connect(addr1).includeInTax(addr2.address))
                 .to.be.revertedWithCustomError(prankCoinV2, "OwnableUnauthorizedAccount")
                 .withArgs(addr1.address);
        });

        // Optional: Test Ownable's transferOwnership
        it("Should allow owner to transfer ownership", async function() {
            await expect(prankCoinV2.connect(owner).transferOwnership(addr1.address))
                .to.emit(prankCoinV2, "OwnershipTransferred")
                .withArgs(owner.address, addr1.address);
            expect(await prankCoinV2.owner()).to.equal(addr1.address);
        });

         it("Should prevent non-owner from transferring ownership", async function() {
            await expect(prankCoinV2.connect(addr1).transferOwnership(addr2.address))
                 .to.be.revertedWithCustomError(prankCoinV2, "OwnableUnauthorizedAccount")
                 .withArgs(addr1.address);
        });

    });

    describe("Reflections", function () {
        let initialHolderBalance;
        let transferAmount;

        beforeEach(async function () {
            // IMPORTANT: For reflection tests, we set Reflection Tax to be significantly higher
            // than taxes to excluded wallets (PrankFund, Burn).
            // This ensures balances *increase* rather than decrease due to circulating supply deflation.
            // Setup: Reflection 5%, Prank 0%, Burn 0%
            await prankCoinV2.connect(owner).setTaxRates(500, 0, 0);

            // Ensure addr1 and addr2 have some tokens to trade
            // Owner starts with total supply, transfer some to addr1 and addr2
            const initialTransfer = ethers.parseUnits("1000000", decimals);
            await prankCoinV2.connect(owner).transfer(addr1.address, initialTransfer);
            await prankCoinV2.connect(owner).transfer(addr2.address, initialTransfer);

            // addr3 will be our passive holder to observe reflections
            const holderAmount = ethers.parseUnits("500000", decimals);
            await prankCoinV2.connect(owner).transfer(addr3.address, holderAmount);
            initialHolderBalance = await prankCoinV2.balanceOf(addr3.address);

            transferAmount = ethers.parseUnits("1000", decimals); // Amount for taxed transfer
        });

        it("Should increase a holder's balance after a taxed transfer occurs", async function () {
            // Perform a taxed transfer between addr1 and addr2
            await prankCoinV2.connect(addr1).transfer(addr2.address, transferAmount);

            // Check addr3's balance (the passive holder)
            const finalHolderBalance = await prankCoinV2.balanceOf(addr3.address);

            // Expect final balance to be greater than initial due to reflections
            // Using `>` comparison because the exact reflection amount depends on complex rate changes
            expect(finalHolderBalance).to.be.gt(initialHolderBalance);
        });

        it("Should NOT increase the balance of addresses excluded from reflections (e.g., Prank Fund)", async function () {
         const { prankCoin, owner, addr1, addr2, prankFundWalletAddr } = await loadFixture(deployPrankCoinV2Fixture);
         const transferAmount = ethers.parseUnits("1000", decimals);

         // Set Tax configuration to be inflationary for verification (Reflection > Outflows)
         await prankCoin.connect(owner).setTaxRates(500, 0, 0);

         // Get initial balances of excluded accounts (owner, contract, prank fund, dead address)
         const initialOwnerBalance = await prankCoin.balanceOf(owner.address);
         const initialContractBalance = await prankCoin.balanceOf(await prankCoin.getAddress());
         const initialPrankFundBalance = await prankCoin.balanceOf(prankFundWalletAddr);
         const initialDeadBalance = await prankCoin.balanceOf(await prankCoin.DEAD_ADDRESS());

         // Transfer some tokens to addr1 to allow it to transact
         await prankCoin.connect(owner).transfer(addr1.address, transferAmount * 2n); // Send 2x amount - Use BigInt math

         // Trigger a taxed transfer
         await prankCoin.connect(addr1).transfer(addr2.address, transferAmount);

         // Get final balances
         const finalOwnerBalance = await prankCoin.balanceOf(owner.address);
         const finalContractBalance = await prankCoin.balanceOf(await prankCoin.getAddress());
         const finalPrankFundBalance = await prankCoin.balanceOf(prankFundWalletAddr);
         const finalDeadBalance = await prankCoin.balanceOf(await prankCoin.DEAD_ADDRESS());

         // Assertions: Balances of EXCLUDED accounts should NOT increase from reflections
         // Owner balance should decrease from the initial transfer to addr1.
         expect(finalOwnerBalance).to.be.lt(initialOwnerBalance);
         expect(finalContractBalance).to.equal(initialContractBalance); // Should remain 0 and not receive reflections

         // For PrankFund and DEAD, tax is set to 0, so they should remain same.
         expect(finalPrankFundBalance).to.equal(initialPrankFundBalance);
         expect(finalDeadBalance).to.equal(initialDeadBalance);
       });

       it("Should reflect taxes to multiple holders", async function() {
        // Setup: Reflection 5%, Prank 0%, Burn 0%
        await prankCoinV2.connect(owner).setTaxRates(500, 0, 0);

        // Get fresh signers (reflector1/2 used in fixture are not available here in beforeEach scope cleanly)
        // using addr3 (already has tokens) and addr4
        const reflector1 = addr3;
        const reflector2 = addr4;

        const reflector2Initial = ethers.parseUnits("1000000", decimals); // double addr3
        await prankCoinV2.connect(owner).transfer(reflector2.address, reflector2Initial);

        const bal1_start = await prankCoinV2.balanceOf(reflector1.address);
        const bal2_start = await prankCoinV2.balanceOf(reflector2.address);

        // Action: addr1 transfers to addr2 (triggering reflection)
        await prankCoinV2.connect(addr1).transfer(addr2.address, transferAmount);

        // Assertions: Both reflectors should gain balance
        const bal1_end = await prankCoinV2.balanceOf(reflector1.address);
        const bal2_end = await prankCoinV2.balanceOf(reflector2.address);

        expect(bal1_end).to.be.gt(bal1_start);
        expect(bal2_end).to.be.gt(bal2_start);

        // Assertions: Reflector2 should gain more than Reflector1 (proportional)
        const gain1 = bal1_end - bal1_start;
        const gain2 = bal2_end - bal2_start;
        // console.log(`Multi-Holder Test - Gain1: ${ethers.formatUnits(gain1, 18)} (${ethers.formatUnits(bal1_start, 18)})`);
        // console.log(`Multi-Holder Test - Gain2: ${ethers.formatUnits(gain2, 18)} (${ethers.formatUnits(bal2_start, 18)})`);
        expect(gain2).to.be.gt(gain1); // Reflector2 held more, should gain more
      });

      it("Should accumulate reflections over multiple transfers", async function() {
        // Setup: Reflection 5%, Prank 0%, Burn 0%
        await prankCoinV2.connect(owner).setTaxRates(500, 0, 0);

        const reflector1 = addr3;
        const bal_start = await prankCoinV2.balanceOf(reflector1.address);

        // Action 1
        await prankCoinV2.connect(addr1).transfer(addr2.address, transferAmount);
        const bal_after_1 = await prankCoinV2.balanceOf(reflector1.address);
        expect(bal_after_1).to.be.gt(bal_start);

        // Action 2
        await prankCoinV2.connect(addr2).transfer(addr1.address, transferAmount);
        const bal_after_2 = await prankCoinV2.balanceOf(reflector1.address);
        expect(bal_after_2).to.be.gt(bal_after_1);

         // Action 3
        await prankCoinV2.connect(addr1).transfer(reflector1.address, transferAmount); // Transfer *to* reflector (taxed)
        const bal_after_3 = await prankCoinV2.balanceOf(reflector1.address);
        expect(bal_after_3).to.be.gt(bal_after_2); // Should still gain from reflections + receive amount
      });

      it("Should handle exclusion/inclusion from reflections correctly", async function() {
          const { prankCoin, owner, addr1, addr2, addr3 } = await loadFixture(deployPrankCoinV2Fixture);
          const transferAmount = ethers.parseUnits("1000", decimals);
          const initialAmount = ethers.parseUnits("500000", decimals); // Larger initial amount for addr3

          // Set Tax configuration to be inflationary for verification
          await prankCoin.connect(owner).setTaxRates(500, 0, 0);

          // Setup
          await prankCoin.connect(owner).transfer(addr1.address, transferAmount * 10n); // Plenty of tokens
          await prankCoin.connect(owner).transfer(addr3.address, initialAmount);

          // 1. Initially included, should receive reflections
          const bal1 = await prankCoin.balanceOf(addr3.address);
          await prankCoin.connect(addr1).transfer(addr2.address, transferAmount);
          const bal2 = await prankCoin.balanceOf(addr3.address);
          expect(bal2).to.be.gt(bal1);

          // 2. Exclude addr3 from reflections
          // Add check: ensure it's not already excluded
          const isCurrentlyExcluded = await prankCoin.isExcludedFromReflections(addr3.address);
          expect(isCurrentlyExcluded).to.be.false;

          await expect(prankCoin.connect(owner).setExcludedFromReflections(addr3.address, true))
              .to.emit(prankCoin, "ExcludedFromReflections").withArgs(addr3.address, true);
          expect(await prankCoin.isExcludedFromReflections(addr3.address)).to.be.true;

          // Balance might change slightly upon exclusion due to rOwned/tOwned sync, but should be close
          const bal_excluded = await prankCoin.balanceOf(addr3.address);

          // 3. Transfer again, addr3 (excluded) should NOT receive reflections
          await prankCoin.connect(addr1).transfer(addr2.address, transferAmount);
          const bal_after_excluded = await prankCoin.balanceOf(addr3.address);

          expect(bal_after_excluded).to.be.closeTo(bal_excluded, ethers.parseUnits("0.000001", 18));

          // 4. Re-include addr3
          // Add check: ensure it's currently excluded before re-including
          const isCurrentlyExcludedReinclude = await prankCoin.isExcludedFromReflections(addr3.address);
          expect(isCurrentlyExcludedReinclude).to.be.true;

          await expect(prankCoin.connect(owner).setExcludedFromReflections(addr3.address, false))
              .to.emit(prankCoin, "ExcludedFromReflections").withArgs(addr3.address, false);
          expect(await prankCoin.isExcludedFromReflections(addr3.address)).to.be.false;
          const bal_reincluded = await prankCoin.balanceOf(addr3.address); // Balance might sync again

          // 5. Transfer again, addr3 (re-included) should receive reflections again
          await prankCoin.connect(addr1).transfer(addr2.address, transferAmount);
          const bal_final = await prankCoin.balanceOf(addr3.address);

          expect(bal_final).to.be.gt(bal_reincluded);
      });

    });
});

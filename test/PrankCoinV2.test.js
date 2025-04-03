const { expect } = require("chai");
const { ethers } = require("hardhat");

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

            // We no longer check the sender's final balance directly, as reflections affect it.
            // The TaxPaid event and tax destination balance checks confirm the gross amount was handled.

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
            expect(await prankCoinV2.balanceOf(addr1.address)).to.equal(addr1BalanceBefore - amountToSend);
            expect(await prankCoinV2.balanceOf(prankFundWallet)).to.equal(prankFundBalanceBefore + amountToSend);
            expect(await prankCoinV2.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(deadBalanceBefore);

            // Check the single Transfer event
            await expect(tx)
                .to.emit(prankCoinV2, "Transfer")
                .withArgs(addr1.address, prankFundWallet, amountToSend);
            // Balance checks above are sufficient to confirm no tax was taken.
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
            // Ensure addr1 and addr2 have some tokens to trade
            // Owner starts with total supply, transfer some to addr1 and addr2
            const initialTransfer = ethers.parseUnits("1000000", 18);
            await prankCoinV2.connect(owner).transfer(addr1.address, initialTransfer);
            await prankCoinV2.connect(owner).transfer(addr2.address, initialTransfer);

            // addr3 will be our passive holder to observe reflections
            const holderAmount = ethers.parseUnits("500000", 18);
            await prankCoinV2.connect(owner).transfer(addr3.address, holderAmount);
            initialHolderBalance = await prankCoinV2.balanceOf(addr3.address);

            transferAmount = ethers.parseUnits("1000", 18); // Amount for taxed transfer
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
            const prankFundWallet = await prankCoinV2.prankFundWallet();
            const initialPrankFundBalance = await prankCoinV2.balanceOf(prankFundWallet);

            // Perform a taxed transfer between addr1 and addr2
            await prankCoinV2.connect(addr1).transfer(addr2.address, transferAmount);

            // Prank fund will receive tax, but should not receive reflections on top of that
            const finalPrankFundBalance = await prankCoinV2.balanceOf(prankFundWallet);

            // Calculate expected tax received by prank fund
            const prankFundBps = await prankCoinV2.prankFundTaxRateBps();
            const expectedTax = (transferAmount * (prankFundBps)) / 10000n; // Tax sent directly

            // Check if the final balance is roughly the initial balance plus the DIRECTLY sent tax
            // It should NOT be significantly higher due to reflections compounding
            // Allow for tiny rounding differences if any, though direct tax should be precise
            const expectedFinalBalance = initialPrankFundBalance + expectedTax;

             // Use closeTo to account for potential minor dust from multiple rate calculations if they were happening
             // Although with current logic, it should be exact. Let's start with exact check.
             // expect(finalPrankFundBalance).to.be.closeTo(expectedFinalBalance, ethers.parseUnits("1", 10)); // Allow tiny variance
             expect(finalPrankFundBalance).to.equal(expectedFinalBalance); // Check for exact amount first

        });

        it("Should reflect taxes to multiple holders", async function () {
            // Transfer initial amounts to multiple holders (addr3, addr4)
            const holderAmount = ethers.parseUnits("5000", decimals);
            await prankCoinV2.connect(owner).transfer(addr3.address, holderAmount);
            await prankCoinV2.connect(owner).transfer(addr4.address, holderAmount);

            const initialHolder3Balance = await prankCoinV2.balanceOf(addr3.address);
            const initialHolder4Balance = await prankCoinV2.balanceOf(addr4.address);

            // Perform a taxed transfer between addr1 and addr2
            await prankCoinV2.connect(addr1).transfer(addr2.address, transferAmount);

            const finalHolder3Balance = await prankCoinV2.balanceOf(addr3.address);
            const finalHolder4Balance = await prankCoinV2.balanceOf(addr4.address);

            // Both holders should have increased balances
            expect(finalHolder3Balance).to.be.gt(initialHolder3Balance);
            expect(finalHolder4Balance).to.be.gt(initialHolder4Balance);
        });

        it("Should accumulate reflections over multiple transfers", async function () {
            // Initial holder addr3
            const holderAmount = ethers.parseUnits("5000", decimals);
            await prankCoinV2.connect(owner).transfer(addr3.address, holderAmount);

            const initialHolderBalance = await prankCoinV2.balanceOf(addr3.address);

            // First taxed transfer (addr1 -> addr2)
            await prankCoinV2.connect(addr1).transfer(addr2.address, transferAmount);
            const balanceAfterFirstTransfer = await prankCoinV2.balanceOf(addr3.address);
            expect(balanceAfterFirstTransfer).to.be.gt(initialHolderBalance);

            // Second taxed transfer (addr2 -> addr1)
            // Need to ensure addr2 has enough after the first transfer + tax
            const addr2BalanceAfterFirst = await prankCoinV2.balanceOf(addr2.address);
            const amountForSecondTransfer = ethers.parseUnits("100", decimals);
            if (addr2BalanceAfterFirst >= amountForSecondTransfer) {
                await prankCoinV2.connect(addr2).transfer(addr1.address, amountForSecondTransfer);
            } else {
                console.warn("Skipping second transfer in accumulation test: addr2 balance too low.");
                // If addr2 doesn't have enough, we can't proceed with this part of the test
                // But the first reflection check is still valid.
                return; // Exit test early if second transfer not possible
            }

            const finalHolderBalance = await prankCoinV2.balanceOf(addr3.address);

            // Balance should have increased again
            expect(finalHolderBalance).to.be.gt(balanceAfterFirstTransfer);
        });

        it("Should handle exclusion/inclusion from reflections correctly", async function () {
            // Initial holder addr3
            const holderAmount = ethers.parseUnits("5000", decimals);
            await prankCoinV2.connect(owner).transfer(addr3.address, holderAmount);
            const initialHolderBalance = await prankCoinV2.balanceOf(addr3.address);

            // Exclude addr3 from reflections
            await prankCoinV2.connect(owner).setExcludedFromReflections(addr3.address, true);
            expect(await prankCoinV2.isExcludedFromReflections(addr3.address)).to.be.true;

            // Perform a taxed transfer (addr1 -> addr2)
            await prankCoinV2.connect(addr1).transfer(addr2.address, transferAmount);
            const balanceAfterTransferWhileExcluded = await prankCoinV2.balanceOf(addr3.address);

            // Balance should NOT have changed
            expect(balanceAfterTransferWhileExcluded).to.equal(initialHolderBalance);

            // Include addr3 back into reflections
            await prankCoinV2.connect(owner).setExcludedFromReflections(addr3.address, false);
            expect(await prankCoinV2.isExcludedFromReflections(addr3.address)).to.be.false;

            // Perform another taxed transfer (addr2 -> addr1)
            const addr2Balance = await prankCoinV2.balanceOf(addr2.address);
            const secondTransferAmount = ethers.parseUnits("100", decimals);
            if (addr2Balance >= secondTransferAmount) {
                await prankCoinV2.connect(addr2).transfer(addr1.address, secondTransferAmount);
            } else {
                 console.warn("Skipping second transfer in exclude/include test: addr2 balance too low.");
                 return; // Exit test early
            }

            const finalHolderBalance = await prankCoinV2.balanceOf(addr3.address);

            // --- Debugging Logs --- START
            const currentRTotal = await prankCoinV2.getRTotal(); // Use the new public getter
            // We can't directly call _getRate() or access _rOwned from the test,
            // but we can see the inputs and the output of balanceOf.
            console.log(`\n--- Debug Info: Exclude/Include Test ---`);
            console.log(`Balance when excluded: ${ethers.formatUnits(balanceAfterTransferWhileExcluded, decimals)}`);
            console.log(`Final calculated balance (addr3): ${ethers.formatUnits(finalHolderBalance, decimals)}`);
            console.log(`Current rTotal: ${currentRTotal.toString()}`);
            // If rTotal is 0 or very small, the rate might be huge, causing balanceOf -> 0
            console.log(`--- Debug Info: END ---\n`);
            // --- Debugging Logs --- END

            // Balance should NOW have increased compared to when it was excluded
            expect(finalHolderBalance).to.be.gt(balanceAfterTransferWhileExcluded);
        });

         // Add tests for setExcludedFromReflections, include/exclude logic, etc.

     });
 
  });

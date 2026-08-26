const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MTTReferralDistributor", function () {
  let token, dist, admin, treasury, oracle, compliance, alice, bob, carol;
  const TOTAL = ethers.parseEther("1000000000");

  const EVT1 = ethers.keccak256(ethers.toUtf8Bytes("revenue-event-1"));
  const EVT2 = ethers.keccak256(ethers.toUtf8Bytes("revenue-event-2"));

  beforeEach(async function () {
    [admin, treasury, oracle, compliance, alice, bob, carol] = await ethers.getSigners();

    const MTT = await ethers.getContractFactory("MTTToken");
    token = await MTT.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address, admin.address
    );

    const Dist = await ethers.getContractFactory("MTTReferralDistributor");
    dist = await Dist.deploy(await token.getAddress(), admin.address);

    // Split roles the way production should: separate treasury / oracle / compliance keys
    await dist.connect(admin).grantRole(await dist.TREASURY_ROLE(), treasury.address);
    await dist.connect(admin).grantRole(await dist.ORACLE_ROLE(), oracle.address);
    await dist.connect(admin).grantRole(await dist.COMPLIANCE_ROLE(), compliance.address);

    // Fund the treasury signer with MTT representing reconciled real revenue
    await token.connect(admin).transfer(treasury.address, ethers.parseEther("1000000"));
  });

  async function fund(amount) {
    await token.connect(treasury).approve(await dist.getAddress(), amount);
    await dist.connect(treasury).depositCommissionPool(amount);
  }

  describe("Funding", function () {
    it("only TREASURY_ROLE can fund the commission pool", async function () {
      await token.connect(alice).approve(await dist.getAddress(), 100);
      await expect(dist.connect(alice).depositCommissionPool(100)).to.be.reverted;
    });

    it("tracks cumulative deposits and moves the tokens in", async function () {
      await fund(ethers.parseEther("1000"));
      expect(await dist.totalDeposited()).to.equal(ethers.parseEther("1000"));
      expect(await token.balanceOf(await dist.getAddress())).to.equal(ethers.parseEther("1000"));
    });

    it("rejects zero-amount deposits", async function () {
      await expect(dist.connect(treasury).depositCommissionPool(0)).to.be.revertedWith("amount=0");
    });
  });

  describe("CORE ANTI-PYRAMID INVARIANT", function () {
    it("CANNOT record any commission when the pool has never been funded", async function () {
      await expect(
        dist.connect(oracle).recordCommission(alice.address, 1, ethers.parseEther("1"), EVT1)
      ).to.be.revertedWith("insufficient funded pool balance");
    });

    it("CANNOT record commission exceeding total real-revenue deposits", async function () {
      await fund(ethers.parseEther("100"));
      await expect(
        dist.connect(oracle).recordCommission(alice.address, 1, ethers.parseEther("100.000001"), EVT1)
      ).to.be.revertedWith("insufficient funded pool balance");
    });

    it("enforces the invariant cumulatively across many commissions", async function () {
      await fund(ethers.parseEther("100"));
      await dist.connect(oracle).recordCommission(alice.address, 1, ethers.parseEther("60"), EVT1);
      await dist.connect(oracle).recordCommission(bob.address, 2, ethers.parseEther("30"), EVT1);
      // 90 recorded of 100 funded; a 20 commission must fail even though each prior one succeeded
      await expect(
        dist.connect(oracle).recordCommission(carol.address, 3, ethers.parseEther("20"), EVT1)
      ).to.be.revertedWith("insufficient funded pool balance");
      // but 10 fits exactly
      await dist.connect(oracle).recordCommission(carol.address, 3, ethers.parseEther("10"), EVT1);
      expect(await dist.totalRecorded()).to.equal(await dist.totalDeposited());
    });

    it("totalRecorded can NEVER exceed totalDeposited (property check over random ops)", async function () {
      await fund(ethers.parseEther("500"));
      const amounts = [80, 120, 45, 200, 90, 150, 30];
      for (const a of amounts) {
        const amt = ethers.parseEther(String(a));
        const evt = ethers.keccak256(ethers.toUtf8Bytes("evt-" + a));
        try {
          await dist.connect(oracle).recordCommission(alice.address, 1, amt, evt);
        } catch (e) {
          // expected once the pool is exhausted
        }
        expect(await dist.totalRecorded()).to.be.lte(await dist.totalDeposited());
      }
    });

    it("more Treasury funding unblocks previously-rejected commissions (queue-and-retry flow)", async function () {
      await fund(ethers.parseEther("50"));
      await expect(
        dist.connect(oracle).recordCommission(alice.address, 1, ethers.parseEther("80"), EVT1)
      ).to.be.reverted;
      await fund(ethers.parseEther("50")); // next weekly revenue deposit
      await dist.connect(oracle).recordCommission(alice.address, 1, ethers.parseEther("80"), EVT1);
      expect(await dist.commissionBalance(alice.address)).to.equal(ethers.parseEther("80"));
    });
  });

  describe("Recording access control & dedupe", function () {
    beforeEach(async function () { await fund(ethers.parseEther("1000")); });

    it("only ORACLE_ROLE can record commissions", async function () {
      await expect(
        dist.connect(alice).recordCommission(alice.address, 1, 100, EVT1)
      ).to.be.reverted;
    });

    it("the Oracle role CANNOT move funds (it can only record within the funded cap)", async function () {
      // oracle has no TREASURY_ROLE, so it cannot deposit, and there is no withdraw function at all
      await expect(dist.connect(oracle).depositCommissionPool(1)).to.be.reverted;
      expect(dist.interface.fragments.find(f => f.name === "withdraw")).to.equal(undefined);
      expect(dist.interface.fragments.find(f => f.name === "emergencyWithdraw")).to.equal(undefined);
    });

    it("prevents double-paying the same (recipient, level, event)", async function () {
      await dist.connect(oracle).recordCommission(alice.address, 1, 100, EVT1);
      await expect(
        dist.connect(oracle).recordCommission(alice.address, 1, 100, EVT1)
      ).to.be.revertedWith("already recorded");
    });

    it("allows same recipient at different levels or different events", async function () {
      await dist.connect(oracle).recordCommission(alice.address, 1, 100, EVT1);
      await dist.connect(oracle).recordCommission(alice.address, 2, 100, EVT1); // different level
      await dist.connect(oracle).recordCommission(alice.address, 1, 100, EVT2); // different event
      expect(await dist.commissionBalance(alice.address)).to.equal(300n);
    });

    it("emits CommissionRecorded with the source revenue event for auditability", async function () {
      await expect(dist.connect(oracle).recordCommission(alice.address, 1, 100, EVT1))
        .to.emit(dist, "CommissionRecorded");
    });
  });

  describe("KYC-gated claiming", function () {
    beforeEach(async function () {
      await fund(ethers.parseEther("1000"));
      await dist.connect(oracle).recordCommission(alice.address, 1, ethers.parseEther("100"), EVT1);
    });

    it("blocks claiming without KYC approval", async function () {
      await expect(dist.connect(alice).claimCommission()).to.be.revertedWith("KYC not approved");
    });

    it("only COMPLIANCE_ROLE can set KYC status", async function () {
      await expect(dist.connect(alice).setKycApproved(alice.address, true)).to.be.reverted;
    });

    it("allows claiming after KYC approval and transfers the tokens", async function () {
      await dist.connect(compliance).setKycApproved(alice.address, true);
      await dist.connect(alice).claimCommission();
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
      expect(await dist.commissionBalance(alice.address)).to.equal(0n);
      expect(await dist.totalClaimed()).to.equal(ethers.parseEther("100"));
    });

    it("cannot double-claim", async function () {
      await dist.connect(compliance).setKycApproved(alice.address, true);
      await dist.connect(alice).claimCommission();
      await expect(dist.connect(alice).claimCommission()).to.be.revertedWith("nothing to claim");
    });

    it("revoking KYC blocks further claims", async function () {
      await dist.connect(compliance).setKycApproved(alice.address, true);
      await dist.connect(compliance).setKycApproved(alice.address, false);
      await expect(dist.connect(alice).claimCommission()).to.be.revertedWith("KYC not approved");
    });
  });

  describe("Clawback (refund / fraud reversal)", function () {
    beforeEach(async function () {
      await fund(ethers.parseEther("1000"));
      await dist.connect(oracle).recordCommission(alice.address, 1, ethers.parseEther("100"), EVT1);
    });

    it("only COMPLIANCE_ROLE can claw back", async function () {
      await expect(
        dist.connect(alice).clawback(alice.address, 1, EVT1, "unauthorised")
      ).to.be.reverted;
    });

    it("reverses an unclaimed commission and frees pool capacity", async function () {
      const recordedBefore = await dist.totalRecorded();
      await dist.connect(compliance).clawback(alice.address, ethers.parseEther("100"), EVT1, "purchase refunded");
      expect(await dist.commissionBalance(alice.address)).to.equal(0n);
      expect(await dist.totalRecorded()).to.equal(recordedBefore - ethers.parseEther("100"));
      expect(await dist.availablePoolBalance()).to.equal(ethers.parseEther("1000"));
    });

    it("cannot claw back more than the user's outstanding balance", async function () {
      await expect(
        dist.connect(compliance).clawback(alice.address, ethers.parseEther("101"), EVT1, "purchase refunded")
      ).to.be.revertedWith("exceeds balance");
    });

    it("cannot claw back funds already claimed by the user", async function () {
      await dist.connect(compliance).setKycApproved(alice.address, true);
      await dist.connect(alice).claimCommission();
      await expect(
        dist.connect(compliance).clawback(alice.address, ethers.parseEther("100"), EVT1, "purchase refunded")
      ).to.be.revertedWith("exceeds balance");
    });
  });

  describe("Solvency", function () {
    it("contract always holds enough tokens to cover every outstanding commission", async function () {
      await fund(ethers.parseEther("300"));
      await dist.connect(oracle).recordCommission(alice.address, 1, ethers.parseEther("120"), EVT1);
      await dist.connect(oracle).recordCommission(bob.address, 2, ethers.parseEther("100"), EVT1);
      await dist.connect(compliance).setKycApproved(alice.address, true);
      await dist.connect(alice).claimCommission();

      const outstanding = await dist.commissionBalance(bob.address);
      const held = await token.balanceOf(await dist.getAddress());
      expect(held).to.be.gte(outstanding);
    });
  });
});

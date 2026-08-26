const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * MTTPayout — the withdrawal settlement rail.
 *
 * The properties worth proving here are the ones that make this contract worth
 * having at all: the hot payer key cannot exceed its ceiling, cannot pay the same
 * withdrawal twice, cannot move the float anywhere of its own choosing, and can
 * be stopped without losing custody.
 */
describe("MTTPayout", function () {
  let token, payout;
  let admin, treasury, payer, guardian, alice, bob, outsider;

  const DAILY = ethers.parseEther("50000");
  const REF1 = ethers.keccak256(ethers.toUtf8Bytes("withdrawal-1"));
  const REF2 = ethers.keccak256(ethers.toUtf8Bytes("withdrawal-2"));
  const REF3 = ethers.keccak256(ethers.toUtf8Bytes("withdrawal-3"));

  beforeEach(async function () {
    [admin, treasury, payer, guardian, alice, bob, outsider] = await ethers.getSigners();

    const MTT = await ethers.getContractFactory("MTTToken");
    token = await MTT.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address, admin.address,
    );

    const Payout = await ethers.getContractFactory("MTTPayout");
    payout = await Payout.deploy(await token.getAddress(), admin.address, payer.address, DAILY);

    /* Production role split: treasury funds, payer pays, guardian pauses. */
    await payout.connect(admin).grantRole(await payout.TREASURY_ROLE(), treasury.address);
    await payout.connect(admin).grantRole(await payout.GUARDIAN_ROLE(), guardian.address);

    await token.connect(admin).transfer(treasury.address, ethers.parseEther("1000000"));
  });

  async function fund(amount) {
    await token.connect(treasury).approve(await payout.getAddress(), amount);
    await payout.connect(treasury).fund(amount);
  }

  describe("Construction", function () {
    it("gives the payer PAYER_ROLE and nothing else", async function () {
      expect(await payout.hasRole(await payout.PAYER_ROLE(), payer.address)).to.equal(true);
      expect(await payout.hasRole(await payout.TREASURY_ROLE(), payer.address)).to.equal(false);
      expect(await payout.hasRole(await payout.GUARDIAN_ROLE(), payer.address)).to.equal(false);
      expect(await payout.hasRole(await payout.DEFAULT_ADMIN_ROLE(), payer.address)).to.equal(false);
    });

    it("rejects zero addresses and a zero ceiling", async function () {
      const Payout = await ethers.getContractFactory("MTTPayout");
      const t = await token.getAddress();
      await expect(Payout.deploy(ethers.ZeroAddress, admin.address, payer.address, DAILY)).to.be.revertedWith("token=0");
      await expect(Payout.deploy(t, ethers.ZeroAddress, payer.address, DAILY)).to.be.revertedWith("admin=0");
      await expect(Payout.deploy(t, admin.address, ethers.ZeroAddress, DAILY)).to.be.revertedWith("payer=0");
      await expect(Payout.deploy(t, admin.address, payer.address, 0)).to.be.revertedWith("dailyLimit=0");
    });
  });

  describe("Funding", function () {
    it("only TREASURY_ROLE can fund", async function () {
      await token.connect(admin).transfer(outsider.address, ethers.parseEther("10"));
      await token.connect(outsider).approve(await payout.getAddress(), ethers.parseEther("10"));
      await expect(payout.connect(outsider).fund(ethers.parseEther("10"))).to.be.reverted;
    });

    it("credits totalFunded with exactly what arrived", async function () {
      await fund(ethers.parseEther("1000"));
      expect(await payout.totalFunded()).to.equal(ethers.parseEther("1000"));
      expect(await payout.float()).to.equal(ethers.parseEther("1000"));
    });

    it("a raw transfer in does NOT move totalFunded — the counter tracks deliberate funding", async function () {
      await token.connect(treasury).transfer(await payout.getAddress(), ethers.parseEther("500"));
      expect(await payout.float()).to.equal(ethers.parseEther("500"));
      expect(await payout.totalFunded()).to.equal(0n);
    });

    it("sweeps only back to the calling treasury, and demands a reason", async function () {
      await fund(ethers.parseEther("1000"));
      await expect(payout.connect(treasury).sweep(ethers.parseEther("100"), "")).to.be.revertedWith("reason required");

      const before = await token.balanceOf(treasury.address);
      await payout.connect(treasury).sweep(ethers.parseEther("400"), "float wind-down");
      expect(await token.balanceOf(treasury.address)).to.equal(before + ethers.parseEther("400"));
      expect(await payout.float()).to.equal(ethers.parseEther("600"));
    });

    it("the payer cannot sweep", async function () {
      await fund(ethers.parseEther("1000"));
      await expect(payout.connect(payer).sweep(ethers.parseEther("1"), "nope")).to.be.reverted;
    });
  });

  describe("Payouts", function () {
    beforeEach(async function () {
      await fund(ethers.parseEther("100000"));
    });

    it("only PAYER_ROLE can pay", async function () {
      await expect(
        payout.connect(outsider).payout(alice.address, ethers.parseEther("10"), REF1),
      ).to.be.reverted;
      await expect(
        payout.connect(treasury).payout(alice.address, ethers.parseEther("10"), REF1),
      ).to.be.reverted;
    });

    it("sends the member their tokens and records the reference", async function () {
      await expect(payout.connect(payer).payout(alice.address, ethers.parseEther("250"), REF1))
        .to.emit(payout, "PayoutSent")
        .withArgs(alice.address, ethers.parseEther("250"), REF1, ethers.parseEther("250"));

      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("250"));
      expect(await payout.totalPaid()).to.equal(ethers.parseEther("250"));
      expect(await payout.payoutCount()).to.equal(1n);

      const [settled, amount] = await payout.settlement(REF1);
      expect(settled).to.equal(true);
      expect(amount).to.equal(ethers.parseEther("250"));
    });

    it("REFUSES a replayed withdrawal reference — the point of storing it", async function () {
      await payout.connect(payer).payout(alice.address, ethers.parseEther("250"), REF1);
      await expect(
        payout.connect(payer).payout(alice.address, ethers.parseEther("250"), REF1),
      ).to.be.revertedWith("already paid");
      /* And not by paying a different amount to a different address either. */
      await expect(
        payout.connect(payer).payout(bob.address, ethers.parseEther("1"), REF1),
      ).to.be.revertedWith("already paid");
      expect(await payout.payoutCount()).to.equal(1n);
    });

    it("rejects a zero recipient, amount or reference", async function () {
      await expect(payout.connect(payer).payout(ethers.ZeroAddress, 1, REF1)).to.be.revertedWith("to=0");
      await expect(payout.connect(payer).payout(alice.address, 0, REF1)).to.be.revertedWith("amount=0");
      await expect(
        payout.connect(payer).payout(alice.address, 1, ethers.ZeroHash),
      ).to.be.revertedWith("ref=0");
    });

    it("pays a batch atomically", async function () {
      await payout.connect(payer).payoutBatch(
        [alice.address, bob.address],
        [ethers.parseEther("100"), ethers.parseEther("200")],
        [REF1, REF2],
      );
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
      expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("200"));
      expect(await payout.payoutCount()).to.equal(2n);
    });

    it("a batch containing one already-paid reference reverts WHOLE", async function () {
      await payout.connect(payer).payout(alice.address, ethers.parseEther("100"), REF1);
      const bobBefore = await token.balanceOf(bob.address);

      await expect(
        payout.connect(payer).payoutBatch(
          [bob.address, alice.address],
          [ethers.parseEther("50"), ethers.parseEther("100")],
          [REF2, REF1],
        ),
      ).to.be.revertedWith("already paid");

      /* Bob was first in the batch and must NOT have been paid. */
      expect(await token.balanceOf(bob.address)).to.equal(bobBefore);
      expect(await payout.paid(REF2)).to.equal(false);
    });

    it("rejects mismatched batch array lengths", async function () {
      await expect(
        payout.connect(payer).payoutBatch([alice.address], [1, 2], [REF1]),
      ).to.be.revertedWith("length mismatch");
    });

    it("rejects an empty or oversized batch", async function () {
      await expect(payout.connect(payer).payoutBatch([], [], [])).to.be.revertedWith("bad batch size");
      const many = Array.from({ length: 51 }, (_, i) => alice.address);
      const amts = Array.from({ length: 51 }, () => 1n);
      const refs = Array.from({ length: 51 }, (_, i) =>
        ethers.keccak256(ethers.toUtf8Bytes(`r${i}`)));
      await expect(payout.connect(payer).payoutBatch(many, amts, refs)).to.be.revertedWith("bad batch size");
    });
  });

  describe("Daily ceiling", function () {
    beforeEach(async function () {
      await fund(ethers.parseEther("1000000"));
    });

    it("bounds what a compromised payer key can move", async function () {
      await payout.connect(payer).payout(alice.address, DAILY, REF1);
      expect(await payout.remainingAllowance()).to.equal(0n);
      await expect(
        payout.connect(payer).payout(bob.address, ethers.parseEther("1"), REF2),
      ).to.be.revertedWith("daily limit exceeded");
    });

    it("tracks the allowance down as it is spent", async function () {
      expect(await payout.remainingAllowance()).to.equal(DAILY);
      await payout.connect(payer).payout(alice.address, ethers.parseEther("20000"), REF1);
      expect(await payout.remainingAllowance()).to.equal(DAILY - ethers.parseEther("20000"));
    });

    it("resets after the window elapses", async function () {
      await payout.connect(payer).payout(alice.address, DAILY, REF1);
      await time.increase(24 * 60 * 60 + 1);
      expect(await payout.remainingAllowance()).to.equal(DAILY);
      await payout.connect(payer).payout(bob.address, ethers.parseEther("100"), REF2);
      expect(await payout.spentInWindow()).to.equal(ethers.parseEther("100"));
    });

    it("a batch that would breach the ceiling reverts whole", async function () {
      const half = DAILY / 2n;
      await expect(
        payout.connect(payer).payoutBatch(
          [alice.address, bob.address, outsider.address],
          [half, half, ethers.parseEther("1")],
          [REF1, REF2, REF3],
        ),
      ).to.be.revertedWith("daily limit exceeded");
      expect(await token.balanceOf(alice.address)).to.equal(0n);
      expect(await payout.payoutCount()).to.equal(0n);
    });

    it("only GUARDIAN_ROLE can raise the ceiling, and raising it does not reset the spend", async function () {
      await payout.connect(payer).payout(alice.address, DAILY, REF1);
      await expect(payout.connect(payer).setDailyLimit(DAILY * 2n)).to.be.reverted;

      await payout.connect(guardian).setDailyLimit(DAILY * 2n);
      /* Spend is preserved: the allowance is the NEW ceiling minus what was
       * already spent, not a fresh ceiling. */
      expect(await payout.spentInWindow()).to.equal(DAILY);
      expect(await payout.remainingAllowance()).to.equal(DAILY);
    });

    it("canPay reflects the ceiling and the float together", async function () {
      expect(await payout.canPay(ethers.parseEther("100"))).to.equal(true);
      expect(await payout.canPay(DAILY + 1n)).to.equal(false);
      await payout.connect(treasury).sweep(await payout.float(), "drain");
      expect(await payout.canPay(ethers.parseEther("1"))).to.equal(false);
    });
  });

  describe("Pause", function () {
    beforeEach(async function () {
      await fund(ethers.parseEther("100000"));
    });

    it("halts payouts but not funding, sweeping or views", async function () {
      await payout.connect(guardian).pause();

      await expect(
        payout.connect(payer).payout(alice.address, ethers.parseEther("1"), REF1),
      ).to.be.revertedWithCustomError(payout, "EnforcedPause");
      expect(await payout.canPay(ethers.parseEther("1"))).to.equal(false);

      /* Custody operations keep working — an incident response needs them. */
      await fund(ethers.parseEther("10"));
      await payout.connect(treasury).sweep(ethers.parseEther("10"), "incident");
      expect(await payout.float()).to.be.gt(0n);

      await payout.connect(guardian).unpause();
      await payout.connect(payer).payout(alice.address, ethers.parseEther("1"), REF1);
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("1"));
    });

    it("only GUARDIAN_ROLE can pause", async function () {
      await expect(payout.connect(payer).pause()).to.be.reverted;
      await expect(payout.connect(treasury).pause()).to.be.reverted;
    });
  });

  describe("Reconciliation views", function () {
    it("batched settlement check answers a whole queue in one call", async function () {
      await fund(ethers.parseEther("100000"));
      await payout.connect(payer).payout(alice.address, ethers.parseEther("5"), REF1);
      const flags = await payout.settled([REF1, REF2, REF3]);
      expect(flags).to.deep.equal([true, false, false]);
    });

    it("an unpaid reference reports zero rather than reverting", async function () {
      const [settled, amount] = await payout.settlement(REF2);
      expect(settled).to.equal(false);
      expect(amount).to.equal(0n);
    });
  });
});

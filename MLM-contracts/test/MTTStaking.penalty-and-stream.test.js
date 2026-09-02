/**
 * Regression suite for the staking audit.
 *
 * Every test here corresponds to a defect the original suite could not have
 * caught, because the paths were either untested or tested under conditions
 * that made the branch unreachable — the one partial-unstake test, for example,
 * advanced past the lock AND left the pool unfunded, so the penalty branch was
 * doubly dead.
 *
 * These assert amounts, not merely that calls succeed.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 24 * 60 * 60;
const E = (n) => ethers.parseEther(String(n));

describe("MTTStaking — penalty base and reward stream", function () {
  let token, staking, admin, treasury, penaltyRcv, alice, bob;

  beforeEach(async function () {
    [admin, treasury, penaltyRcv, alice, bob] = await ethers.getSigners();

    const MTT = await ethers.getContractFactory("MTTToken");
    token = await MTT.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address, admin.address
    );

    const Staking = await ethers.getContractFactory("MTTStaking");
    staking = await Staking.deploy(await token.getAddress(), admin.address, penaltyRcv.address);
    await staking.connect(admin).grantRole(await staking.TREASURY_ROLE(), treasury.address);

    await token.connect(admin).transfer(treasury.address, E(1_000_000));
    await token.connect(admin).transfer(alice.address, E(10_000));
    await token.connect(admin).transfer(bob.address, E(10_000));

    // 30-day lock, 30-day stream, 30% early-exit penalty.
    await staking.connect(admin).createPool(30 * DAY, 30 * DAY, 3000);
  });

  const fund = async (poolId, amount) => {
    await token.connect(treasury).approve(await staking.getAddress(), amount);
    await staking.connect(treasury).fundRewardPool(poolId, amount);
  };

  const stakeAs = async (signer, poolId, amount) => {
    await token.connect(signer).approve(await staking.getAddress(), amount);
    await staking.connect(signer).stake(poolId, amount);
  };

  /* ------------------------------------------------------------------ *
   * The penalty dodge
   * ------------------------------------------------------------------ */

  describe("early-exit penalty cannot be sidestepped by claiming first", function () {
    it("charges the penalty on a claim made while the position is locked", async function () {
      await stakeAs(alice, 0, E(1000));
      await fund(0, E(300));
      await time.increase(10 * DAY);

      const accrued = await staking.earned(0, alice.address);
      const before = await token.balanceOf(alice.address);

      await staking.connect(alice).claimRewards(0);

      const received = (await token.balanceOf(alice.address)) - before;
      const forfeited = await token.balanceOf(penaltyRcv.address);

      // 30% of everything accrued goes to the penalty receiver, not the member.
      expect(forfeited).to.be.gt(0);
      expect(received + forfeited).to.be.closeTo(accrued, E(0.01));
      expect(forfeited).to.be.closeTo((accrued * 3000n) / 10000n, E(0.01));
    });

    it("leaves a claim-then-unstake no better off than a straight unstake", async function () {
      await stakeAs(alice, 0, E(1000));
      await stakeAs(bob, 0, E(1000));
      await fund(0, E(300));
      await time.increase(10 * DAY);

      // Alice dodges: claim, then exit.
      const aliceBefore = await token.balanceOf(alice.address);
      await staking.connect(alice).claimRewards(0);
      await staking.connect(alice).unstake(0, E(1000));
      const aliceGain = (await token.balanceOf(alice.address)) - aliceBefore;

      // Bob exits directly. A full exit now settles every attributable reward,
      // so there is nothing left for him to claim afterwards.
      const bobBefore = await token.balanceOf(bob.address);
      await staking.connect(bob).unstake(0, E(1000));
      const bobGain = (await token.balanceOf(bob.address)) - bobBefore;
      await expect(staking.connect(bob).claimRewards(0)).to.be.revertedWith("nothing to claim");

      // Ordering must not be worth anything. The only gap allowed is the extra
      // block of accrual Bob picks up while Alice is making her two calls.
      expect(aliceGain).to.be.closeTo(bobGain, E(0.3));
    });

    it("does not penalise a claim once the lock has expired", async function () {
      await stakeAs(alice, 0, E(1000));
      await fund(0, E(300));
      await time.increase(31 * DAY);

      const accrued = await staking.earned(0, alice.address);
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).claimRewards(0);

      expect((await token.balanceOf(alice.address)) - before).to.be.closeTo(accrued, E(0.01));
      expect(await token.balanceOf(penaltyRcv.address)).to.equal(0);
    });
  });

  /* ------------------------------------------------------------------ *
   * The penalty base
   * ------------------------------------------------------------------ */

  describe("penalty is pro-rated against the principal withdrawn", function () {
    it("charges a tenth of the penalty for a tenth of the position", async function () {
      await stakeAs(alice, 0, E(1000));
      await fund(0, E(300));
      await time.increase(10 * DAY);

      const accrued = await staking.earned(0, alice.address);
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).unstake(0, E(100)); // 10% of principal

      const attributable = (accrued * 100n) / 1000n;          // the slice that settles
      const forfeited = await token.balanceOf(penaltyRcv.address);

      // 30% of the withdrawn slice is forfeited — not 30% of everything accrued.
      expect(forfeited).to.be.closeTo((attributable * 3000n) / 10000n, E(0.05));

      // Principal back in full, plus the rest of the withdrawn slice.
      expect((await token.balanceOf(alice.address)) - before)
        .to.be.closeTo(E(100) + attributable - forfeited, E(0.05));

      // The remaining 90% of principal keeps the remaining 90% of rewards.
      expect(await staking.earned(0, alice.address)).to.be.closeTo(accrued - attributable, E(0.05));
    });

    it("costs almost nothing to withdraw a dust amount", async function () {
      await stakeAs(alice, 0, E(1000));
      await fund(0, E(300));
      await time.increase(10 * DAY);

      await staking.connect(alice).unstake(0, 1n); // 1 wei of a 1000 MTT position
      // Previously this forfeited 30% of every reward earned.
      expect(await token.balanceOf(penaltyRcv.address)).to.be.lt(E(0.000001));
    });

    it("does not let repeated partial exits compound the penalty", async function () {
      await stakeAs(alice, 0, E(1000));
      await stakeAs(bob, 0, E(1000));
      await fund(0, E(300));
      await time.increase(10 * DAY);

      // Alice leaves in five tranches, Bob in one.
      for (let i = 0; i < 5; i += 1) await staking.connect(alice).unstake(0, E(200));
      const staged = await token.balanceOf(penaltyRcv.address);

      await staking.connect(bob).unstake(0, E(1000));
      const single = (await token.balanceOf(penaltyRcv.address)) - staged;

      /* Splitting the exit must not change the bill. The full-balance rule made
       * five tranches cost 83% against 30%; pro-rating without settling the
       * slice still cost 53%. Both sides keep accruing between Alice's calls, so
       * a couple of MTT of drift is expected — the old gap was ~12 MTT. */
      expect(staged).to.be.closeTo(single, E(2));
    });

    it("charges nothing once the lock has expired, however partial", async function () {
      await stakeAs(alice, 0, E(1000));
      await fund(0, E(300));
      await time.increase(31 * DAY);

      await staking.connect(alice).unstake(0, E(400));
      expect(await token.balanceOf(penaltyRcv.address)).to.equal(0);
    });
  });

  /* ------------------------------------------------------------------ *
   * The stream
   * ------------------------------------------------------------------ */

  describe("reward stream survives windows with no stakers", function () {
    it("does not burn the slice that streams before anyone stakes", async function () {
      await fund(0, E(300));
      await time.increase(10 * DAY); // a third of the stream, nobody staked

      await stakeAs(alice, 0, E(1000));
      await time.increase(31 * DAY); // run past the (now extended) finish

      // The whole 300 must still be reachable, not 200.
      expect(await staking.earned(0, alice.address)).to.be.closeTo(E(300), E(0.5));
    });

    it("does not burn the slice between a full exit and the next staker", async function () {
      const aliceStart = await token.balanceOf(alice.address);
      await stakeAs(alice, 0, E(1000));
      await fund(0, E(300));
      await time.increase(15 * DAY);
      await staking.connect(alice).unstake(0, E(1000)); // pool empty mid-stream

      await time.increase(10 * DAY); // idle — nothing staked, stream paused
      await stakeAs(bob, 0, E(1000));
      await time.increase(40 * DAY); // long enough to clear the extended finish

      /* Conservation: every funded token is now either in a wallet, with the
       * penalty receiver, or still owed to Bob. The idle ten days used to
       * vanish — 100 of the 300 stranded in the contract with no way out. */
      const aliceNet = (await token.balanceOf(alice.address)) - aliceStart;
      const forfeited = await token.balanceOf(penaltyRcv.address);
      const bobOwed = await staking.earned(0, bob.address);

      expect(aliceNet + forfeited + bobOwed).to.be.closeTo(E(300), E(1));
    });

    it("stops accruing at the period finish", async function () {
      await stakeAs(alice, 0, E(1000));
      await fund(0, E(300));

      await time.increase(30 * DAY);
      const atFinish = await staking.earned(0, alice.address);
      await time.increase(70 * DAY);
      const muchLater = await staking.earned(0, alice.address);

      // The original suite only asserted `earned <= 300`, which 0 satisfies.
      expect(atFinish).to.be.closeTo(E(300), E(0.5));
      expect(muchLater).to.equal(atFinish);
    });

    it("folds an unstreamed remainder into a mid-period top-up", async function () {
      await stakeAs(alice, 0, E(1000));
      await fund(0, E(300));
      await time.increase(15 * DAY); // half streamed, 150 left to run
      await fund(0, E(300));         // leftover + new deposit, re-spread over 30 days
      await time.increase(31 * DAY);

      // 600 funded in total; all of it must be reachable.
      expect(await staking.earned(0, alice.address)).to.be.closeTo(E(600), E(1));
    });
  });

  /* ------------------------------------------------------------------ *
   * Locks
   * ------------------------------------------------------------------ */

  describe("lock handling", function () {
    it("does not re-lock the whole position when topping up", async function () {
      await stakeAs(alice, 0, E(10_000));
      const first = (await staking.getPosition(0, alice.address)).lockEnd;

      await time.increase(29 * DAY);
      await token.connect(admin).transfer(alice.address, E(1));
      await stakeAs(alice, 0, E(1));

      const after = (await staking.getPosition(0, alice.address)).lockEnd;
      // A 1 MTT top-up against 10,000 must barely move the end date; the old
      // behaviour pushed it a full 30 days out.
      expect(after - first).to.be.lt(BigInt(DAY));
    });

    it("clears the lock once a position is fully exited", async function () {
      await stakeAs(alice, 0, E(1000));
      await time.increase(31 * DAY);
      await staking.connect(alice).unstake(0, E(1000));

      const pos = await staking.getPosition(0, alice.address);
      expect(pos.amount).to.equal(0);
      expect(pos.lockEnd).to.equal(0);
      expect(pos.locked).to.equal(false);
    });

    it("refuses a lock beyond the four-year ceiling", async function () {
      const tooLong = BigInt(MAX_LOCK() + DAY);
      await expect(staking.connect(admin).createPool(tooLong, 30 * DAY, 0))
        .to.be.revertedWith("lock too long");
    });

    function MAX_LOCK() {
      return 4 * 365 * DAY;
    }
  });

  /* ------------------------------------------------------------------ *
   * Pool bounds and audit trail
   * ------------------------------------------------------------------ */

  describe("pool bounds", function () {
    it("refuses to activate a pool that was never created", async function () {
      await expect(staking.connect(admin).setPoolActive(5, true)).to.be.revertedWith("no pool");
    });

    it("refuses a stake into an id past poolCount", async function () {
      await token.connect(alice).approve(await staking.getAddress(), E(1));
      await expect(staking.connect(alice).stake(5, E(1))).to.be.revertedWith("no pool");
    });

    it("refuses funding an id past poolCount", async function () {
      await token.connect(treasury).approve(await staking.getAddress(), E(1));
      await expect(staking.connect(treasury).fundRewardPool(5, E(1))).to.be.revertedWith("no pool");
    });
  });

  describe("audit trail", function () {
    it("counts forfeited rewards as paid out", async function () {
      await stakeAs(alice, 0, E(1000));
      await fund(0, E(300));
      await time.increase(10 * DAY);

      await staking.connect(alice).unstake(0, E(1000));

      const pool = await staking.getPool(0);
      const forfeited = await token.balanceOf(penaltyRcv.address);

      // funded − paid must equal what stakers can still draw. Omitting the
      // forfeit left this figure permanently overstated.
      expect(forfeited).to.be.gt(0);
      expect(pool.totalRewardsPaid).to.be.gte(forfeited);
    });

    it("keeps the contract solvent across every path", async function () {
      await stakeAs(alice, 0, E(1000));
      await stakeAs(bob, 0, E(2000));
      await fund(0, E(300));
      await time.increase(10 * DAY);
      await staking.connect(alice).claimRewards(0);
      await staking.connect(alice).unstake(0, E(1000));

      expect(await staking.isSolvent()).to.equal(true);
      expect(await token.balanceOf(await staking.getAddress()))
        .to.be.gte(await staking.totalStakedAllPools());
    });
  });
});

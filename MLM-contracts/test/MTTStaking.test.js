const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MTTStaking", function () {
  let token, staking, admin, treasury, penaltyRcv, alice, bob;
  const DAY = 24 * 60 * 60;

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

    // Distribute test balances
    await token.connect(admin).transfer(treasury.address, ethers.parseEther("1000000"));
    await token.connect(admin).transfer(alice.address, ethers.parseEther("10000"));
    await token.connect(admin).transfer(bob.address, ethers.parseEther("10000"));

    // Pool 0: 30-day lock, 30-day reward stream, 30% early-exit penalty on pending rewards
    await staking.connect(admin).createPool(30 * DAY, 30 * DAY, 3000);
  });

  async function fundPool(poolId, amount) {
    await token.connect(treasury).approve(await staking.getAddress(), amount);
    await staking.connect(treasury).fundRewardPool(poolId, amount);
  }

  async function stakeAs(signer, poolId, amount) {
    await token.connect(signer).approve(await staking.getAddress(), amount);
    await staking.connect(signer).stake(poolId, amount);
  }

  describe("Pool administration", function () {
    it("only POOL_ADMIN_ROLE can create pools", async function () {
      await expect(staking.connect(alice).createPool(DAY, DAY, 100)).to.be.reverted;
    });

    it("rejects a penalty above 100%", async function () {
      await expect(staking.connect(admin).createPool(DAY, DAY, 10001)).to.be.revertedWith("penalty>100%");
    });

    it("cannot stake into an inactive pool", async function () {
      await staking.connect(admin).setPoolActive(0, false);
      await token.connect(alice).approve(await staking.getAddress(), 100);
      await expect(staking.connect(alice).stake(0, 100)).to.be.revertedWith("pool inactive");
    });
  });

  describe("TREASURY-ONLY reward funding (compliance requirement)", function () {
    it("only TREASURY_ROLE can fund a reward pool", async function () {
      await token.connect(alice).approve(await staking.getAddress(), 100);
      await expect(staking.connect(alice).fundRewardPool(0, 100)).to.be.reverted;
    });

    it("stakers' principal does NOT become reward budget", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      // No treasury funding has happened, so after time passes there is still zero yield
      await time.increase(10 * DAY);
      expect(await staking.earned(0, alice.address)).to.equal(0n);
    });

    it("records cumulative funding for audit", async function () {
      await fundPool(0, ethers.parseEther("300"));
      const pool = await staking.pools(0);
      expect(pool.totalRewardsFunded).to.equal(ethers.parseEther("300"));
    });
  });

  describe("Staking and rewards", function () {
    it("stakes, transfers tokens in, and sets the lock end", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      const info = await staking.userInfo(0, alice.address);
      expect(info.amount).to.equal(ethers.parseEther("1000"));
      const now = await time.latest();
      expect(info.lockEnd).to.be.closeTo(BigInt(now + 30 * DAY), 5n);
    });

    it("accrues rewards over time after treasury funding", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await fundPool(0, ethers.parseEther("300"));
      await time.increase(15 * DAY);
      const earned = await staking.earned(0, alice.address);
      // ~half the 30-day stream of 300 => ~150
      expect(earned).to.be.closeTo(ethers.parseEther("150"), ethers.parseEther("1"));
    });

    it("splits rewards pro-rata between stakers", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await stakeAs(bob, 0, ethers.parseEther("3000"));
      await fundPool(0, ethers.parseEther("400"));
      await time.increase(30 * DAY);
      const a = await staking.earned(0, alice.address);
      const b = await staking.earned(0, bob.address);
      // alice 25%, bob 75%
      expect(a).to.be.closeTo(ethers.parseEther("100"), ethers.parseEther("2"));
      expect(b).to.be.closeTo(ethers.parseEther("300"), ethers.parseEther("2"));
    });

    it("never distributes more rewards than were funded", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await fundPool(0, ethers.parseEther("300"));
      await time.increase(100 * DAY); // long past the stream end
      const earned = await staking.earned(0, alice.address);
      expect(earned).to.be.lte(ethers.parseEther("300"));
    });

    it("claims rewards and transfers them out", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await fundPool(0, ethers.parseEther("300"));
      await time.increase(30 * DAY);
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).claimRewards(0);
      const after = await token.balanceOf(alice.address);
      expect(after - before).to.be.closeTo(ethers.parseEther("300"), ethers.parseEther("2"));
    });

    it("reverts claiming when nothing is accrued", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await expect(staking.connect(alice).claimRewards(0)).to.be.revertedWith("nothing to claim");
    });
  });

  describe("PRINCIPAL SAFETY (never confiscated)", function () {
    it("returns full principal on normal unstake after lock expiry", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await fundPool(0, ethers.parseEther("300"));
      await time.increase(31 * DAY);
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).unstake(0, ethers.parseEther("1000"));
      expect(await token.balanceOf(alice.address) - before).to.equal(ethers.parseEther("1000"));
    });

    it("returns FULL principal even on early unstake (only pending rewards are penalized)", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await fundPool(0, ethers.parseEther("300"));
      await time.increase(10 * DAY);

      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).unstake(0, ethers.parseEther("1000"));
      const received = await token.balanceOf(alice.address) - before;

      // principal returned in full, untouched by the penalty
      expect(received).to.equal(ethers.parseEther("1000"));
      // penalty receiver got a cut of the PENDING REWARDS only
      expect(await token.balanceOf(penaltyRcv.address)).to.be.gt(0n);
    });

    it("early-exit penalty takes exactly the configured % of pending rewards", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await fundPool(0, ethers.parseEther("300"));
      await time.increase(10 * DAY);

      const pendingBefore = await staking.earned(0, alice.address);
      await staking.connect(alice).unstake(0, ethers.parseEther("1000"));
      const forfeited = await token.balanceOf(penaltyRcv.address);

      // 30% of pending, within rounding for the extra block
      expect(forfeited).to.be.closeTo(pendingBefore * 3000n / 10000n, ethers.parseEther("0.5"));
    });

    it("no penalty is applied after the lock has expired", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await fundPool(0, ethers.parseEther("300"));
      await time.increase(31 * DAY);
      await staking.connect(alice).unstake(0, ethers.parseEther("1000"));
      expect(await token.balanceOf(penaltyRcv.address)).to.equal(0n);
    });

    it("supports partial unstaking", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await time.increase(31 * DAY);
      await staking.connect(alice).unstake(0, ethers.parseEther("400"));
      const info = await staking.userInfo(0, alice.address);
      expect(info.amount).to.equal(ethers.parseEther("600"));
    });

    it("cannot unstake more than staked", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await expect(
        staking.connect(alice).unstake(0, ethers.parseEther("1001"))
      ).to.be.revertedWith("invalid amount");
    });

    it("cannot unstake another user's funds", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await expect(staking.connect(bob).unstake(0, ethers.parseEther("1"))).to.be.revertedWith("invalid amount");
    });
  });

  describe("Solvency", function () {
    it("contract holds at least total staked principal at all times", async function () {
      await stakeAs(alice, 0, ethers.parseEther("1000"));
      await stakeAs(bob, 0, ethers.parseEther("2000"));
      await fundPool(0, ethers.parseEther("300"));
      await time.increase(15 * DAY);
      await staking.connect(alice).claimRewards(0);

      const pool = await staking.pools(0);
      const held = await token.balanceOf(await staking.getAddress());
      expect(held).to.be.gte(pool.totalStaked);
    });
  });
});

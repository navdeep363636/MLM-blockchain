const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Coverage for everything added to the existing contracts for the platform
 * integration: batched settlement, the on-chain dedupe helper, the aggregate
 * views the frontend reads, and the solvency checks the treasury dashboard
 * reports.
 */
describe("Platform integration additions", function () {
  const DAY = 24 * 60 * 60;

  /* ====================================================================== *
   * MTTToken
   * ====================================================================== */
  describe("MTTToken — AllocationMinted is decodable", function () {
    it("emits the bucket name as readable data, not a hash", async function () {
      const [admin, rewards, treasury, team, liq, mkt, adv] = await ethers.getSigners();
      const MTT = await ethers.getContractFactory("MTTToken");
      const token = await MTT.deploy(
        admin.address, rewards.address, treasury.address,
        team.address, liq.address, mkt.address, adv.address,
      );

      const receipt = await token.deploymentTransaction().wait();
      const buckets = receipt.logs
        .map((l) => { try { return token.interface.parseLog(l); } catch { return null; } })
        .filter((p) => p && p.name === "AllocationMinted")
        .map((p) => p.args[0]);

      /* Before the change these came back as 32-byte topics and the allocation
       * table could not be reconstructed from chain data at all. */
      expect(buckets).to.include("REWARDS_POOL");
      expect(buckets).to.include("TREASURY_RESERVE");
      expect(buckets).to.include("TEAM_VESTING");
      expect(buckets).to.include("LIQUIDITY");
      expect(buckets).to.include("MARKETING");
      expect(buckets).to.include("ADVISORS_VESTING");
      expect(buckets).to.have.lengthOf(6);
    });
  });

  /* ====================================================================== *
   * MTTReferralDistributor
   * ====================================================================== */
  describe("MTTReferralDistributor — batched settlement", function () {
    let token, dist, admin, treasury, oracle, compliance, l1, l2, l3;
    const EVT = ethers.keccak256(ethers.toUtf8Bytes("purchase-9001"));

    beforeEach(async function () {
      [admin, treasury, oracle, compliance, l1, l2, l3] = await ethers.getSigners();
      const MTT = await ethers.getContractFactory("MTTToken");
      token = await MTT.deploy(
        admin.address, admin.address, admin.address,
        admin.address, admin.address, admin.address, admin.address,
      );
      const Dist = await ethers.getContractFactory("MTTReferralDistributor");
      dist = await Dist.deploy(await token.getAddress(), admin.address);
      await dist.connect(admin).grantRole(await dist.TREASURY_ROLE(), treasury.address);
      await dist.connect(admin).grantRole(await dist.ORACLE_ROLE(), oracle.address);
      await dist.connect(admin).grantRole(await dist.COMPLIANCE_ROLE(), compliance.address);
      await token.connect(admin).transfer(treasury.address, ethers.parseEther("1000000"));
    });

    async function fund(amount) {
      await token.connect(treasury).approve(await dist.getAddress(), amount);
      await dist.connect(treasury).depositCommissionPool(amount);
    }

    function chain() {
      return [
        { recipient: l1.address, level: 1, amount: ethers.parseEther("80") },
        { recipient: l2.address, level: 2, amount: ethers.parseEther("30") },
        { recipient: l3.address, level: 3, amount: ethers.parseEther("10") },
      ];
    }

    it("records a whole three-level chain in one transaction", async function () {
      await fund(ethers.parseEther("1000"));
      await dist.connect(oracle).recordCommissionBatch(chain(), EVT);

      expect(await dist.commissionBalance(l1.address)).to.equal(ethers.parseEther("80"));
      expect(await dist.commissionBalance(l2.address)).to.equal(ethers.parseEther("30"));
      expect(await dist.commissionBalance(l3.address)).to.equal(ethers.parseEther("10"));
      expect(await dist.totalRecorded()).to.equal(ethers.parseEther("120"));
    });

    it("is ALL-OR-NOTHING when the pool cannot fund the whole chain", async function () {
      /* 100 funded, 120 owed. The single-call path would have recorded level 1
       * and level 2 and then reverted on level 3, leaving a member paid for a
       * purchase their upline was not. */
      await fund(ethers.parseEther("100"));
      await expect(
        dist.connect(oracle).recordCommissionBatch(chain(), EVT),
      ).to.be.revertedWith("insufficient funded pool balance");

      expect(await dist.commissionBalance(l1.address)).to.equal(0n);
      expect(await dist.commissionBalance(l2.address)).to.equal(0n);
      expect(await dist.totalRecorded()).to.equal(0n);
    });

    it("refuses a replayed batch without partially applying it", async function () {
      await fund(ethers.parseEther("1000"));
      await dist.connect(oracle).recordCommissionBatch(chain(), EVT);
      await expect(
        dist.connect(oracle).recordCommissionBatch(chain(), EVT),
      ).to.be.revertedWith("already recorded");
      expect(await dist.totalRecorded()).to.equal(ethers.parseEther("120"));
    });

    it("refuses a batch that collides with an earlier single record", async function () {
      await fund(ethers.parseEther("1000"));
      await dist.connect(oracle).recordCommission(l1.address, 1, ethers.parseEther("80"), EVT);
      await expect(
        dist.connect(oracle).recordCommissionBatch(chain(), EVT),
      ).to.be.revertedWith("already recorded");
    });

    it("the same recipient at a different level is a different commission", async function () {
      await fund(ethers.parseEther("1000"));
      await dist.connect(oracle).recordCommissionBatch([
        { recipient: l1.address, level: 1, amount: ethers.parseEther("50") },
        { recipient: l1.address, level: 2, amount: ethers.parseEther("20") },
      ], EVT);
      expect(await dist.commissionBalance(l1.address)).to.equal(ethers.parseEther("70"));
    });

    it("only ORACLE_ROLE can batch-record", async function () {
      await fund(ethers.parseEther("1000"));
      await expect(dist.connect(l1).recordCommissionBatch(chain(), EVT)).to.be.reverted;
    });

    it("rejects an empty, oversized or malformed batch", async function () {
      await fund(ethers.parseEther("100000"));
      await expect(dist.connect(oracle).recordCommissionBatch([], EVT)).to.be.revertedWith("empty batch");

      const many = Array.from({ length: 17 }, () => ({
        recipient: l1.address, level: 1, amount: 1n,
      }));
      await expect(dist.connect(oracle).recordCommissionBatch(many, EVT)).to.be.revertedWith("batch too large");

      await expect(dist.connect(oracle).recordCommissionBatch(
        [{ recipient: ethers.ZeroAddress, level: 1, amount: 1n }], EVT,
      )).to.be.revertedWith("recipient=0");

      await expect(dist.connect(oracle).recordCommissionBatch(
        [{ recipient: l1.address, level: 1, amount: 0n }], EVT,
      )).to.be.revertedWith("amount=0");
    });

    it("the on-chain dedupe key matches what the contract actually stores", async function () {
      await fund(ethers.parseEther("1000"));
      expect(await dist.isRecorded(l1.address, 1, EVT)).to.equal(false);

      await dist.connect(oracle).recordCommission(l1.address, 1, ethers.parseEther("10"), EVT);

      expect(await dist.isRecorded(l1.address, 1, EVT)).to.equal(true);
      expect(await dist.isRecorded(l1.address, 2, EVT)).to.equal(false);

      const key = await dist.dedupeKeyFor(l1.address, 1, EVT);
      expect(await dist.processedCommissions(key)).to.equal(true);

      /* And it matches an off-chain encoder, which is the whole point of
       * exposing it — a mismatch here would read as "not yet recorded". */
      const offChain = ethers.solidityPackedKeccak256(
        ["address", "uint8", "bytes32"], [l1.address, 1, EVT],
      );
      expect(key).to.equal(offChain);
    });

    it("batches KYC approvals", async function () {
      await dist.connect(compliance).setKycApprovedBatch([l1.address, l2.address, l3.address], true);
      expect(await dist.kycApproved(l1.address)).to.equal(true);
      expect(await dist.kycApproved(l3.address)).to.equal(true);

      await dist.connect(compliance).setKycApprovedBatch([l2.address], false);
      expect(await dist.kycApproved(l2.address)).to.equal(false);

      await expect(dist.connect(l1).setKycApprovedBatch([l1.address], true)).to.be.reverted;
      await expect(dist.connect(compliance).setKycApprovedBatch([], true)).to.be.revertedWith("bad batch size");
      await expect(
        dist.connect(compliance).setKycApprovedBatch([ethers.ZeroAddress], true),
      ).to.be.revertedWith("user=0");
    });

    it("getAccount answers claimability in one call", async function () {
      await fund(ethers.parseEther("1000"));
      await dist.connect(oracle).recordCommission(l1.address, 1, ethers.parseEther("40"), EVT);

      let acct = await dist.getAccount(l1.address);
      expect(acct.claimable).to.equal(ethers.parseEther("40"));
      expect(acct.kyc).to.equal(false);
      expect(acct.claimNow).to.equal(false);

      await dist.connect(compliance).setKycApproved(l1.address, true);
      acct = await dist.getAccount(l1.address);
      expect(acct.claimNow).to.equal(true);
    });

    it("reads many balances for reconciliation", async function () {
      await fund(ethers.parseEther("1000"));
      await dist.connect(oracle).recordCommissionBatch(chain(), EVT);
      const balances = await dist.commissionBalances([l1.address, l2.address, l3.address]);
      expect(balances).to.deep.equal([
        ethers.parseEther("80"), ethers.parseEther("30"), ethers.parseEther("10"),
      ]);
    });

    it("stays solvent against what it owes, and clawback demands a reason", async function () {
      await fund(ethers.parseEther("1000"));
      await dist.connect(oracle).recordCommissionBatch(chain(), EVT);
      expect(await dist.isSolvent()).to.equal(true);

      await expect(
        dist.connect(compliance).clawback(l1.address, ethers.parseEther("80"), EVT, ""),
      ).to.be.revertedWith("reason required");

      await expect(
        dist.connect(compliance).clawback(l1.address, ethers.parseEther("80"), EVT, "chargeback"),
      ).to.emit(dist, "CommissionClawedBack")
        .withArgs(l1.address, ethers.parseEther("80"), EVT, "chargeback");

      expect(await dist.isSolvent()).to.equal(true);
    });
  });

  /* ====================================================================== *
   * MTTStaking
   * ====================================================================== */
  describe("MTTStaking — aggregate views and solvency", function () {
    let token, staking, admin, treasury, alice;

    beforeEach(async function () {
      [admin, treasury, alice] = await ethers.getSigners();
      const MTT = await ethers.getContractFactory("MTTToken");
      token = await MTT.deploy(
        admin.address, admin.address, admin.address,
        admin.address, admin.address, admin.address, admin.address,
      );
      const Staking = await ethers.getContractFactory("MTTStaking");
      staking = await Staking.deploy(await token.getAddress(), admin.address, treasury.address);
      await staking.connect(admin).grantRole(await staking.TREASURY_ROLE(), treasury.address);

      await staking.connect(admin).createPool(0, 7 * DAY, 0);
      await staking.connect(admin).createPool(30 * DAY, 30 * DAY, 2000);

      await token.connect(admin).transfer(alice.address, ethers.parseEther("10000"));
      await token.connect(admin).transfer(treasury.address, ethers.parseEther("100000"));
    });

    it("getPool returns a named struct rather than a positional tuple", async function () {
      const pool = await staking.getPool(1);
      expect(pool.active).to.equal(true);
      expect(pool.lockDuration).to.equal(30n * BigInt(DAY));
      expect(pool.rewardsDuration).to.equal(30n * BigInt(DAY));
      expect(pool.earlyUnstakePenaltyBps).to.equal(2000n);
      expect(pool.totalStaked).to.equal(0n);
    });

    it("getPools enumerates the catalogue", async function () {
      const pools = await staking.getPools();
      expect(pools).to.have.lengthOf(2);
      expect(pools[0].lockDuration).to.equal(0n);
      expect(pools[1].earlyUnstakePenaltyBps).to.equal(2000n);
    });

    it("getPosition reports amount, lock and live pending rewards together", async function () {
      await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(alice).stake(1, ethers.parseEther("1000"));

      await token.connect(treasury).approve(await staking.getAddress(), ethers.parseEther("3000"));
      await staking.connect(treasury).fundRewardPool(1, ethers.parseEther("3000"));

      await time.increase(15 * DAY);

      const pos = await staking.getPosition(1, alice.address);
      expect(pos.amount).to.equal(ethers.parseEther("1000"));
      expect(pos.locked).to.equal(true);
      expect(pos.pendingRewards).to.be.gt(0n);
      /* Matches the single-purpose accessor it replaces. */
      expect(pos.pendingRewards).to.equal(await staking.earned(1, alice.address));
    });

    it("getPositions returns one row per pool, staked or not", async function () {
      await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("500"));
      await staking.connect(alice).stake(0, ethers.parseEther("500"));

      const positions = await staking.getPositions(alice.address);
      expect(positions).to.have.lengthOf(2);
      expect(positions[0].amount).to.equal(ethers.parseEther("500"));
      expect(positions[0].locked).to.equal(false); // flexible pool
      expect(positions[1].amount).to.equal(0n);
    });

    it("tracks principal across pools so solvency is checkable on-chain", async function () {
      await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("1500"));
      await staking.connect(alice).stake(0, ethers.parseEther("500"));
      await staking.connect(alice).stake(1, ethers.parseEther("1000"));

      expect(await staking.totalStakedAllPools()).to.equal(ethers.parseEther("1500"));
      expect(await staking.isSolvent()).to.equal(true);
      expect(await staking.rewardFloat()).to.equal(0n);

      await token.connect(treasury).approve(await staking.getAddress(), ethers.parseEther("2000"));
      await staking.connect(treasury).fundRewardPool(0, ethers.parseEther("2000"));
      expect(await staking.rewardFloat()).to.equal(ethers.parseEther("2000"));

      await staking.connect(alice).unstake(0, ethers.parseEther("500"));
      expect(await staking.totalStakedAllPools()).to.equal(ethers.parseEther("1000"));
      expect(await staking.isSolvent()).to.equal(true);
    });

    it("principal is never counted as reward float, so a full exit is always payable", async function () {
      await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("2000"));
      await staking.connect(alice).stake(0, ethers.parseEther("2000"));

      /* The float is what a treasury reconciler may treat as spare. It must be
       * zero here even though the contract holds 2000 MTT. */
      expect(await staking.rewardFloat()).to.equal(0n);
      await staking.connect(alice).unstake(0, ethers.parseEther("2000"));
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("10000"));
    });
  });

  /* ====================================================================== *
   * MTTVesting
   * ====================================================================== */
  describe("MTTVesting — releasable() and schedule()", function () {
    let token, vesting, admin, beneficiary, start;

    beforeEach(async function () {
      [admin, beneficiary] = await ethers.getSigners();
      const MTT = await ethers.getContractFactory("MTTToken");
      token = await MTT.deploy(
        admin.address, admin.address, admin.address,
        admin.address, admin.address, admin.address, admin.address,
      );
      start = await time.latest();
      const Vesting = await ethers.getContractFactory("MTTVesting");
      vesting = await Vesting.deploy(
        beneficiary.address, await token.getAddress(), start, 365 * DAY, 3 * 365 * DAY,
      );
      await token.connect(admin).transfer(await vesting.getAddress(), ethers.parseEther("1200"));
      await vesting.seal();
    });

    it("reports nothing releasable before the cliff, without the caller guessing a timestamp", async function () {
      expect(await vesting.releasable()).to.equal(0n);
      await time.increase(300 * DAY);
      expect(await vesting.releasable()).to.equal(0n);
    });

    it("agrees with vestedAmount at the chain's own clock", async function () {
      await time.increase(500 * DAY);
      const now = await time.latest();
      expect(await vesting.releasable()).to.equal(await vesting.vestedAmount(now));
    });

    it("falls to zero immediately after a release and grows again", async function () {
      await time.increase(400 * DAY);
      expect(await vesting.releasable()).to.be.gt(0n);
      await vesting.connect(beneficiary).release();
      expect(await vesting.releasable()).to.equal(0n);
      await time.increase(100 * DAY);
      expect(await vesting.releasable()).to.be.gt(0n);
    });

    it("schedule() answers a whole vesting screen in one call", async function () {
      await time.increase(400 * DAY);
      const s = await vesting.schedule();
      expect(s.beneficiary).to.equal(beneficiary.address);
      expect(s.start).to.equal(BigInt(start));
      expect(s.cliffEnd).to.equal(BigInt(start + 365 * DAY));
      expect(s.vestingEnd).to.equal(BigInt(start + 3 * 365 * DAY));
      expect(s.total).to.equal(ethers.parseEther("1200"));
      expect(s.released).to.equal(0n);
      expect(s.releasable).to.equal(await vesting.releasable());

      await vesting.connect(beneficiary).release();
      const after = await vesting.schedule();
      expect(after.released).to.be.gt(0n);
      expect(after.total).to.equal(ethers.parseEther("1200")); // balance + released
    });
  });
});

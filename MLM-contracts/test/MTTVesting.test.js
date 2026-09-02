const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MTTVesting", function () {
  let token, vesting, admin, beneficiary, other;
  const DAY = 24 * 60 * 60;
  const MONTH = 30 * DAY;
  const ALLOC = ethers.parseEther("150000000"); // 15% of 1B

  let start;

  beforeEach(async function () {
    [admin, beneficiary, other] = await ethers.getSigners();

    const MTT = await ethers.getContractFactory("MTTToken");
    token = await MTT.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address, admin.address
    );

    start = await time.latest();
    const Vesting = await ethers.getContractFactory("MTTVesting");
    // 12-month cliff, 36-month total vesting (12 cliff + 24 linear)
    vesting = await Vesting.deploy(
      beneficiary.address, await token.getAddress(), start, 12 * MONTH, 36 * MONTH
    );

    await token.connect(admin).transfer(await vesting.getAddress(), ALLOC);
    // The schedule vests nothing until the allocation is sealed.
    await vesting.seal();
  });

  it("reports the full allocation held", async function () {
    expect(await vesting.totalAllocation()).to.equal(ALLOC);
  });

  it("vests NOTHING before the cliff", async function () {
    await time.increase(11 * MONTH);
    expect(await vesting.vestedAmount(await time.latest())).to.equal(0n);
    await expect(vesting.release()).to.be.revertedWith("nothing to release");
  });

  it("vests the accrued portion immediately at the cliff", async function () {
    await time.increaseTo(start + 12 * MONTH + 10);
    const vested = await vesting.vestedAmount(await time.latest());
    // 12/36 of the allocation unlocks at the cliff
    expect(vested).to.be.closeTo(ALLOC / 3n, ethers.parseEther("100"));
  });

  it("vests linearly after the cliff", async function () {
    await time.increaseTo(start + 24 * MONTH);
    const vested = await vesting.vestedAmount(await time.latest());
    expect(vested).to.be.closeTo(ALLOC * 2n / 3n, ethers.parseEther("100"));
  });

  it("vests everything after the full duration", async function () {
    await time.increaseTo(start + 36 * MONTH + 1);
    expect(await vesting.vestedAmount(await time.latest())).to.equal(ALLOC);
  });

  it("releases to the beneficiary and tracks released amount", async function () {
    await time.increaseTo(start + 18 * MONTH);
    await vesting.release();
    const bal = await token.balanceOf(beneficiary.address);
    expect(bal).to.be.closeTo(ALLOC / 2n, ethers.parseEther("200"));
    expect(await vesting.released()).to.equal(bal);
  });

  it("supports repeated partial releases without over-releasing", async function () {
    await time.increaseTo(start + 18 * MONTH);
    await vesting.release();
    await time.increaseTo(start + 27 * MONTH);
    await vesting.release();
    await time.increaseTo(start + 36 * MONTH + 1);
    await vesting.release();
    expect(await token.balanceOf(beneficiary.address)).to.equal(ALLOC);
    expect(await token.balanceOf(await vesting.getAddress())).to.equal(0n);
  });

  it("always pays the beneficiary regardless of who calls release()", async function () {
    await time.increaseTo(start + 36 * MONTH + 1);
    await vesting.connect(other).release();
    expect(await token.balanceOf(beneficiary.address)).to.equal(ALLOC);
    expect(await token.balanceOf(other.address)).to.equal(0n);
  });

  it("rejects invalid constructor params", async function () {
    const Vesting = await ethers.getContractFactory("MTTVesting");
    await expect(
      Vesting.deploy(ethers.ZeroAddress, await token.getAddress(), start, MONTH, 2 * MONTH)
    ).to.be.revertedWith("beneficiary=0");
    await expect(
      Vesting.deploy(beneficiary.address, await token.getAddress(), start, 5 * MONTH, MONTH)
    ).to.be.revertedWith("cliff>duration");
  });
});

/**
 * Regression suite for the vesting audit: the allocation base and the start
 * validation. Both were exploitable by accident rather than by attack, which is
 * what made them worth fixing — a mis-sent tranche or a mistyped start date.
 */
describe("MTTVesting — sealed allocation and start validation", function () {
  const MONTH = 30 * 24 * 60 * 60;
  const E = (n) => ethers.parseEther(String(n));
  let token, vesting, admin, beneficiary, other, start;

  beforeEach(async function () {
    [admin, beneficiary, other] = await ethers.getSigners();
    const MTT = await ethers.getContractFactory("MTTToken");
    token = await MTT.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address, admin.address
    );
    start = await time.latest();
    const Vesting = await ethers.getContractFactory("MTTVesting");
    vesting = await Vesting.deploy(
      beneficiary.address, await token.getAddress(), start, 12 * MONTH, 36 * MONTH
    );
    await token.connect(admin).transfer(await vesting.getAddress(), E(1000));
  });

  it("vests nothing until the allocation is sealed", async function () {
    await time.increase(24 * MONTH);
    expect(await vesting.totalAllocation()).to.equal(0n);
    expect(await vesting.releasable()).to.equal(0n);
    await expect(vesting.release()).to.be.revertedWith("not sealed");
  });

  it("seals once and refuses a second seal", async function () {
    await vesting.seal();
    expect(await vesting.totalAllocation()).to.equal(E(1000));
    await expect(vesting.seal()).to.be.revertedWith("already sealed");
  });

  it("refuses to seal after the cliff has passed", async function () {
    await time.increase(13 * MONTH);
    await expect(vesting.seal()).to.be.revertedWith("cliff passed");
  });

  it("does not let a later transfer retroactively vest itself", async function () {
    await vesting.seal();
    await time.increase(24 * MONTH);

    const before = await vesting.releasable();
    // A tranche meant for a different bucket lands here by mistake.
    await token.connect(admin).transfer(await vesting.getAddress(), E(5000));

    /* Previously `totalAllocation()` read the live balance, so this 5,000 would
     * have vested its own 24/36 share instantly — 3,333 MTT claimable with no
     * cliff, and no way to recover it. The transfer mines a block, so a second
     * of ordinary accrual is the only movement allowed. */
    expect(await vesting.releasable()).to.be.closeTo(before, E(0.01));
    expect(await vesting.totalAllocation()).to.equal(E(1000));
    expect(await vesting.unallocatedBalance()).to.equal(E(5000));
  });

  it("never releases more than the sealed allocation", async function () {
    await vesting.seal();
    await token.connect(admin).transfer(await vesting.getAddress(), E(5000));
    await time.increase(40 * MONTH);
    await vesting.release();

    expect(await vesting.released()).to.equal(E(1000));
    expect(await token.balanceOf(beneficiary.address)).to.equal(E(1000));
    // The mis-sent tokens are still here, visible and unvested.
    expect(await token.balanceOf(await vesting.getAddress())).to.equal(E(5000));
    await expect(vesting.release()).to.be.revertedWith("nothing to release");
  });

  it("rejects a start whose cliff has already elapsed", async function () {
    const Vesting = await ethers.getContractFactory("MTTVesting");
    const backdated = start - 400 * 24 * 60 * 60;
    await expect(
      Vesting.deploy(beneficiary.address, await token.getAddress(), backdated, 365 * 24 * 60 * 60, 1095 * 24 * 60 * 60)
    ).to.be.revertedWith("cliff already elapsed");
  });

  it("accepts a backdated start while the cliff is still ahead", async function () {
    const Vesting = await ethers.getContractFactory("MTTVesting");
    const backdated = start - 30 * 24 * 60 * 60;
    const v = await Vesting.deploy(
      beneficiary.address, await token.getAddress(), backdated, 365 * 24 * 60 * 60, 1095 * 24 * 60 * 60
    );
    expect(await v.start()).to.equal(backdated);
  });

  it("vests exactly nothing one second before the cliff and something at it", async function () {
    await vesting.seal();
    const cliffEnd = start + 12 * MONTH;
    expect(await vesting.vestedAmount(cliffEnd - 1)).to.equal(0n);
    expect(await vesting.vestedAmount(cliffEnd)).to.be.gt(0n);
  });

  it("rejects a zero vesting duration and a zero token address", async function () {
    const Vesting = await ethers.getContractFactory("MTTVesting");
    await expect(
      Vesting.deploy(beneficiary.address, await token.getAddress(), start, 0, 0)
    ).to.be.revertedWith("duration=0");
    await expect(
      Vesting.deploy(beneficiary.address, ethers.ZeroAddress, start, 0, MONTH)
    ).to.be.revertedWith("token=0");
  });
});

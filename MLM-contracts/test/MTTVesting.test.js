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

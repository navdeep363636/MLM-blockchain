const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MTTToken", function () {
  let token, admin, rewardsPool, treasury, teamVest, liq, mkt, advVest, user;

  const TOTAL = ethers.parseEther("1000000000");

  beforeEach(async function () {
    [admin, rewardsPool, treasury, teamVest, liq, mkt, advVest, user] = await ethers.getSigners();
    const MTT = await ethers.getContractFactory("MTTToken");
    token = await MTT.deploy(
      admin.address, rewardsPool.address, treasury.address,
      teamVest.address, liq.address, mkt.address, advVest.address
    );
  });

  it("has correct name, symbol, decimals", async function () {
    expect(await token.name()).to.equal("Members Trail Token");
    expect(await token.symbol()).to.equal("MTT");
    expect(await token.decimals()).to.equal(18n);
  });

  it("mints exactly the fixed total supply", async function () {
    expect(await token.totalSupply()).to.equal(TOTAL);
  });

  it("distributes allocations per the tokenomics table (40/15/15/15/10/5)", async function () {
    expect(await token.balanceOf(rewardsPool.address)).to.equal(TOTAL * 4000n / 10000n);
    expect(await token.balanceOf(treasury.address)).to.equal(TOTAL * 1500n / 10000n);
    expect(await token.balanceOf(teamVest.address)).to.equal(TOTAL * 1500n / 10000n);
    expect(await token.balanceOf(liq.address)).to.equal(TOTAL * 1500n / 10000n);
    expect(await token.balanceOf(mkt.address)).to.equal(TOTAL * 1000n / 10000n);
    expect(await token.balanceOf(advVest.address)).to.equal(TOTAL * 500n / 10000n);
  });

  it("allocations sum exactly to total supply (no dust lost)", async function () {
    const sum =
      (await token.balanceOf(rewardsPool.address)) +
      (await token.balanceOf(treasury.address)) +
      (await token.balanceOf(teamVest.address)) +
      (await token.balanceOf(liq.address)) +
      (await token.balanceOf(mkt.address)) +
      (await token.balanceOf(advVest.address));
    expect(sum).to.equal(TOTAL);
  });

  it("has NO public mint function (fixed supply is enforced)", async function () {
    expect(token.interface.fragments.find(f => f.name === "mint")).to.equal(undefined);
  });

  it("rejects zero addresses in constructor", async function () {
    const MTT = await ethers.getContractFactory("MTTToken");
    await expect(MTT.deploy(
      ethers.ZeroAddress, rewardsPool.address, treasury.address,
      teamVest.address, liq.address, mkt.address, advVest.address
    )).to.be.revertedWith("admin=0");
  });

  it("only PAUSER_ROLE can pause, and pausing blocks transfers", async function () {
    await expect(token.connect(user).pause()).to.be.reverted;
    await token.connect(admin).pause();
    await expect(
      token.connect(rewardsPool).transfer(user.address, 100)
    ).to.be.revertedWithCustomError(token, "EnforcedPause");
    await token.connect(admin).unpause();
    await token.connect(rewardsPool).transfer(user.address, 100);
    expect(await token.balanceOf(user.address)).to.equal(100n);
  });

  it("holders can burn their own tokens, reducing supply", async function () {
    await token.connect(rewardsPool).transfer(user.address, ethers.parseEther("1000"));
    const before = await token.totalSupply();
    await token.connect(user).burn(ethers.parseEther("400"));
    expect(await token.totalSupply()).to.equal(before - ethers.parseEther("400"));
  });

  it("only BURNER_ROLE can adminBurn", async function () {
    await token.connect(rewardsPool).transfer(admin.address, ethers.parseEther("500"));
    await expect(token.connect(user).adminBurn(1)).to.be.reverted;
    await token.connect(admin).adminBurn(ethers.parseEther("500"));
    expect(await token.balanceOf(admin.address)).to.equal(0n);
  });
});

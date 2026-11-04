import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("Counter", function () {
  it("emite Increment al llamar inc()", async function () {
    const counter = await ethers.deployContract("Counter");

    await expect(counter.inc()).to.emit(counter, "Increment").withArgs(1n);
    expect(await counter.x()).to.equal(1n);
  });

  it("acumula los incrementos emitidos", async function () {
    const counter = await ethers.deployContract("Counter");
    const deploymentBlock = await ethers.provider.getBlockNumber();

    for (let i = 1n; i <= 10n; i += 1n) {
      await counter.incBy(i);
    }

    const events = await counter.queryFilter(counter.filters.Increment(), deploymentBlock, "latest");
    let total = 0n;
    for (const event of events) {
      if ("args" in event) {
        total += event.args.by;
      }
    }

    expect(await counter.x()).to.equal(total);
  });

  it("rechaza incrementos en cero", async function () {
    const counter = await ethers.deployContract("Counter");

    await expect(counter.incBy(0n)).to.be.revertedWithCustomError(counter, "IncrementMustBePositive");
  });
});

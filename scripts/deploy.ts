import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const currentTimestampInSeconds = Math.round(Date.now() / 1000);
  const unlockTime = currentTimestampInSeconds + 60;

  const lockedAmount = ethers.parseEther("0.001");

  console.log(
    `Deploying A2AEscrow starting at ${currentTimestampInSeconds}...`
  );

  const a2aEscrow = await ethers.deployContract("A2AEscrow", [], {
    value: 0,
  });

  await a2aEscrow.waitForDeployment();

  console.log(
    `A2AEscrow deployed to ${a2aEscrow.target}`
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

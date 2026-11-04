import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { network } from "hardhat";

const { ethers, networkName } = await network.create();

const [deployer] = await ethers.getSigners();
if (deployer === undefined) {
  throw new Error(
    "No hay cuenta configurada. Define DEPLOYER_PRIVATE_KEY o genera la cuenta de desarrollo con network/scripts/generate.ps1.",
  );
}

const chain = await ethers.provider.getNetwork();
const balance = await ethers.provider.getBalance(deployer.address);

console.log(`Red:        ${networkName} (chainId ${chain.chainId})`);
console.log(`Deployer:   ${deployer.address}`);
console.log(`Saldo:      ${ethers.formatEther(balance)} ETH`);

console.log("\nDesplegando Counter...");
const counter = await ethers.deployContract("Counter");
await counter.waitForDeployment();
const counterAddress = await counter.getAddress();
console.log(`Counter:    ${counterAddress}`);

console.log("\nDesplegando Registro...");
const registro = await ethers.deployContract("Registro", [deployer.address]);
await registro.waitForDeployment();
const registroAddress = await registro.getAddress();
console.log(`Registro:   ${registroAddress}`);

const deploymentsDir = resolve(process.cwd(), "deployments");
mkdirSync(deploymentsDir, { recursive: true });

const outputFile = resolve(deploymentsDir, `${networkName}.json`);
const deployment = {
  network: networkName,
  chainId: Number(chain.chainId),
  deployer: deployer.address,
  deployedAt: new Date().toISOString(),
  contracts: {
    Counter: {
      address: counterAddress,
      txHash: counter.deploymentTransaction()?.hash ?? null,
    },
    Registro: {
      address: registroAddress,
      txHash: registro.deploymentTransaction()?.hash ?? null,
    },
  },
};

writeFileSync(outputFile, `${JSON.stringify(deployment, null, 2)}\n`);
console.log(`\nDespliegue guardado en ${outputFile}`);

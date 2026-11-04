import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { network } from "hardhat";

type Deployment = {
  contracts: { Registro: { address: string } };
};

const { ethers, networkName } = await network.create();

const deploymentFile = resolve(process.cwd(), "deployments", `${networkName}.json`);

let deployment: Deployment;
try {
  deployment = JSON.parse(readFileSync(deploymentFile, "utf8")) as Deployment;
} catch {
  throw new Error(`No se encontro ${deploymentFile}. Ejecuta primero: npm run deploy:cadena`);
}

const registro = await ethers.getContractAt("Registro", deployment.contracts.Registro.address);

const hash = ethers.id(`documento-demo-${Date.now()}`);
const uri = "ipfs://demo/documento";

console.log(`Registro:   ${await registro.getAddress()}`);
console.log(`Hash:       ${hash}`);

console.log("\nRegistrando documento...");
const registerTx = await registro.registrar(hash, uri);
await registerTx.wait();

const documento = await registro.obtener(hash);
console.log(`Registrador: ${documento.registrador}`);
console.log(`URI:         ${documento.uri}`);
console.log(`Activo:      ${documento.activo}`);
console.log(`Total:       ${await registro.total()}`);

console.log("\nRevocando documento...");
const revokeTx = await registro.revocar(hash);
await revokeTx.wait();

const revocado = await registro.obtener(hash);
console.log(`Activo:      ${revocado.activo}`);

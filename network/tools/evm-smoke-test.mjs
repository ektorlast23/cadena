import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Wallet, formatEther } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const networkRoot = resolve(here, "..");
const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";

const privateKey = readFileSync(resolve(networkRoot, "config", "dev-account", "key"), "utf8").trim();
const provider = new JsonRpcProvider(rpcUrl, 7331, { staticNetwork: true });
const wallet = new Wallet(privateKey, provider);

const network = await provider.getNetwork();
if (network.chainId !== 7331n) {
  throw new Error(`Chain ID inesperado: ${network.chainId}`);
}

const balance = await provider.getBalance(wallet.address);
const feeData = await provider.getFeeData();

console.log(`RPC:      ${rpcUrl}`);
console.log(`Chain:    ${network.chainId}`);
console.log(`Cuenta:   ${wallet.address}`);
console.log(`Saldo:    ${formatEther(balance)} ETH`);
console.log(`Gas:      ${feeData.gasPrice ?? 0n} wei`);

const initCode = "0x600a600c600039600a6000f3602a60005260206000f3";
const tx = await wallet.sendTransaction({ data: initCode, gasLimit: 100_000n, gasPrice: 0n });
console.log(`Tx:       ${tx.hash}`);

const receipt = await tx.wait();
if (!receipt || receipt.status !== 1) {
  throw new Error("La transaccion de despliegue fallo");
}
if (!receipt.contractAddress) {
  throw new Error("La transaccion no creo un contrato");
}

console.log(`Contrato: ${receipt.contractAddress}`);
console.log(`Gas used: ${receipt.gasUsed}`);

const code = await provider.getCode(receipt.contractAddress);
if (code === "0x") {
  throw new Error("El contrato no tiene bytecode");
}
console.log(`Bytecode: ${code}`);

const result = await provider.call({ to: receipt.contractAddress, data: "0x" });
const value = BigInt(result);
console.log(`eth_call: ${value}`);

if (value !== 42n) {
  throw new Error(`Se esperaba 42 y se obtuvo ${value}`);
}

console.log("EVM OK");

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const DEV_KEY_FILE = resolve(process.cwd(), "../network/config/dev-account/key");

function normalizePrivateKey(value: string): string | undefined {
  const key = value.trim();
  const prefixed = key.startsWith("0x") ? key : `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(prefixed) ? prefixed : undefined;
}

function readLocalDeployerKey(): string | undefined {
  try {
    return normalizePrivateKey(readFileSync(DEV_KEY_FILE, "utf8"));
  } catch {
    return undefined;
  }
}

const deployerKey =
  process.env.DEPLOYER_PRIVATE_KEY !== undefined
    ? normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY)
    : readLocalDeployerKey();

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.34",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    cadena: {
      type: "http",
      chainId: 7331,
      url: process.env.CADENA_RPC_URL ?? "http://127.0.0.1:8545",
      accounts: deployerKey !== undefined ? [deployerKey] : "remote",
      gasPrice: 0n,
      timeout: 60_000,
      ethers: {
        waitForTransactionReceipt: true,
      },
    },
  },
});

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createKeyPair } from './crypto.ts';

export interface WalletFile {
  name: string;
  address: string;
  publicKey: string;
  privateKeyPem: string;
  createdAt: number;
}

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

export function walletsDir(dataDir: string): string {
  return join(dataDir, 'wallets');
}

export function walletPath(dataDir: string, name: string): string {
  if (!NAME_PATTERN.test(name)) {
    throw new Error('Nombre de wallet inválido: usá 1-32 caracteres [a-zA-Z0-9_-]');
  }
  return join(walletsDir(dataDir), `${name}.json`);
}

export function createWallet(dataDir: string, name: string, force = false): WalletFile {
  const file = walletPath(dataDir, name);
  if (existsSync(file) && !force) {
    throw new Error(`La wallet "${name}" ya existe en ${file}`);
  }
  mkdirSync(walletsDir(dataDir), { recursive: true });

  const keys = createKeyPair();
  const wallet: WalletFile = {
    name,
    address: keys.address,
    publicKey: keys.publicKey,
    privateKeyPem: keys.privateKeyPem,
    createdAt: Date.now(),
  };
  writeFileSync(file, `${JSON.stringify(wallet, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return wallet;
}

export function loadWallet(dataDir: string, name: string): WalletFile {
  const file = walletPath(dataDir, name);
  if (!existsSync(file)) throw new Error(`No existe la wallet "${name}" en ${file}`);
  return JSON.parse(readFileSync(file, 'utf8')) as WalletFile;
}

export function listWallets(dataDir: string): WalletFile[] {
  const dir = walletsDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as WalletFile)
    .sort((a, b) => a.name.localeCompare(b.name));
}

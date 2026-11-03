export const COINBASE = 'COINBASE';
export const BLOCK_REWARD = 50;
export const ADDRESS_PATTERN = /^[0-9a-f]{64}$/;

export interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  nonce: number;
  timestamp: number;
  publicKey: string;
  signature: string;
}

export interface Block {
  index: number;
  previousHash: string;
  timestamp: number;
  difficulty: number;
  merkleRoot: string;
  nonce: number;
  hash: string;
  transactions: Transaction[];
}

export interface ChainFile {
  version: 1;
  createdAt: number;
  blocks: Block[];
  pending: Transaction[];
}

export interface ChainOptions {
  dataDir: string;
  initialDifficulty?: number;
  targetBlockMs?: number;
  adjustmentInterval?: number;
  blockReward?: number;
  minDifficulty?: number;
  maxDifficulty?: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

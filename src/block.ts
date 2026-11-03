import { canonicalize, sha256 } from './crypto.ts';
import type { Transaction } from './types.ts';

export const EMPTY_MERKLE_ROOT = sha256('cadena:empty');

export function merkleRoot(transactions: Transaction[]): string {
  if (transactions.length === 0) return EMPTY_MERKLE_ROOT;

  let level = transactions.map((tx) => tx.id);
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256(level[i] + level[i + 1]));
    }
    level = next;
  }
  return level[0];
}

export interface BlockHeader {
  index: number;
  previousHash: string;
  timestamp: number;
  difficulty: number;
  merkleRoot: string;
  nonce: number;
}

export function headerPayload(header: BlockHeader): string {
  return canonicalize(header);
}

export function blockHash(header: BlockHeader): string {
  return sha256(headerPayload(header));
}

export function meetsDifficulty(hash: string, difficulty: number): boolean {
  return hash.startsWith('0'.repeat(difficulty));
}

export function mineHeader(
  base: Omit<BlockHeader, 'nonce'>,
  difficulty: number,
): { nonce: number; hash: string } {
  const prefix = '0'.repeat(difficulty);
  let nonce = 0;
  for (;;) {
    const hash = blockHash({ ...base, nonce });
    if (hash.startsWith(prefix)) return { nonce, hash };
    nonce += 1;
  }
}

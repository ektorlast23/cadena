import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import type { Transaction } from './types.ts';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function canonicalize(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',');
  return `{${body}}`;
}

type TransactionPayload = Pick<
  Transaction,
  'from' | 'to' | 'amount' | 'fee' | 'nonce' | 'timestamp' | 'publicKey'
>;

export function transactionPayload(tx: TransactionPayload): string {
  return canonicalize({
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    fee: tx.fee,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    publicKey: tx.publicKey,
  });
}

export function transactionId(tx: TransactionPayload): string {
  return sha256(transactionPayload(tx));
}

export interface KeyPair {
  address: string;
  publicKey: string;
  privateKeyPem: string;
}

export function createKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    address: sha256(publicDer),
    publicKey: publicDer.toString('base64'),
    privateKeyPem,
  };
}

export function addressFromPublicKey(publicKey: string): string {
  return sha256(Buffer.from(publicKey, 'base64'));
}

export function signPayload(privateKeyPem: string, payload: string): string {
  const key = createPrivateKey(privateKeyPem);
  return sign(null, Buffer.from(payload, 'utf8'), key).toString('base64');
}

export function verifySignature(
  publicKey: string,
  payload: string,
  signature: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      Buffer.from(payload, 'utf8'),
      key,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

import {
  addressFromPublicKey,
  signPayload,
  transactionId,
  verifySignature,
} from './crypto.ts';
import { ADDRESS_PATTERN, COINBASE } from './types.ts';
import type { Transaction } from './types.ts';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_CLOCK_DRIFT_MS = 120_000;

export function isCoinbase(tx: Transaction): boolean {
  return tx.from === COINBASE;
}

export function isAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}

function isInteger(value: number): boolean {
  return Number.isSafeInteger(value);
}

export function validateTransactionShape(tx: Transaction): string[] {
  if (!tx || typeof tx !== 'object') return ['transacción inválida'];
  const errors: string[] = [];

  if (typeof tx.id !== 'string' || !HASH_PATTERN.test(tx.id)) errors.push('id inválido');
  if (typeof tx.from !== 'string' || (tx.from !== COINBASE && !isAddress(tx.from))) {
    errors.push('from inválido');
  }
  if (typeof tx.to !== 'string' || !isAddress(tx.to)) errors.push('to inválido');
  if (!isInteger(tx.amount) || tx.amount <= 0) errors.push('amount debe ser un entero positivo');
  if (!isInteger(tx.fee) || tx.fee < 0) errors.push('fee debe ser un entero >= 0');
  if (!isInteger(tx.nonce) || tx.nonce < 0) errors.push('nonce inválido');
  if (!isInteger(tx.timestamp) || tx.timestamp <= 0) errors.push('timestamp inválido');
  if (tx.from === tx.to) errors.push('from y to no pueden ser iguales');

  if (isCoinbase(tx)) {
    if (tx.publicKey !== '' || tx.signature !== '') {
      errors.push('la coinbase no debe estar firmada');
    }
    if (tx.fee !== 0) errors.push('la coinbase no debe tener fee');
  } else {
    if (typeof tx.publicKey !== 'string' || tx.publicKey.length === 0) {
      errors.push('publicKey requerida');
    }
    if (typeof tx.signature !== 'string' || tx.signature.length === 0) {
      errors.push('firma requerida');
    }
    if (isAddress(tx.from) && tx.publicKey && addressFromPublicKey(tx.publicKey) !== tx.from) {
      errors.push('la publicKey no corresponde a from');
    }
  }

  return errors;
}

export function validateTransaction(tx: Transaction): string[] {
  const errors = validateTransactionShape(tx);
  if (errors.length > 0) return errors;

  if (tx.timestamp > Date.now() + MAX_CLOCK_DRIFT_MS) {
    errors.push('timestamp en el futuro');
  }
  if (isCoinbase(tx)) return errors;

  if (transactionId(tx) !== tx.id) errors.push('el id no coincide con el contenido');
  if (!verifySignature(tx.publicKey, tx.id, tx.signature)) errors.push('firma inválida');

  return errors;
}

export interface CreateTransactionParams {
  from: string;
  to: string;
  amount: number;
  fee?: number;
  nonce: number;
  publicKey: string;
  privateKeyPem: string;
  timestamp?: number;
}

export function createTransaction(params: CreateTransactionParams): Transaction {
  const base = {
    from: params.from,
    to: params.to,
    amount: params.amount,
    fee: params.fee ?? 0,
    nonce: params.nonce,
    timestamp: params.timestamp ?? Date.now(),
    publicKey: params.publicKey,
  };
  const id = transactionId(base);
  return { ...base, id, signature: signPayload(params.privateKeyPem, id) };
}

export function buildCoinbase(
  to: string,
  amount: number,
  timestamp: number,
  nonce = 0,
): Transaction {
  const base = {
    from: COINBASE,
    to,
    amount,
    fee: 0,
    nonce,
    timestamp,
    publicKey: '',
  };
  return { ...base, id: transactionId(base), signature: '' };
}

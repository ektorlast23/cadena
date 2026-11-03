import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyPair } from '../src/crypto.ts';
import {
  buildCoinbase,
  createTransaction,
  isCoinbase,
  validateTransaction,
} from '../src/transaction.ts';

function makeTransaction(amount = 10, fee = 1) {
  const alice = createKeyPair();
  const bob = createKeyPair();
  const tx = createTransaction({
    from: alice.address,
    to: bob.address,
    amount,
    fee,
    nonce: 0,
    publicKey: alice.publicKey,
    privateKeyPem: alice.privateKeyPem,
  });
  return { tx, alice, bob };
}

test('una transacción firmada es válida', () => {
  const { tx } = makeTransaction();
  assert.deepEqual(validateTransaction(tx), []);
});

test('rechaza montos y fees inválidos', () => {
  const { tx } = makeTransaction(0, -1);
  const errors = validateTransaction(tx);
  assert.ok(errors.some((e) => e.includes('amount')));
  assert.ok(errors.some((e) => e.includes('fee')));
});

test('detecta contenido alterado', () => {
  const { tx } = makeTransaction();
  const tampered = { ...tx, amount: tx.amount + 1 };
  const errors = validateTransaction(tampered);
  assert.ok(errors.some((e) => e.includes('id')));
  assert.ok(errors.length > 0);
});

test('rechaza una clave pública que no corresponde al emisor', () => {
  const { tx } = makeTransaction();
  const other = createKeyPair();
  const errors = validateTransaction({ ...tx, publicKey: other.publicKey });
  assert.ok(errors.some((e) => e.includes('publicKey')));
});

test('la coinbase tiene forma válida y no está firmada', () => {
  const miner = createKeyPair();
  const coinbase = buildCoinbase(miner.address, 50, Date.now(), 1);
  assert.equal(isCoinbase(coinbase), true);
  assert.deepEqual(validateTransaction(coinbase), []);
});

test('la coinbase con firma es inválida', () => {
  const miner = createKeyPair();
  const coinbase = buildCoinbase(miner.address, 50, Date.now(), 1);
  const errors = validateTransaction({ ...coinbase, signature: 'falsa' });
  assert.ok(errors.length > 0);
});

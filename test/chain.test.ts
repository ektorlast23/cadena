import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chain } from '../src/chain.ts';
import { createKeyPair } from '../src/crypto.ts';
import { createTransaction } from '../src/transaction.ts';
import type { ChainOptions } from '../src/types.ts';

function tempChain(overrides: Partial<ChainOptions> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'cadena-test-'));
  const chain = Chain.open({
    dataDir,
    initialDifficulty: 1,
    targetBlockMs: 60_000,
    adjustmentInterval: 100,
    ...overrides,
  });
  return { chain, dataDir };
}

function cleanup(dataDir: string): void {
  rmSync(dataDir, { recursive: true, force: true });
}

test('crea una cadena nueva con génesis válido', () => {
  const { chain, dataDir } = tempChain();
  try {
    assert.equal(chain.height, 0);
    assert.equal(chain.blocks.length, 1);
    assert.deepEqual(chain.validate(), { ok: true, errors: [] });
    assert.equal(chain.balanceOf(createKeyPair().address), 0);
  } finally {
    cleanup(dataDir);
  }
});

test('minar un bloque recompensa al minero', () => {
  const { chain, dataDir } = tempChain();
  const miner = createKeyPair();
  try {
    const block = chain.mineBlock(miner.address);
    assert.equal(block.index, 1);
    assert.equal(block.transactions.length, 1);
    assert.equal(chain.balanceOf(miner.address), 50);
    assert.equal(chain.pending.length, 0);
    assert.equal(chain.validate().ok, true);
  } finally {
    cleanup(dataDir);
  }
});

test('mina una transferencia y actualiza saldos', () => {
  const { chain, dataDir } = tempChain();
  const alice = createKeyPair();
  const bob = createKeyPair();
  try {
    chain.mineBlock(alice.address);
    const tx = createTransaction({
      from: alice.address,
      to: bob.address,
      amount: 12,
      fee: 1,
      nonce: chain.nextNonce(alice.address),
      publicKey: alice.publicKey,
      privateKeyPem: alice.privateKeyPem,
    });
    chain.addTransaction(tx);

    assert.equal(chain.balanceOf(alice.address), 50);
    assert.equal(chain.availableBalance(alice.address), 37);
    assert.equal(chain.pending.length, 1);

    chain.mineBlock(alice.address);

    assert.equal(chain.balanceOf(bob.address), 12);
    assert.equal(chain.balanceOf(alice.address), 88);
    assert.equal(chain.pending.length, 0);
    assert.equal(chain.validate().ok, true);
  } finally {
    cleanup(dataDir);
  }
});

test('rechaza saldo insuficiente', () => {
  const { chain, dataDir } = tempChain();
  const alice = createKeyPair();
  const bob = createKeyPair();
  try {
    const tx = createTransaction({
      from: alice.address,
      to: bob.address,
      amount: 1,
      nonce: 0,
      publicKey: alice.publicKey,
      privateKeyPem: alice.privateKeyPem,
    });
    assert.throws(() => chain.addTransaction(tx), /Saldo insuficiente/);
  } finally {
    cleanup(dataDir);
  }
});

test('el suministro no cuenta las fees como emisión', () => {
  const { chain, dataDir } = tempChain();
  const alice = createKeyPair();
  const bob = createKeyPair();
  try {
    chain.mineBlock(alice.address);
    const tx = createTransaction({
      from: alice.address,
      to: bob.address,
      amount: 5,
      fee: 2,
      nonce: 0,
      publicKey: alice.publicKey,
      privateKeyPem: alice.privateKeyPem,
    });
    chain.addTransaction(tx);
    chain.mineBlock(alice.address);

    assert.equal(chain.totalSupply(), 100);
    const sum = Object.values(chain.balances()).reduce((total, value) => total + value, 0);
    assert.equal(sum, 100);
  } finally {
    cleanup(dataDir);
  }
});

test('rechaza nonce repetido', () => {
  const { chain, dataDir } = tempChain();
  const alice = createKeyPair();
  const bob = createKeyPair();
  try {
    chain.mineBlock(alice.address);
    const make = () =>
      createTransaction({
        from: alice.address,
        to: bob.address,
        amount: 1,
        fee: 1,
        nonce: 0,
        publicKey: alice.publicKey,
        privateKeyPem: alice.privateKeyPem,
      });

    chain.addTransaction(make());
    assert.throws(() => chain.addTransaction(make()), /Nonce 0 ya usado/);
  } finally {
    cleanup(dataDir);
  }
});

test('rechaza una transacción ya incluida en la cadena', () => {
  const { chain, dataDir } = tempChain();
  const alice = createKeyPair();
  const bob = createKeyPair();
  try {
    chain.mineBlock(alice.address);
    const tx = createTransaction({
      from: alice.address,
      to: bob.address,
      amount: 5,
      nonce: 0,
      publicKey: alice.publicKey,
      privateKeyPem: alice.privateKeyPem,
    });
    chain.addTransaction(tx);
    chain.mineBlock(alice.address);
    assert.throws(() => chain.addTransaction(tx), /ya conocida/);
  } finally {
    cleanup(dataDir);
  }
});

test('detecta un bloque alterado', () => {
  const { chain, dataDir } = tempChain();
  const miner = createKeyPair();
  try {
    chain.mineBlock(miner.address);
    chain.blocks[1].transactions[0].amount += 1;
    const result = chain.validate();
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  } finally {
    cleanup(dataDir);
  }
});

test('persiste y recarga la cadena', () => {
  const { chain, dataDir } = tempChain();
  const alice = createKeyPair();
  const bob = createKeyPair();
  try {
    chain.mineBlock(alice.address);
    const tx = createTransaction({
      from: alice.address,
      to: bob.address,
      amount: 7,
      fee: 2,
      nonce: 0,
      publicKey: alice.publicKey,
      privateKeyPem: alice.privateKeyPem,
    });
    chain.addTransaction(tx);
    chain.mineBlock(alice.address);

    const reloaded = Chain.open({
      dataDir,
      initialDifficulty: 1,
      targetBlockMs: 60_000,
      adjustmentInterval: 100,
    });

    assert.equal(reloaded.height, chain.height);
    assert.equal(reloaded.balanceOf(bob.address), 7);
    assert.equal(reloaded.balanceOf(alice.address), chain.balanceOf(alice.address));
    assert.equal(reloaded.validate().ok, true);
  } finally {
    cleanup(dataDir);
  }
});

test('ajusta la dificultad según el tiempo entre bloques', () => {
  const { chain, dataDir } = tempChain({
    initialDifficulty: 1,
    targetBlockMs: 1000,
    adjustmentInterval: 2,
  });
  const miner = createKeyPair();
  try {
    for (let i = 0; i < 4; i += 1) chain.mineBlock(miner.address);
    assert.equal(chain.nextDifficulty(), 2);

    const block = chain.mineBlock(miner.address);
    assert.equal(block.difficulty, 2);
    assert.equal(chain.validate().ok, true);
  } finally {
    cleanup(dataDir);
  }
});

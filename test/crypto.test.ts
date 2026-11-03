import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addressFromPublicKey,
  canonicalize,
  createKeyPair,
  sha256,
  signPayload,
  verifySignature,
} from '../src/crypto.ts';

test('sha256 coincide con un vector conocido', () => {
  assert.equal(
    sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('canonicalize es independiente del orden de las claves', () => {
  const a = canonicalize({ b: 2, a: 1, nested: { y: true, x: 'z' } });
  const b = canonicalize({ nested: { x: 'z', y: true }, a: 1, b: 2 });
  assert.equal(a, b);
});

test('una clave ed25519 produce dirección estable y firma verificable', () => {
  const keys = createKeyPair();
  assert.match(keys.address, /^[0-9a-f]{64}$/);
  assert.equal(keys.address, addressFromPublicKey(keys.publicKey));

  const payload = 'hola cadena';
  const signature = signPayload(keys.privateKeyPem, payload);
  assert.equal(verifySignature(keys.publicKey, payload, signature), true);
  assert.equal(verifySignature(keys.publicKey, `${payload}!`, signature), false);
});

test('una firma no verifica con otra clave', () => {
  const alice = createKeyPair();
  const bob = createKeyPair();
  const signature = signPayload(alice.privateKeyPem, 'mensaje');
  assert.equal(verifySignature(bob.publicKey, 'mensaje', signature), false);
});

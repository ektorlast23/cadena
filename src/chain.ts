import { EventEmitter } from 'node:events';
import { blockHash, merkleRoot, meetsDifficulty, mineHeader } from './block.ts';
import { JsonStore } from './storage.ts';
import { buildCoinbase, isAddress, isCoinbase, validateTransaction } from './transaction.ts';
import { BLOCK_REWARD } from './types.ts';
import type { Block, ChainFile, ChainOptions, Transaction, ValidationResult } from './types.ts';

const ZERO_HASH = '0'.repeat(64);
export const GENESIS_TIMESTAMP = 1_700_000_000_000;

interface ResolvedOptions {
  initialDifficulty: number;
  targetBlockMs: number;
  adjustmentInterval: number;
  blockReward: number;
  minDifficulty: number;
  maxDifficulty: number;
}

export interface Balances {
  [address: string]: number;
}

export interface ChainInfo {
  height: number;
  blocks: number;
  pending: number;
  lastHash: string;
  nextDifficulty: number;
  totalSupply: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveOptions(options: ChainOptions): ResolvedOptions {
  const minDifficulty = options.minDifficulty ?? 1;
  const maxDifficulty = options.maxDifficulty ?? 5;
  return {
    initialDifficulty: clamp(options.initialDifficulty ?? 3, minDifficulty, maxDifficulty),
    targetBlockMs: options.targetBlockMs ?? 15_000,
    adjustmentInterval: Math.max(1, options.adjustmentInterval ?? 5),
    blockReward: options.blockReward ?? BLOCK_REWARD,
    minDifficulty,
    maxDifficulty,
  };
}

function applyTransaction(balances: Balances, tx: Transaction): void {
  if (isCoinbase(tx)) {
    balances[tx.to] = (balances[tx.to] ?? 0) + tx.amount;
    return;
  }
  balances[tx.from] = (balances[tx.from] ?? 0) - tx.amount - tx.fee;
  balances[tx.to] = (balances[tx.to] ?? 0) + tx.amount;
}

function adjustDifficulty(
  window: Block[],
  options: ResolvedOptions,
): number {
  if (window.length < 2) return window[window.length - 1].difficulty;
  const first = window[0];
  const last = window[window.length - 1];
  const expected = options.targetBlockMs * (window.length - 1);
  const actual = last.timestamp - first.timestamp;
  const current = last.difficulty;

  if (actual < expected / 2) return Math.min(current + 1, options.maxDifficulty);
  if (actual > expected * 2) return Math.max(current - 1, options.minDifficulty);
  return current;
}

function expectedDifficulty(
  blocks: Block[],
  index: number,
  options: ResolvedOptions,
): number {
  const previous = blocks[index - 1];
  if (index % options.adjustmentInterval !== 0) return previous.difficulty;
  const window = blocks.slice(index - options.adjustmentInterval, index);
  return adjustDifficulty(window, options);
}

export class Chain extends EventEmitter {
  readonly dataDir: string;
  readonly options: ResolvedOptions;
  readonly store: JsonStore;
  blocks: Block[];
  pending: Transaction[];
  private mining = false;

  private constructor(
    dataDir: string,
    options: ResolvedOptions,
    blocks: Block[],
    pending: Transaction[],
  ) {
    super();
    this.dataDir = dataDir;
    this.options = options;
    this.store = new JsonStore(dataDir);
    this.blocks = blocks;
    this.pending = pending;
  }

  static open(options: ChainOptions): Chain {
    const resolved = resolveOptions(options);
    const store = new JsonStore(options.dataDir);
    const existing = store.load();

    if (existing) {
      if (existing.version !== 1) {
        throw new Error(`Versión de archivo no soportada: ${existing.version}`);
      }
      return new Chain(options.dataDir, resolved, existing.blocks, existing.pending ?? []);
    }

    const genesis = Chain.createGenesis(resolved.initialDifficulty);
    const chain = new Chain(options.dataDir, resolved, [genesis], []);
    chain.persist();
    return chain;
  }

  static createGenesis(difficulty: number): Block {
    const header = {
      index: 0,
      previousHash: ZERO_HASH,
      timestamp: GENESIS_TIMESTAMP,
      difficulty,
      merkleRoot: merkleRoot([]),
    };
    const { nonce, hash } = mineHeader(header, difficulty);
    return { ...header, nonce, hash, transactions: [] };
  }

  get height(): number {
    return this.blocks.length - 1;
  }

  get lastBlock(): Block {
    return this.blocks[this.blocks.length - 1];
  }

  balances(): Balances {
    const balances: Balances = {};
    for (const block of this.blocks) {
      for (const tx of block.transactions) applyTransaction(balances, tx);
    }
    return balances;
  }

  balanceOf(address: string): number {
    return this.balances()[address] ?? 0;
  }

  pendingOutgoing(address: string): number {
    return this.pending
      .filter((tx) => !isCoinbase(tx) && tx.from === address)
      .reduce((sum, tx) => sum + tx.amount + tx.fee, 0);
  }

  availableBalance(address: string): number {
    return this.balanceOf(address) - this.pendingOutgoing(address);
  }

  nextNonce(address: string): number {
    let highest = -1;
    for (const block of this.blocks) {
      for (const tx of block.transactions) {
        if (tx.from === address && tx.nonce > highest) highest = tx.nonce;
      }
    }
    for (const tx of this.pending) {
      if (tx.from === address && tx.nonce > highest) highest = tx.nonce;
    }
    return highest + 1;
  }

  hasTransaction(id: string): boolean {
    if (this.pending.some((tx) => tx.id === id)) return true;
    return this.blocks.some((block) => block.transactions.some((tx) => tx.id === id));
  }

  hasNonce(from: string, nonce: number): boolean {
    const matches = (tx: Transaction) => tx.from === from && tx.nonce === nonce;
    if (this.pending.some(matches)) return true;
    return this.blocks.some((block) => block.transactions.some(matches));
  }

  totalSupply(): number {
    return this.options.blockReward * (this.blocks.length - 1);
  }

  addTransaction(tx: Transaction): Transaction {
    const errors = validateTransaction(tx);
    if (errors.length > 0) {
      throw new Error(`Transacción inválida: ${errors.join('; ')}`);
    }
    if (this.hasTransaction(tx.id)) throw new Error('Transacción ya conocida');
    if (this.hasNonce(tx.from, tx.nonce)) {
      throw new Error(`Nonce ${tx.nonce} ya usado por ${tx.from}`);
    }

    const available = this.availableBalance(tx.from);
    const required = tx.amount + tx.fee;
    if (available < required) {
      throw new Error(`Saldo insuficiente: disponible ${available}, requerido ${required}`);
    }

    this.pending.push(tx);
    this.persist();
    this.emit('transaction', tx);
    return tx;
  }

  selectPending(): Transaction[] {
    const balances = this.balances();
    const usedIds = new Set<string>();
    const usedNonces = new Set<string>();

    for (const block of this.blocks) {
      for (const tx of block.transactions) {
        usedIds.add(tx.id);
        if (!isCoinbase(tx)) usedNonces.add(`${tx.from}:${tx.nonce}`);
      }
    }

    const selected: Transaction[] = [];
    for (const tx of this.pending) {
      if (usedIds.has(tx.id)) continue;
      if (usedNonces.has(`${tx.from}:${tx.nonce}`)) continue;

      const balance = balances[tx.from] ?? 0;
      const cost = tx.amount + tx.fee;
      if (balance < cost) continue;

      balances[tx.from] = balance - cost;
      balances[tx.to] = (balances[tx.to] ?? 0) + tx.amount;
      usedIds.add(tx.id);
      usedNonces.add(`${tx.from}:${tx.nonce}`);
      selected.push(tx);
    }

    return selected;
  }

  mineBlock(miner: string): Block {
    if (!isAddress(miner)) throw new Error(`Dirección de minero inválida: ${miner}`);
    if (this.mining) throw new Error('Ya hay una minería en curso');

    this.mining = true;
    try {
      const selected = this.selectPending();
      const totalFees = selected.reduce((sum, tx) => sum + tx.fee, 0);
      const timestamp = Math.max(Date.now(), this.lastBlock.timestamp);
      const index = this.blocks.length;
      const coinbase = buildCoinbase(
        miner,
        this.options.blockReward + totalFees,
        timestamp,
        index,
      );
      const transactions = [coinbase, ...selected];
      const difficulty = this.nextDifficulty();
      const header = {
        index,
        previousHash: this.lastBlock.hash,
        timestamp,
        difficulty,
        merkleRoot: merkleRoot(transactions),
      };
      const { nonce, hash } = mineHeader(header, difficulty);
      const block: Block = { ...header, nonce, hash, transactions };

      this.blocks.push(block);
      const included = new Set(selected.map((tx) => tx.id));
      this.pending = this.pending.filter((tx) => !included.has(tx.id));
      this.persist();
      this.emit('block', block);
      return block;
    } finally {
      this.mining = false;
    }
  }

  nextDifficulty(): number {
    return expectedDifficulty(this.blocks, this.blocks.length, this.options);
  }

  validate(): ValidationResult {
    const errors: string[] = [];
    if (this.blocks.length === 0) return { ok: false, errors: ['la cadena está vacía'] };

    const seenIds = new Set<string>();
    const seenNonces = new Set<string>();
    const balances: Balances = {};

    for (let index = 0; index < this.blocks.length; index += 1) {
      const block = this.blocks[index];
      const previous = this.blocks[index - 1];

      if (index === 0) {
        if (block.index !== 0) errors.push('génesis: índice debe ser 0');
        if (block.previousHash !== ZERO_HASH) errors.push('génesis: previousHash inválido');
        if (block.transactions.length !== 0) errors.push('génesis: no debe tener transacciones');
      } else {
        if (!previous) {
          errors.push(`bloque ${index}: falta el bloque anterior`);
        } else {
          if (block.index !== previous.index + 1) {
            errors.push(`bloque ${index}: índice inválido`);
          }
          if (block.previousHash !== previous.hash) {
            errors.push(`bloque ${index}: previousHash no coincide`);
          }
          if (block.timestamp < previous.timestamp) {
            errors.push(`bloque ${index}: timestamp anterior al del bloque previo`);
          }
          const expected = expectedDifficulty(this.blocks, index, this.options);
          if (block.difficulty !== expected) {
            errors.push(
              `bloque ${index}: dificultad ${block.difficulty}, esperada ${expected}`,
            );
          }
        }
      }

      if (block.timestamp > Date.now() + 120_000) {
        errors.push(`bloque ${index}: timestamp en el futuro`);
      }

      const header = {
        index: block.index,
        previousHash: block.previousHash,
        timestamp: block.timestamp,
        difficulty: block.difficulty,
        merkleRoot: block.merkleRoot,
        nonce: block.nonce,
      };
      if (blockHash(header) !== block.hash) errors.push(`bloque ${index}: hash inválido`);
      if (!meetsDifficulty(block.hash, block.difficulty)) {
        errors.push(`bloque ${index}: no cumple la prueba de trabajo`);
      }
      if (merkleRoot(block.transactions) !== block.merkleRoot) {
        errors.push(`bloque ${index}: merkleRoot inválido`);
      }

      const regular = block.transactions.filter((tx) => !isCoinbase(tx));
      const coinbases = block.transactions.filter(isCoinbase);

      if (index > 0 || block.transactions.length > 0) {
        if (coinbases.length !== 1 || !isCoinbase(block.transactions[0])) {
          errors.push(`bloque ${index}: debe contener exactamente una coinbase al inicio`);
        } else {
          const fees = regular.reduce((sum, tx) => sum + tx.fee, 0);
          const expectedAmount = this.options.blockReward + fees;
          if (block.transactions[0].amount !== expectedAmount) {
            errors.push(
              `bloque ${index}: recompensa ${block.transactions[0].amount}, esperada ${expectedAmount}`,
            );
          }
        }
      }

      for (const tx of block.transactions) {
        const txErrors = validateTransaction(tx);
        if (txErrors.length > 0) {
          errors.push(`bloque ${index}: ${txErrors.join('; ')}`);
          continue;
        }
        if (seenIds.has(tx.id)) errors.push(`bloque ${index}: transacción duplicada`);
        if (!isCoinbase(tx)) {
          const nonceKey = `${tx.from}:${tx.nonce}`;
          if (seenNonces.has(nonceKey)) {
            errors.push(`bloque ${index}: nonce duplicado para ${tx.from}`);
          }
          const balance = balances[tx.from] ?? 0;
          if (balance < tx.amount + tx.fee) {
            errors.push(`bloque ${index}: saldo insuficiente de ${tx.from}`);
          }
          seenNonces.add(nonceKey);
        }
        seenIds.add(tx.id);
        applyTransaction(balances, tx);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  info(): ChainInfo {
    return {
      height: this.height,
      blocks: this.blocks.length,
      pending: this.pending.length,
      lastHash: this.lastBlock.hash,
      nextDifficulty: this.nextDifficulty(),
      totalSupply: this.totalSupply(),
    };
  }

  reloadFromDisk(): boolean {
    const file = this.store.load();
    if (!file || file.version !== 1 || !Array.isArray(file.blocks) || file.blocks.length === 0) {
      return false;
    }

    const changed =
      file.blocks.length !== this.blocks.length ||
      file.blocks[file.blocks.length - 1].hash !== this.blocks[this.blocks.length - 1].hash ||
      (file.pending?.length ?? 0) !== this.pending.length;

    this.blocks = file.blocks;
    this.pending = file.pending ?? [];
    return changed;
  }

  persist(): void {
    const file: ChainFile = {
      version: 1,
      createdAt: this.blocks[0]?.timestamp ?? Date.now(),
      blocks: this.blocks,
      pending: this.pending,
    };
    this.store.save(file);
  }
}

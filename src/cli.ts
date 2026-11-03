import { join, resolve } from 'node:path';
import { Chain } from './chain.ts';
import { createTransaction, isAddress } from './transaction.ts';
import { createWallet, listWallets, loadWallet, walletPath } from './wallet.ts';
import type { WalletFile } from './wallet.ts';
import { startServer } from './server.ts';

type Flags = Record<string, string | boolean>;

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Flags;
}

const HELP = `
cadena — blockchain demo (PoW + transacciones firmadas)

Uso:
  node src/cli.ts <comando> [opciones]

Comandos:
  serve                     Levanta la API HTTP (default: 127.0.0.1:3000)
  info                      Altura, dificultad, pendientes y suministro
  validate                  Valida la cadena completa
  mine --wallet <nombre>    Mina un bloque con la dirección de la wallet
  mine --miner <dirección>  Mina un bloque para una dirección
  watch                     Vista en vivo en la terminal (--interval <ms>)
  balance <dirección>       Consulta saldo (o usá --wallet <nombre>)
  send --wallet <nombre> --to <dirección> --amount <entero> [--fee <entero>]
  wallet new --name <n>     Crea una wallet (clave ed25519)
  wallet list               Lista wallets
  wallet show --name <n>    Muestra dirección y clave pública
  demo                      Demo completa con Alice y Bob
  help                      Esta ayuda

Opciones globales:
  --data <ruta>             Directorio de datos (default: ./data)
  --force                   Sobrescribe una wallet existente (wallet new)
  --secret                  Muestra la clave privada (wallet show)
`.trim();

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Flags = {};

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    if (equals !== -1) {
      flags[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const name = arg.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }

  return { command, positional, flags };
}

function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function dataDirFrom(flags: Flags, fallback = 'data'): string {
  return resolve(stringFlag(flags, 'data') ?? fallback);
}

function parseInteger(raw: string | undefined, name: string): number {
  if (raw === undefined) throw new Error(`Falta --${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`--${name} debe ser un entero`);
  return value;
}

function walletAddress(dataDir: string, flags: Flags): string {
  const walletName = stringFlag(flags, 'wallet');
  if (walletName) return loadWallet(dataDir, walletName).address;
  const miner = stringFlag(flags, 'miner');
  if (miner) return miner;
  throw new Error('Indicá --wallet <nombre> o --miner <dirección>');
}

function ensureWallet(dataDir: string, name: string): WalletFile {
  try {
    return loadWallet(dataDir, name);
  } catch {
    return createWallet(dataDir, name);
  }
}

function shortAddress(address: string): string {
  if (address === 'COINBASE') return 'recompensa';
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-4)}` : address;
}

function runWatch(dataDir: string, interval: number): void {
  const render = (): void => {
    const chain = Chain.open({ dataDir });
    const lines: string[] = [
      `cadena · altura ${chain.height} · dificultad ${chain.nextDifficulty()} · suministro ${chain.totalSupply()} · mempool ${chain.pending.length}`,
      '',
      'Pendientes:',
    ];

    if (chain.pending.length === 0) {
      lines.push('  (vacío)');
    } else {
      for (const tx of chain.pending) {
        lines.push(`  ${shortAddress(tx.from)} → ${shortAddress(tx.to)}  ${tx.amount}  fee ${tx.fee}  n${tx.nonce}`);
      }
    }

    lines.push('', 'Últimos bloques:');
    for (const block of chain.blocks.slice(-10).reverse()) {
      lines.push(
        `  #${String(block.index).padEnd(4)} ${block.hash.slice(0, 24)}…  dif ${block.difficulty}  nonce ${block.nonce}  ${block.transactions.length} tx`,
      );
    }

    lines.push('', `Actualizado ${new Date().toLocaleTimeString()} · Ctrl+C para salir`);
    process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\n`);
  };

  render();
  setInterval(render, interval);
}

function runDemo(flags: Flags): void {
  const dataDir = dataDirFrom(flags, join('data', 'demo'));
  const chain = Chain.open({
    dataDir,
    initialDifficulty: 2,
    targetBlockMs: 5000,
    adjustmentInterval: 5,
  });
  const alice = ensureWallet(dataDir, 'alice');
  const bob = ensureWallet(dataDir, 'bob');

  console.log(`Datos:  ${dataDir}`);
  console.log(`Alice:  ${alice.address}`);
  console.log(`Bob:    ${bob.address}`);

  if (chain.height === 0) {
    console.log('\nMinando el primer bloque para Alice...');
    chain.mineBlock(alice.address);
  }

  const amount = 12;
  const fee = 1;
  const tx = createTransaction({
    from: alice.address,
    to: bob.address,
    amount,
    fee,
    nonce: chain.nextNonce(alice.address),
    publicKey: alice.publicKey,
    privateKeyPem: alice.privateKeyPem,
  });
  chain.addTransaction(tx);
  console.log(`\nTransacción: ${amount} + fee ${fee} de Alice a Bob (id ${tx.id.slice(0, 12)}…)`);

  console.log('Minando el bloque que la incluye...');
  const block = chain.mineBlock(alice.address);

  console.log(`\nBloque ${block.index} minado | hash ${block.hash.slice(0, 16)}… | nonce ${block.nonce}`);
  console.log(`Alice: ${chain.balanceOf(alice.address)}`);
  console.log(`Bob:   ${chain.balanceOf(bob.address)}`);

  const result = chain.validate();
  console.log(`\nCadena válida: ${result.ok ? 'SÍ' : 'NO'}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  }
}

function showHelp(): void {
  console.log(HELP);
}

function main(): void {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const dataDir = dataDirFrom(flags);

  switch (command) {
    case 'help':
    case '--help':
    case '-h': {
      showHelp();
      return;
    }

    case 'serve': {
      const port = Number(stringFlag(flags, 'port') ?? 3000);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('--port debe ser un puerto válido (1-65535)');
      }
      const host = stringFlag(flags, 'host') ?? '127.0.0.1';
      const chain = Chain.open({ dataDir });
      startServer(chain, { port, host });
      return;
    }

    case 'info': {
      const chain = Chain.open({ dataDir });
      console.log(JSON.stringify({ dataDir, ...chain.info() }, null, 2));
      return;
    }

    case 'validate': {
      const chain = Chain.open({ dataDir });
      const result = chain.validate();
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    case 'mine': {
      const chain = Chain.open({ dataDir });
      const miner = walletAddress(dataDir, flags);
      if (!isAddress(miner)) throw new Error(`Dirección inválida: ${miner}`);
      const block = chain.mineBlock(miner);
      console.log(
        `Bloque ${block.index} minado | ${block.transactions.length} tx | dificultad ${block.difficulty} | nonce ${block.nonce}`,
      );
      console.log(`Hash: ${block.hash}`);
      return;
    }

    case 'watch': {
      const interval = Number(stringFlag(flags, 'interval') ?? 2000);
      if (!Number.isFinite(interval) || interval < 250) {
        throw new Error('--interval debe ser un número >= 250 (ms)');
      }
      runWatch(dataDir, interval);
      return;
    }

    case 'balance': {
      const chain = Chain.open({ dataDir });
      const address = stringFlag(flags, 'wallet')
        ? loadWallet(dataDir, stringFlag(flags, 'wallet') as string).address
        : positional[0] ?? stringFlag(flags, 'address');

      if (!address) throw new Error('Indicá una dirección o usá --wallet <nombre>');
      if (!isAddress(address)) throw new Error(`Dirección inválida: ${address}`);

      const balance = chain.balanceOf(address);
      const pending = chain.pendingOutgoing(address);
      console.log(JSON.stringify({ address, balance, pendingOutgoing: pending, available: balance - pending }, null, 2));
      return;
    }

    case 'send': {
      const walletName = stringFlag(flags, 'wallet');
      if (!walletName) throw new Error('Falta --wallet <nombre>');
      const to = stringFlag(flags, 'to');
      if (!to || !isAddress(to)) throw new Error('Falta --to <dirección válida>');

      const amount = parseInteger(stringFlag(flags, 'amount'), 'amount');
      const fee = parseInteger(stringFlag(flags, 'fee') ?? '0', 'fee');
      if (amount <= 0) throw new Error('--amount debe ser mayor que 0');
      if (fee < 0) throw new Error('--fee no puede ser negativo');

      const wallet = loadWallet(dataDir, walletName);
      const chain = Chain.open({ dataDir });
      const tx = createTransaction({
        from: wallet.address,
        to,
        amount,
        fee,
        nonce: chain.nextNonce(wallet.address),
        publicKey: wallet.publicKey,
        privateKeyPem: wallet.privateKeyPem,
      });
      chain.addTransaction(tx);
      console.log(JSON.stringify({ accepted: true, id: tx.id, pending: chain.pending.length }, null, 2));
      return;
    }

    case 'wallet': {
      const subcommand = positional[0] ?? 'list';
      if (subcommand === 'new') {
        const name = stringFlag(flags, 'name') ?? positional[1];
        if (!name) throw new Error('Falta --name <nombre>');
        const wallet = createWallet(dataDir, name, Boolean(flags.force));
        console.log(`Wallet "${wallet.name}" creada`);
        console.log(`  Dirección: ${wallet.address}`);
        console.log(`  Archivo:   ${walletPath(dataDir, name)}`);
        console.log('  Aviso: la clave privada se guarda en texto plano; no la compartas.');
        return;
      }
      if (subcommand === 'list') {
        const wallets = listWallets(dataDir);
        if (wallets.length === 0) {
          console.log('No hay wallets en este directorio de datos.');
          return;
        }
        for (const wallet of wallets) console.log(`${wallet.name.padEnd(16)} ${wallet.address}`);
        return;
      }
      if (subcommand === 'show') {
        const name = stringFlag(flags, 'name') ?? positional[1];
        if (!name) throw new Error('Falta --name <nombre>');
        const wallet = loadWallet(dataDir, name);
        console.log(JSON.stringify({
          name: wallet.name,
          address: wallet.address,
          publicKey: wallet.publicKey,
          createdAt: new Date(wallet.createdAt).toISOString(),
          privateKeyPem: flags.secret ? wallet.privateKeyPem : undefined,
        }, null, 2));
        return;
      }
      throw new Error(`Subcomando de wallet desconocido: ${subcommand}`);
    }

    case 'demo': {
      runDemo(flags);
      return;
    }

    default:
      throw new Error(`Comando desconocido: ${command}. Probá "node src/cli.ts help"`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

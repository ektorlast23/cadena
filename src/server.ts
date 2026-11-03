import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Chain } from './chain.ts';
import { EXPLORER_HTML } from './explorer.ts';
import { isAddress } from './transaction.ts';
import type { Transaction } from './types.ts';
import { listWallets } from './wallet.ts';

const MAX_BODY_BYTES = 1_000_000;
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...JSON_HEADERS,
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(html),
  });
  res.end(html);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Cuerpo de la petición demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ApiContext {
  chain: Chain;
  clients: Set<ServerResponse>;
  broadcast: (event: string, data: unknown) => void;
  sync: () => void;
}

export function createApiServer(chain: Chain): Server {
  const clients = new Set<ServerResponse>();

  const broadcast = (event: string, data: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      try {
        client.write(frame);
      } catch {
        clients.delete(client);
      }
    }
  };

  const sync = (): void => {
    try {
      if (chain.reloadFromDisk()) {
        broadcast('sync', { height: chain.height, pending: chain.pending.length });
      }
    } catch {
      // El archivo puede estar siendo reescrito por otro proceso.
    }
  };

  chain.on('block', (block) => broadcast('block', { index: block.index, hash: block.hash }));
  chain.on('transaction', (tx) => broadcast('transaction', { id: tx.id }));

  return createServer((req, res) => {
    void handleRequest({ chain, clients, broadcast, sync }, req, res);
  });
}

async function handleRequest(
  context: ApiContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { chain, clients, sync } = context;
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (method === 'OPTIONS') {
    res.writeHead(204, JSON_HEADERS);
    res.end();
    return;
  }

  try {
    if (method === 'GET' && (path === '/' || path === '/ui')) {
      sendHtml(res, EXPLORER_HTML);
      return;
    }

    if (method === 'GET' && path === '/events') {
      sync();
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      });
      res.write('retry: 2000\n\n');
      res.write(`event: snapshot\ndata: ${JSON.stringify({ height: chain.height, pending: chain.pending.length })}\n\n`);
      clients.add(res);

      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(heartbeat);
          clients.delete(res);
        }
      }, 15_000);

      req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return;
    }

    sync();

    if (method === 'GET' && (path === '/info' || path === '/api')) {
      send(res, 200, {
        name: 'cadena',
        version: '0.1.0',
        ...chain.info(),
        endpoints: [
          'GET / (explorador en vivo)',
          'GET /info',
          'GET /health',
          'GET /chain',
          'GET /blocks/:index',
          'GET /balance/:address',
          'GET /wallets',
          'GET /mempool',
          'GET /validate',
          'GET /events (SSE)',
          'POST /transactions',
          'POST /mine { miner }',
        ],
      });
      return;
    }

    if (method === 'GET' && path === '/health') {
      send(res, 200, { status: 'ok', height: chain.height, time: Date.now() });
      return;
    }

    if (method === 'GET' && path === '/chain') {
      send(res, 200, {
        height: chain.height,
        nextDifficulty: chain.nextDifficulty(),
        totalSupply: chain.totalSupply(),
        pending: chain.pending.length,
        blocks: chain.blocks,
      });
      return;
    }

    if (method === 'GET' && path.startsWith('/blocks/')) {
      const raw = path.slice('/blocks/'.length);
      const index = Number(raw);
      if (!Number.isSafeInteger(index) || index < 0) {
        send(res, 400, { error: 'índice inválido' });
        return;
      }
      const block = chain.blocks[index];
      if (!block) {
        send(res, 404, { error: 'bloque no encontrado' });
        return;
      }
      send(res, 200, block);
      return;
    }

    if (method === 'GET' && path.startsWith('/balance/')) {
      const address = path.slice('/balance/'.length);
      if (!isAddress(address)) {
        send(res, 400, { error: 'dirección inválida' });
        return;
      }
      const pending = chain.pendingOutgoing(address);
      const balance = chain.balanceOf(address);
      send(res, 200, {
        address,
        balance,
        pendingOutgoing: pending,
        available: balance - pending,
      });
      return;
    }

    if (method === 'GET' && path === '/wallets') {
      const wallets = listWallets(chain.dataDir).map((wallet) => ({
        name: wallet.name,
        address: wallet.address,
      }));
      send(res, 200, { wallets });
      return;
    }

    if (method === 'GET' && path === '/mempool') {
      send(res, 200, { count: chain.pending.length, transactions: chain.pending });
      return;
    }

    if (method === 'GET' && path === '/validate') {
      const result = chain.validate();
      send(res, result.ok ? 200 : 409, result);
      return;
    }

    if (method === 'POST' && path === '/transactions') {
      const body = (await readJson(req)) as Transaction | undefined;
      if (!body || typeof body !== 'object') {
        send(res, 400, { error: 'se esperaba una transacción JSON' });
        return;
      }
      const tx = chain.addTransaction(body);
      send(res, 201, { accepted: true, id: tx.id, pending: chain.pending.length });
      return;
    }

    if (method === 'POST' && path === '/mine') {
      const body = (await readJson(req)) as { miner?: unknown } | undefined;
      if (!body || typeof body.miner !== 'string' || !isAddress(body.miner)) {
        send(res, 400, { error: 'se requiere { "miner": "<dirección>" }' });
        return;
      }
      const block = chain.mineBlock(body.miner);
      send(res, 201, { block });
      return;
    }

    if (method === 'GET' && path === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    send(res, 404, { error: 'ruta no encontrada' });
  } catch (error) {
    send(res, 400, { error: errorMessage(error) });
  }
}

export interface ServerOptions {
  port?: number;
  host?: string;
}

export function startServer(chain: Chain, options: ServerOptions = {}): Server {
  const port = options.port ?? 3000;
  const host = options.host ?? '127.0.0.1';
  const server = createApiServer(chain);

  server.listen(port, host, () => {
    console.log(`Explorador en vivo: http://${host}:${port}`);
    console.log(`API JSON:          http://${host}:${port}/info`);
    console.log(`Altura: ${chain.height} | Pendientes: ${chain.pending.length}`);
  });

  return server;
}

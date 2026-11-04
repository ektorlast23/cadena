# cadena

[![CI](https://github.com/ektorlast23/cadena/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ektorlast23/cadena/actions/workflows/ci.yml)

Tres componentes:

- **`network/`**: red EVM permissionada real (Hyperledger Besu + QBFT, 4 validadores,
  Chain ID 7331). Es el camino de produccion.
- **`contracts/`**: proyecto Solidity + Hardhat 3 para desplegar contratos en esa red.
- **`src/` + `test/`**: demo educativa en TypeScript (PoW, un nodo, Ed25519). Se conserva
  como referencia.

## Red EVM principal

```powershell
Set-Location H:\blockChain\network
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\up.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\status.ps1
```

RPC: `http://127.0.0.1:8545` | Chain ID: `7331` | Simbolo: `CAD`.

Detalles, operacion, permissioning y checklist de produccion en
[`network/README.md`](network/README.md).

## Contratos inteligentes

```powershell
Set-Location H:\blockChain\contracts
npm install
npm run test
npm run deploy:cadena
```

Solidity + Hardhat 3 con contratos de ejemplo `Counter` y `Registro` (documentos con
`Ownable` de OpenZeppelin). Detalles en [`contracts/README.md`](contracts/README.md).

## Demo educativa (legacy)

Blockchain demo funcional en TypeScript puro (sin dependencias de runtime): bloques con
prueba de trabajo, transacciones firmadas con Ed25519, API HTTP, CLI, persistencia en JSON
y tests con el runner nativo de Node.

> Proyecto educativo. No está auditado ni diseñado para producción.

## Requisitos

- Node.js >= 24 (ejecuta TypeScript directamente mediante type stripping)

## Inicio rápido

```powershell
node src/cli.ts demo
node src/cli.ts serve
```

El demo crea dos wallets (`alice` y `bob`), mina, transfiere y valida la cadena.
Los datos quedan en `data/demo/`.

## Ver la cadena en vivo

```powershell
node src/cli.ts serve
```

Abrí **http://127.0.0.1:3000** en el navegador. El explorador muestra altura,
dificultad, suministro, mempool y bloques actualizados por SSE (y refresco de
respaldo cada 4 s). Desde la misma página podés minar con una wallet existente o
pegando una dirección.

En la terminal:

```powershell
node src/cli.ts watch
node src/cli.ts watch --interval 1000
```

Si minás o enviás desde otra terminal, el explorador y `watch` lo reflejan al
siguiente refresco (leen `data/chain.json`).

## CLI

```powershell
node src/cli.ts help

node src/cli.ts wallet new --name alice
node src/cli.ts wallet list
node src/cli.ts wallet show --name alice

node src/cli.ts mine --wallet alice
node src/cli.ts balance --wallet alice
node src/cli.ts send --wallet alice --to <direccion> --amount 10 --fee 1

node src/cli.ts info
node src/cli.ts validate
node src/cli.ts serve --port 3000 --host 127.0.0.1
```

Todas las órdenes aceptan `--data <ruta>` para usar otro directorio (default `./data`).

## API HTTP

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Explorador web en vivo |
| GET | `/info` | Info general y lista de endpoints |
| GET | `/health` | Estado del nodo |
| GET | `/chain` | Cadena completa |
| GET | `/blocks/:index` | Bloque por índice |
| GET | `/balance/:address` | Saldo, pendiente y disponible |
| GET | `/wallets` | Nombres y direcciones (sin claves privadas) |
| GET | `/mempool` | Transacciones pendientes |
| GET | `/events` | Stream SSE (snapshot, block, transaction, sync) |
| GET | `/validate` | Valida la cadena completa |
| POST | `/transactions` | Envía una transacción firmada |
| POST | `/mine` | Mina un bloque (`{ "miner": "<direccion>" }`) |

Ejemplos:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/chain
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/mine `
  -ContentType 'application/json' -Body '{"miner":"<direccion>"}'
```

## Diseño

- **Modelo de cuentas**: el saldo se deriva replicando todas las transacciones.
- **Transacciones**: `from`, `to`, `amount`, `fee`, `nonce`, `timestamp`, `publicKey`
  (SPKI DER en base64) y `signature` (Ed25519 sobre el id de la transacción).
- **Dirección**: SHA-256 de la clave pública SPKI. Se exige que `from` coincida con ella.
- **Nonce por emisor**: evita replay; la CLI calcula el siguiente automáticamente.
- **Coinbase**: primera transacción de cada bloque; paga `recompensa + fees` al minero.
- **Prueba de trabajo**: SHA-256 del header con `difficulty` ceros hexadecimales iniciales.
- **Merkle root**: compromiso de las transacciones del bloque.
- **Dificultad**: se ajusta cada `adjustmentInterval` bloques según el tiempo real
  (objetivo `targetBlockMs`), dentro de `[minDifficulty, maxDifficulty]`.
- **Persistencia**: `data/chain.json` con escritura atómica (archivo temporal + rename).
- **Validación**: estructura, hash, PoW, merkle, firmas, saldos, duplicados y dificultad.

## Tests y typecheck

```powershell
npm install
npm test
npm run typecheck
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) ejecuta en cada push y pull request:

- Demo: `npm run typecheck` + 20 tests.
- Contratos: `npm run typecheck` + 9 tests.
- Red: valida `docker-compose.yml`, el entrypoint y la sintaxis de los scripts PowerShell.

La prueba integral (`.github/workflows/integration.yml`) corre manualmente o cada lunes:
genera y levanta la red Besu, despliega los contratos, ejecuta la demo y el smoke test EVM,
y baja la red. Los logs se publican como artefacto si falla.

Dependabot revisa semanalmente dependencias npm y GitHub Actions (`.github/dependabot.yml`).

## Límites conocidos

- Un solo nodo: no hay P2P ni consenso distribuido todavía.
- Las claves privadas se guardan en texto plano en `data/wallets/`.
- La minería es síncrona y bloquea el event loop mientras busca el nonce.
- Sin límites de tamaño de bloque, tarifas dinámicas ni smart contracts.

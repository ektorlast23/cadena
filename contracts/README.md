# Contratos Cadena

Proyecto Solidity + Hardhat 3 para la red EVM de `../network` (Hyperledger Besu + QBFT,
Chain ID 7331, gas 0).

## Requisitos

- Node.js 20 o superior.
- Red levantada: `..\network\scripts\up.ps1`.

## Instalacion

```powershell
npm install
```

## Compilar, testear y verificar tipos

```powershell
npm run compile
npm run test
npm run typecheck
```

Los tests corren sobre una red simulada local; no modifican la cadena.

## Desplegar en Cadena

```powershell
npm run deploy:cadena
```

El deployer se toma de `DEPLOYER_PRIVATE_KEY` si esta definida. Si no, se usa la cuenta de
desarrollo generada en `../network/config/dev-account/key` (solo para local). El RPC se
configura con `CADENA_RPC_URL` (por defecto `http://127.0.0.1:8545`); podes copiar
`.env.example` a `.env`.

El script guarda direcciones y hashes de transaccion en `deployments/cadena.json`
(ignorado por Git).

## Demo del registro

```powershell
npm run demo:cadena
```

Registra un documento, lo consulta y lo revoca.

## Contratos

- `contracts/Counter.sol`: contador con evento `Increment` y error custom.
- `contracts/Registro.sol`: registro de documentos (`hash` + `uri`) con `Ownable` de
  OpenZeppelin. Solo el owner registra y revoca; la consulta es publica.

## Seguridad

- La cuenta de desarrollo es solo para local. En produccion define una cuenta propia y
  protege la clave (variable de entorno o keystore de Hardhat).
- `deployments/`, `.env`, `artifacts/`, `cache/` y `types/` no se versionan.
- Los contratos son de ejemplo y no estan auditados. Revisalos antes de usarlos en
  produccion.
- La auditoria de dependencias de ejecucion (`npm audit --omit=dev`) no reporta
  vulnerabilidades; el tooling de desarrollo mantiene avisos de `zod`/`glob` sin parche
  compatible dentro de Hardhat 3.

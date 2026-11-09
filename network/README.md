# Cadena EVM permissionada (Hyperledger Besu + QBFT)

Red privada de 4 validadores, compatible con EVM, bloques cada 2 segundos y consenso
QBFT (Byzantine fault tolerant: tolera 1 validador caido o malicioso de 4).

Este directorio es el camino de produccion. La demo de `../src` (PoW, un solo nodo)
se conserva como referencia educativa.

## Arquitectura

```
                         Docker network 172.28.0.0/24
  +-------------+   +-------------+   +-------------+   +-------------+
  | validator1  |   | validator2  |   | validator3  |   | validator4  |
  | Besu + QBFT |---| Besu + QBFT |---| Besu + QBFT |---| Besu + QBFT |
  | key1        |   | key2        |   | key3        |   | key4        |
  +------+------+   +-------------+   +-------------+   +-------------+
         |
   127.0.0.1:8545 (HTTP) / 8546 (WS)
```

- Chain ID: **7331**
- Moneda: **CAD**
- Bloque: **2 s**, gas limit **30.000.000**
- Gas: **0** (red privada de desarrollo; `zeroBaseFee` + `min-gas-price=0`)
- Genesis: timestamp fijo, `extraData` con los 4 validadores
- Permissioning de nodos: allowlist local con los 4 enodes y pares fijos (sin discovery)
- Permissioning de cuentas: incluido pero desactivado por defecto

## Requisitos

- Docker Desktop corriendo (backend Linux)
- 8 GB de RAM disponibles para los 4 nodos (`JAVA_OPTS=-Xmx2g` por nodo)
- PowerShell 5.1+ en Windows, o PowerShell 7+ (`pwsh`) en Linux/macOS
- En Windows, la unidad `H:` compartida con Docker Desktop (Settings > Resources > File sharing)

Las imagenes y volumenes de Docker siguen en la unidad configurada en Docker Desktop
(por defecto `C:`). Solo el proyecto vive en `H:\blockChain`.

## Inicio rapido

```powershell
Set-Location H:\blockChain\network

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\up.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\status.ps1
```

Si tu ExecutionPolicy ya permite scripts locales:

```powershell
.\scripts\generate.ps1
.\scripts\up.ps1
.\scripts\status.ps1
```

`generate.ps1` crea, en una sola pasada:

- `config/dev-account/key` y `config/dev-account/address`: cuenta de desarrollo aleatoria,
  prefondeada con 10.000 ETH en el genesis.
- `config/genesis.json`: genesis QBFT con los 4 validadores.
- `config/keys/key1..key4/`: claves privadas y publicas de los validadores.
- `config/permissions/permissions_config.toml`: solo esos 4 nodos pueden conectarse.
- `config/permissions/permissions_config.toml`: allowlists de nodos y cuentas.
- `config/permissions/static-nodes.json`: pares fijos entre los 4 validadores.
- `.env`: version de la imagen de Besu.

> Las claves se generan aleatoriamente y **no se versionan**. Respalda `config/keys`,
> `config/dev-account` y `config/genesis.json`. Sin esas claves no podes reiniciar la red.

## Puertos

| Nodo | RPC HTTP | RPC WS | Metricas | P2P |
|---|---|---|---|---|
| validator1 | `127.0.0.1:8545` | `127.0.0.1:8546` | `127.0.0.1:9545` | interno `30303` |
| validator2 | `127.0.0.1:8547` | - | `127.0.0.1:9546` | interno `30303` |
| validator3 | `127.0.0.1:8548` | - | `127.0.0.1:9547` | interno `30303` |
| validator4 | `127.0.0.1:8549` | - | `127.0.0.1:9548` | interno `30303` |

Los puertos se publican solo en loopback. Para conectar otra maquina hay que exponer
P2P de forma controlada y agregar su enode a `permissions_config.toml` y a
`static-nodes.json` en los 4 validadores.

## Conectarse

MetaMask / wallet:

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `7331`
- Simbolo: `CAD`
- Explorador: ninguno (por ahora)

Cuenta de desarrollo:

```powershell
Get-Content .\config\dev-account\address
Get-Content .\config\dev-account\key
```

La clave esta en texto plano en disco y es solo para desarrollo local. Nunca la subas
al repo ni la uses con fondos reales. Para produccion usa HSM, Web3Signer o un modulo
de seguridad de Besu.

RPC por PowerShell:

```powershell
$body = '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post `
  -ContentType 'application/json' -Body $body

$body = '{"jsonrpc":"2.0","id":1,"method":"qbft_getValidatorsByBlockNumber","params":["latest"]}'
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post `
  -ContentType 'application/json' -Body $body
```

## Permissioning

**Nodos (activo):** `permissions_config.toml` contiene los 4 enodes y
`static-nodes.json` fija las conexiones (discovery deshabilitado). Cualquier otro nodo
es rechazado aunque conozca la IP y el puerto.

**Cuentas (opcional):** para que solo las cuentas de `permissions_config.toml` puedan
enviar transacciones, reinicia todos los nodos con las flags extra:

```powershell
$env:BESU_EXTRA_ARGS = "--permissions-accounts-config-file-enabled --permissions-accounts-config-file=/config/permissions/permissions_config.toml"
docker compose up -d --force-recreate
```

Para agregar una cuenta, edita `config/permissions/permissions_config.toml` y reinicia
los 4 nodos. Todos los nodos deben usar la misma configuracion.

## Operacion

```powershell
# Estado
.\scripts\status.ps1
.\scripts\status.ps1 -RpcUrl http://127.0.0.1:8547

# Logs
docker compose logs -f validator1

# Bajar sin borrar datos
.\scripts\down.ps1

# Borrar la cadena y empezar de cero (despues hay que regenerar claves)
.\scripts\down.ps1 -Reset
.\scripts\generate.ps1
.\scripts\up.ps1
```

## Contratos

La red es EVM compatible (Cancun). El proyecto Hardhat vive en [`../contracts`](../contracts):

```powershell
Set-Location ..\contracts
npm install
npm run test
npm run deploy:cadena
```

`deploy:cadena` usa la cuenta de desarrollo de `config/dev-account/` por defecto. Con gas 0
el despliegue no consume saldo, pero la cuenta debe existir (y estar en la allowlist si
activas permissioning de cuentas).

## Prueba EVM

```powershell
Set-Location .\tools
npm install
npm run smoke
```

El script lee la cuenta de desarrollo, envia una transaccion firmada con `gasPrice=0`,
despliega un contrato minimo, verifica el bytecode y llama al contrato (`eth_call` debe
devolver `42`).

## Pruebas de resiliencia

- Reinicio completo de la red: la altura continua desde el dato persistido.
- Caida de 1 validador: los 3 restantes siguen produciendo bloques (QBFT 3 de 4).
- Reincorporacion: el validador sincroniza los bloques perdidos y vuelve a producir.

```powershell
docker compose stop validator4
docker compose start validator4
```

## Checklist antes de produccion

- [ ] Reemplazar `--host-allowlist=*` y `--rpc-http-cors-origins=*` por dominios explicitos.
- [ ] Poner el RPC detras de TLS + autenticacion (mTLS/OAuth) y rate limiting.
- [ ] No exponer `8545` a Internet; solo la API interna.
- [ ] Firewall: P2P `30303` solo entre validadores.
- [ ] Claves de validador en HSM/Web3Signer, con backup y control de acceso.
- [ ] 4+ validadores en ubicaciones/fallos independientes; QBFT tolera `(n-1)/3`.
- [ ] Metricas y alertas: altura estancada, pares, CPU/RAM/disco, errores de consenso.
- [ ] Backups de genesis, claves y snapshots de datos; probar restauracion.
- [ ] Chain ID unico y documentado; genesis bajo control de cambios.
- [ ] Definir si el gas sera cero o con fee market (`min-gas-price`).
- [ ] Activar permissioning de cuentas si el caso lo requiere (KYC/allowlist).
- [ ] Proceso de upgrade: staging, un validador a la vez, version de imagen fijada.
- [ ] Auditoria de contratos y de la configuracion; revision legal si hay tokenizacion.

## Troubleshooting

- **Aviso `Output directory already exists` al generar:** es un bug del generador de Besu
  26.x; el script verifica que el genesis y las 4 claves existan y continua. Si faltan
  artefactos, falla.
- **Docker no corre:** abre Docker Desktop y reintenta.
- **No se produce ningun bloque:** `docker compose logs --tail=100`. Verifica que los
  4 contenedores esten arriba, que `.env` y `static-nodes.json` existan y que las claves
  correspondan al genesis.
- **`path is not shared` / error de mount en H:**: agrega `H:` en Docker Desktop >
  Settings > Resources > File sharing.
- **Puerto ocupado:** cambia el puerto del host (lado izquierdo) en `docker-compose.yml`.
- **Perdi las claves:** hay que regenerar todo (`down.ps1 -Reset`, `generate.ps1`) y se
  crea una cadena nueva; los datos viejos no sirven.

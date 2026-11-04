#!/bin/sh
set -eu

if [ ! -f /config/nodekey/key ]; then
  echo "ERROR: falta /config/nodekey/key. Ejecuta scripts/generate.ps1." >&2
  exit 1
fi

if [ ! -f /config/genesis.json ]; then
  echo "ERROR: falta /config/genesis.json. Ejecuta scripts/generate.ps1." >&2
  exit 1
fi

if [ ! -f /config/permissions/permissions_config.toml ]; then
  echo "ERROR: falta /config/permissions/permissions_config.toml. Ejecuta scripts/generate.ps1." >&2
  exit 1
fi

if [ ! -f /config/permissions/static-nodes.json ]; then
  echo "ERROR: falta /config/permissions/static-nodes.json. Ejecuta scripts/generate.ps1." >&2
  exit 1
fi

RPC_API="${RPC_HTTP_API:-ETH,NET,QBFT,WEB3,TXPOOL}"
LOG_LEVEL="${BESU_LOG_LEVEL:-INFO}"
P2P_HOST="${P2P_HOST:-$(hostname -i)}"

exec besu \
  --genesis-file=/config/genesis.json \
  --data-path=/data \
  --node-private-key-file=/config/nodekey/key \
  --static-nodes-file=/config/permissions/static-nodes.json \
  --rpc-http-enabled \
  --rpc-http-host=0.0.0.0 \
  --rpc-http-port=8545 \
  --rpc-http-api="${RPC_API}" \
  --rpc-ws-enabled \
  --rpc-ws-host=0.0.0.0 \
  --rpc-ws-port=8546 \
  --rpc-ws-api="${RPC_API}" \
  --host-allowlist='*' \
  --rpc-http-cors-origins='*' \
  --p2p-host="${P2P_HOST}" \
  --p2p-port=30303 \
  --min-gas-price=0 \
  --metrics-enabled \
  --metrics-host=0.0.0.0 \
  --metrics-port=9545 \
  --permissions-nodes-config-file-enabled \
  --permissions-nodes-config-file=/config/permissions/permissions_config.toml \
  --discovery-enabled=false \
  --profile=ENTERPRISE \
  --logging="${LOG_LEVEL}" \
  ${BESU_EXTRA_ARGS:-}

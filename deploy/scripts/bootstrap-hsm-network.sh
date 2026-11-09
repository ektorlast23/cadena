#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$DEPLOY_DIR/artifacts/network}"
BESU_IMAGE="${BESU_IMAGE:-hyperledger/besu:26.10.1}"
CHAIN_ID="${CHAIN_ID:-7331}"
VALIDATOR_COUNT="${VALIDATOR_COUNT:-4}"
HSM_KEY_PREFIX="${HSM_KEY_PREFIX:-cadena-validator}"
P2P_HOSTS="${P2P_HOSTS:-}"
ACCOUNTS_ALLOWLIST="${ACCOUNTS_ALLOWLIST:-}"
LUNA_PKCS11_LIB="${LUNA_PKCS11_LIB:-/usr/safenet/lunaclient/lib/libCryptoki2_64.so}"
LUNA_TOKEN_LABEL="${LUNA_TOKEN_LABEL:-cadena-validators}"
LUNA_CO_PIN="${LUNA_CO_PIN:-}"
ALLOC_JSON="${ALLOC_JSON:-}"

if ! command -v pkcs11-tool >/dev/null 2>&1; then
  echo "ERROR: falta pkcs11-tool (paquete opensc)." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: falta jq." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: falta docker." >&2
  exit 1
fi
if ! command -v awk >/dev/null 2>&1; then
  echo "ERROR: falta awk." >&2
  exit 1
fi

if [ -z "$LUNA_TOKEN_LABEL" ]; then
  echo "ERROR: define LUNA_TOKEN_LABEL." >&2
  exit 1
fi
if [ -z "$P2P_HOSTS" ]; then
  echo "ERROR: define P2P_HOSTS con las IPs/DNS separadas por coma, en orden de validador." >&2
  exit 1
fi

IFS=',' read -r -a hosts <<< "$P2P_HOSTS"
if [ "${#hosts[@]}" -ne "$VALIDATOR_COUNT" ]; then
  echo "ERROR: P2P_HOSTS tiene ${#hosts[@]} entradas y se esperaban $VALIDATOR_COUNT." >&2
  exit 1
fi

if [ -z "$LUNA_CO_PIN" ]; then
  read -r -s -p "CO PIN de la particion Luna: " LUNA_CO_PIN
  echo
fi
if [ -z "$LUNA_CO_PIN" ]; then
  echo "ERROR: el PIN de Luna no puede estar vacio." >&2
  exit 1
fi

echo "ADVERTENCIA: pkcs11-tool recibe el PIN por argumento y puede ser visible en 'ps'." >&2
echo "             Ejecuta este script en un host de confianza y no lo compartas." >&2

p11() {
  pkcs11-tool \
    --module "$LUNA_PKCS11_LIB" \
    --token-label "$LUNA_TOKEN_LABEL" \
    --login --pin "$LUNA_CO_PIN" \
    "$@"
}

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

echo "1/5 Verificando acceso a la particion Luna ..."
if ! p11 --list-mechanisms >/dev/null 2>&1; then
  echo "ERROR: no se pudo abrir la particion $LUNA_TOKEN_LABEL." >&2
  echo "Revisa Luna Client, Chrystoki.conf, red, slot y PIN CO." >&2
  exit 1
fi

echo "2/5 Generando $VALIDATOR_COUNT claves secp256k1 en la HSM ..."
for i in $(seq 1 "$VALIDATOR_COUNT"); do
  label="${HSM_KEY_PREFIX}${i}"
  if p11 --list-objects --type privkey 2>/dev/null | grep -q "label:.*${label}$"; then
    echo "    $label ya existe; no se regenera."
    continue
  fi

  p11 --keypairgen \
    --key-type EC:secp256k1 \
    --label "$label" \
    --id "$(printf '%02d' "$i")" \
    --usage-sign \
    --usage-derive \
    --sensitive \
    --private
  echo "    $label generada."
done

echo "3/5 Extrayendo claves publicas ..."
p11 --list-objects --type pubkey > "$OUT_DIR/public_keys.raw"

mapfile -t public_keys < <(
  awk -v prefix="$HSM_KEY_PREFIX" -v count="$VALIDATOR_COUNT" '
    /^[[:space:]]*EC_POINT:/ { ec=$2 }
    $1 == "label:" { keys[$2]=ec }
    END {
      for (i = 1; i <= count; i++) {
        label = prefix i
        if (!(label in keys)) {
          print "Falta la clave publica " label > "/dev/stderr"
          exit 2
        }
        print keys[label]
      }
    }
  ' "$OUT_DIR/public_keys.raw" | sed 's/^044104/0x/'
)

if [ "${#public_keys[@]}" -ne "$VALIDATOR_COUNT" ]; then
  echo "ERROR: se esperaban $VALIDATOR_COUNT claves publicas y se obtuvieron ${#public_keys[@]}." >&2
  exit 1
fi

for key in "${public_keys[@]}"; do
  if ! [[ "$key" =~ ^0x[0-9a-fA-F]{128}$ ]]; then
    echo "ERROR: clave publica con formato inesperado: $key" >&2
    exit 1
  fi
done

printf '%s\n' "${public_keys[@]}" | jq -R . | jq -s . > "$OUT_DIR/public_keys.json"
rm -f "$OUT_DIR/public_keys.raw"

if [ -z "$ALLOC_JSON" ]; then
  ALLOC_JSON='{}'
fi
if ! jq -e . >/dev/null 2>&1 <<< "$ALLOC_JSON"; then
  echo "ERROR: ALLOC_JSON no es JSON valido." >&2
  exit 1
fi

jq -n \
  --argjson chainId "$CHAIN_ID" \
  --argjson keys "$(cat "$OUT_DIR/public_keys.json")" \
  --argjson alloc "$ALLOC_JSON" \
  '{
    genesis: {
      config: {
        chainId: $chainId,
        ecCurve: "secp256k1",
        berlinBlock: 0,
        londonBlock: 0,
        shanghaiTime: 0,
        cancunTime: 0,
        qbft: {
          blockperiodseconds: 2,
          epochlength: 30000,
          requesttimeoutseconds: 4
        },
        zeroBaseFee: true
      },
      nonce: "0x0",
      timestamp: "0x58ee40ba",
      gasLimit: "0x1c9c380",
      difficulty: "0x1",
      mixHash: "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
      coinbase: "0x0000000000000000000000000000000000000000",
      alloc: $alloc
    },
    blockchain: {
      nodes: {
        generate: false,
        keys: $keys
      }
    }
  }' > "$OUT_DIR/qbftConfigFile.json"

echo "4/5 Generando genesis QBFT desde las claves de la HSM ..."
generated_dir="$(mktemp -d)"
trap 'rm -rf "$generated_dir"' EXIT
mkdir -p "$generated_dir/out"
cp "$OUT_DIR/qbftConfigFile.json" "$generated_dir/qbftConfigFile.json"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$generated_dir:/work:ro" \
  -v "$generated_dir/out:/out" \
  "$BESU_IMAGE" \
  operator generate-blockchain-config \
  --config-file=/work/qbftConfigFile.json \
  --to=/out \
  --private-key-file-name=key

if [ ! -f "$generated_dir/out/genesis.json" ]; then
  echo "ERROR: Besu no genero genesis.json." >&2
  exit 1
fi
cp "$generated_dir/out/genesis.json" "$OUT_DIR/genesis.json"

echo "5/5 Generando permissioning ..."
jq -n \
  --argjson keys "$(cat "$OUT_DIR/public_keys.json")" \
  --argjson hosts "$(printf '%s\n' "${hosts[@]}" | jq -R . | jq -s .)" \
  '[range(0; ($keys | length)) as $i | "enode://" + ($keys[$i] | sub("^0x"; "")) + "@" + $hosts[$i] + ":30303"]' \
  > "$OUT_DIR/static-nodes.json"

accounts=()
if [ -n "$ACCOUNTS_ALLOWLIST" ]; then
  IFS=',' read -r -a raw_accounts <<< "$ACCOUNTS_ALLOWLIST"
  for account in "${raw_accounts[@]}"; do
    account="$(echo "$account" | xargs)"
    if [ -z "$account" ]; then
      continue
    fi
    if ! [[ "$account" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
      echo "ERROR: cuenta invalida en ACCOUNTS_ALLOWLIST: $account" >&2
      exit 1
    fi
    accounts+=("${account,,}")
  done
fi

{
  printf 'accounts-allowlist = ['
  for account in "${accounts[@]}"; do
    printf '"%s", ' "$account"
  done
  printf ']\n'
  printf 'nodes-allowlist = [\n'
  jq -r '.[] | "  \"" + . + "\","' "$OUT_DIR/static-nodes.json"
  printf ']\n'
} > "$OUT_DIR/permissions_config.toml"

printf '\nArtefactos generados en %s\n' "$OUT_DIR"
printf '  %s\n' "genesis.json" "public_keys.json" "static-nodes.json" "permissions_config.toml" "qbftConfigFile.json"
printf '\nValida el genesis antes de desplegar. Las claves privadas nunca salieron de Luna.\n'

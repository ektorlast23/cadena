#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$DEPLOY_DIR/artifacts/pki}"
CADENA_DOMAIN="${CADENA_DOMAIN:-cadena.internal}"
VALIDATOR_HOSTS="${VALIDATOR_HOSTS:-}"
CERT_DAYS="${CERT_DAYS:-825}"
CA_DAYS="${CA_DAYS:-3650}"
FORCE="${FORCE:-0}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: falta openssl." >&2
  exit 1
fi
if [ -z "$VALIDATOR_HOSTS" ]; then
  echo "ERROR: define VALIDATOR_HOSTS=host1:ip1,host2:ip2,..." >&2
  exit 1
fi

IFS=',' read -r -a host_entries <<< "$VALIDATOR_HOSTS"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

if [ "$FORCE" = "1" ]; then
  rm -f "$OUT_DIR/ca.key" "$OUT_DIR/ca.crt" "$OUT_DIR/ca.srl"
  rm -f "$OUT_DIR/jwt-private.pem" "$OUT_DIR/jwt-public.pem"
fi

if [ ! -f "$OUT_DIR/ca.key" ] || [ ! -f "$OUT_DIR/ca.crt" ]; then
  echo "Generando CA local ..."
  openssl genrsa -out "$OUT_DIR/ca.key" 4096
  openssl req -x509 -new -nodes -sha256 -days "$CA_DAYS" \
    -key "$OUT_DIR/ca.key" \
    -subj "/CN=Cadena Local CA" \
    -out "$OUT_DIR/ca.crt"
fi
chmod 600 "$OUT_DIR/ca.key"
chmod 644 "$OUT_DIR/ca.crt"

if [ ! -f "$OUT_DIR/jwt-private.pem" ] || [ ! -f "$OUT_DIR/jwt-public.pem" ]; then
  echo "Generando par JWT RS256 ..."
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out "$OUT_DIR/jwt-private.pem"
  openssl rsa -pubout -in "$OUT_DIR/jwt-private.pem" \
    -out "$OUT_DIR/jwt-public.pem"
fi
chmod 600 "$OUT_DIR/jwt-private.pem"
chmod 644 "$OUT_DIR/jwt-public.pem"

for entry in "${host_entries[@]}"; do
  host="${entry%%:*}"
  ip="${entry#*:}"
  if [ -z "$host" ] || [ -z "$ip" ] || [ "$host" = "$entry" ]; then
    echo "ERROR: entrada invalida en VALIDATOR_HOSTS: $entry (usa host:ip)." >&2
    exit 1
  fi

  node_dir="$OUT_DIR/$host"
  mkdir -p "$node_dir"
  chmod 700 "$node_dir"

  password="$(openssl rand -hex 24)"
  printf '%s' "$password" > "$node_dir/keystore-password"
  chmod 600 "$node_dir/keystore-password"

  cat > "$node_dir/openssl.cnf" <<EOF
[req]
distinguished_name = dn
req_extensions = ext
prompt = no

[dn]
CN = $host

[ext]
subjectAltName = @alt

[alt]
DNS.1 = $host
DNS.2 = $host.$CADENA_DOMAIN
DNS.3 = localhost
IP.1 = $ip
IP.2 = 127.0.0.1
EOF

  openssl genrsa -out "$node_dir/server.key" 2048
  openssl req -new -sha256 \
    -key "$node_dir/server.key" \
    -config "$node_dir/openssl.cnf" \
    -out "$node_dir/server.csr"
  openssl x509 -req -sha256 -days "$CERT_DAYS" \
    -in "$node_dir/server.csr" \
    -CA "$OUT_DIR/ca.crt" \
    -CAkey "$OUT_DIR/ca.key" \
    -CAcreateserial \
    -CAserial "$OUT_DIR/ca.srl" \
    -extfile "$node_dir/openssl.cnf" \
    -extensions ext \
    -out "$node_dir/server.crt"
  openssl pkcs12 -export \
    -inkey "$node_dir/server.key" \
    -in "$node_dir/server.crt" \
    -certfile "$OUT_DIR/ca.crt" \
    -name besu \
    -passout "pass:$password" \
    -out "$node_dir/server.p12"

  chmod 600 "$node_dir/server.key" "$node_dir/server.p12"
  chmod 644 "$node_dir/server.crt"
  rm -f "$node_dir/server.csr" "$node_dir/openssl.cnf"

  echo "  $host -> $ip"
done

printf '\nPKI generada en %s\n' "$OUT_DIR"
printf '  CA:       %s\n' "$OUT_DIR/ca.crt"
printf '  JWT pub:  %s\n' "$OUT_DIR/jwt-public.pem"
printf '  JWT priv: %s (solo emisor de tokens)\n' "$OUT_DIR/jwt-private.pem"
printf '\nNo copies jwt-private.pem ni ca.key a los validadores.\n'

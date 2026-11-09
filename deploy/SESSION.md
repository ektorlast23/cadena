# Sesion de trabajo - 2026-11-04

## Estado actual

- Red local Besu/QBFT de 4 validadores funcionando en Docker (`network/`).
  - Chain ID `7331`, bloque 2 s, gas 0, permissioning de nodos y cuentas.
  - RPC `8545` HTTPS + JWT RS256; WSS `8546` solo validator1.
  - Altura verificada al cierre: 5498; 3 pares por nodo; 4 validadores.
- Scaffold de produccion multi-host en `deploy/`:
  - Ansible para 4 VMs Linux: roles `common`, `docker`, `luna_client`, `besu`.
  - Claves de validador en Thales Luna con `besu-hsm-plugin`.
  - `bootstrap-hsm-network.sh` genera claves HSM, genesis, static nodes y permissioning.
  - `generate-pki.sh` genera CA, JWT RS256 y certificados TLS por nodo.
  - Documentacion operativa en `deploy/README.md`.

## Decisiones

- Solo Ansible; sin Terraform.
- Besu y plugin HSM fijados a `26.10.1` por compatibilidad.
- Web3Signer **no** firma bloques QBFT; no reemplaza al plugin HSM.
- Web3Signer no soporta PKCS#11/Luna directo; para Luna hace falta Vault Enterprise
  (u OpenBao) con `seal "pkcs11"` o un firmante PKCS#11 propio.
- La red de produccion es una cadena nueva; no reutiliza datos de la red local.

## Validaciones realizadas

- `bash -n` y `dash -n` sobre entrypoints y scripts de despliegue.
- Parseo YAML de los 14 archivos de `deploy/ansible`: 0 fallos.
- `ansible-playbook --syntax-check -i inventory/hosts.example.yml site.yml`: OK.
- Checksum SHA-256 del plugin HSM `26.10.1`: verificado.
- `generate-pki.sh` probado con 4 hosts; SAN DNS/IP correctos.
- Red local reiniciada y verificada con `network/scripts/status.ps1`.
- `docker compose config --quiet`: OK.

## Pendiente

1. Decidir fase 2 Web3Signer + Vault:
   - Vault Enterprise/OpenBao en hosts de gestion, o
   - dejarlo documentado como fase futura.
2. Datos reales de las 4 VMs: IPs/DNS, usuario SSH, claves, SO.
3. Artefactos Luna: instalador RPM/DEB, slot, token label, PIN CO y conectividad HSM.
4. Validar en staging `besu-hsm-plugin 26.10.1` contra la imagen Besu `26.10.1` y la
   version exacta del Luna Client.
5. Probar restore de backups y procedimiento de rotacion del PIN CO.

## Hardening aplicado (2026-11-04)

- `besu_host_allowlist` ahora es una lista YAML; el compose usa `unique | join(',')`.
- P2P en UFW/firewalld se limita a las IPs exactas de `groups['validators']` (`/32`).
- Nuevo rol `docker_firewall`: cadena `CADENA-FW` enganchada en `DOCKER-USER` y servicio
  systemd `cadena-docker-firewall` para `30303`, `8545` y `9545`. El script construye
  `CADENA-FW-tmp` y hace swap del jump para no dejar una ventana sin reglas.
- UFW se habilita despues de cargar SSH/P2P/RPC/metricas; firewalld quita el servicio
  SSH abierto despues de crear la rich rule de administracion.
- `DRY_RUN=1` imprime comandos `iptables -w 5 ...` ejecutables, no la funcion `ipt`.
- Verificado con `ansible-playbook --syntax-check` (ansible-core 2.19.5 en contenedor),
  render real de plantillas, `docker compose config` y prueba de `CADENA-FW` en un
  contenedor Linux con iptables.
- Job `deploy` en `.github/workflows/ci.yml`: `yamllint`, syntax-check, render de
  `tests/render.yml`, `bash -n`, `shellcheck`, `docker compose config` y grep de
  `P2P_SOURCES`/`HOST_ALLOWLIST`.

## Archivos clave

- `deploy/README.md`
- `deploy/ansible/site.yml`
- `deploy/ansible/inventory/hosts.example.yml`
- `deploy/ansible/group_vars/all.yml`
- `deploy/ansible/roles/besu/templates/docker-compose.yml.j2`
- `deploy/scripts/bootstrap-hsm-network.sh`
- `deploy/scripts/generate-pki.sh`
- `network/scripts/besu-entrypoint.sh`
- `network/README.md`

No se hizo commit.

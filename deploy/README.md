# Despliegue multi-host con Ansible, Thales Luna y Besu

Este directorio contiene el camino de produccion para 4 VMs Linux existentes. La red local
de `network/` sigue siendo el entorno de desarrollo; la red de produccion se inicializa con
claves de validador generadas dentro de Luna y **no reutiliza** los datos locales.

## Decisiones y hallazgos

- 4 VMs Linux existentes, una por validador.
- Aprovisionamiento y configuracion con **Ansible** (sin Terraform).
- Claves de validador QBFT en **Thales Luna** mediante
  [`besu-hsm-plugin`](https://github.com/besu-eth/besu-hsm-plugin) y `--security-module=hsm`.
- **Web3Signer no firma bloques QBFT**; solo firma transacciones. No reemplaza el plugin HSM
  para las claves de validador.
- **Web3Signer no soporta PKCS#11/Luna directamente**. Para usar Luna con Web3Signer hace
  falta un backend intermedio: Vault Enterprise con `seal "pkcs11"`, OpenBao con PKCS#11, o
  otro firmante. Vault Community **no** soporta auto-unseal PKCS#11; solo Vault Enterprise.
- El plugin HSM esta probado con Besu `26.10.1`; por eso el despliegue fija Besu y plugin a
  esa version. Probar `26.11.0` en staging antes de actualizar.

## Arquitectura

```
                         Thales Luna (HA group)
                                   |
             +---------------------+---------------------+
             |                     |                     |
      +------+------+       +------+------+       +------+------+
      | validator1  |       | validator2  |  ...  | validator4  |
      | Besu + HSM  |-------| Besu + HSM  |-------| Besu + HSM  |
      | plugin      |  P2P  | plugin      |  P2P  | plugin      |
      +------+------+       +-------------+       +-------------+
             |
      RPC 8545 / metrics 9545
      solo en loopback o red privada
```

- Un contenedor Besu por VM.
- El cliente Luna se instala en la VM; el contenedor monta `/usr/safenet/lunaclient` y
  `/etc/Chrystoki.conf`.
- El contenedor corre como root y recibe el GID de `hsmusers` con `group_add`, porque la
  libreria de Luna exige pertenencia a ese grupo.
- El plugin HSM se monta en `/opt/besu/plugins`.
- El PIN CO se guarda en `/opt/cadena/secrets/hsm-pin` con modo `0400`.
- RPC y metricas se publican en `127.0.0.1` o en la IP privada; el firewall limita el acceso.
- P2P `30303/tcp` solo entre las 4 VMs.

## Requisitos

En las 4 VMs:

- Ubuntu 22.04/24.04 o RHEL 9 / AlmaLinux 9 / Rocky Linux 9.
- Usuario con `sudo` sin password o password delegado a Ansible.
- Acceso SSH por clave.
- Paquete del **Luna Universal Client** (RPM o DEB) y conectividad al HSM.
- Particion Luna inicializada, etiqueta, slot y password del rol CO.
- Politicas de particion: `5` (secret key wrapping), `11` (changing key attributes) y
  `28` (Key Management Functions) habilitadas.

En el nodo de control (Linux o WSL2, no Windows nativo):

- `ansible-core` 2.16+.
- `openssl`, `jq`, `pkcs11-tool` (`opensc`) y Docker (para generar el genesis con Besu).
- Colecciones:

```bash
cd deploy/ansible
ansible-galaxy collection install -r requirements.yml
```

## Validacion local y CI

El job `deploy` de `.github/workflows/ci.yml` ejecuta:

- `yamllint` sobre `deploy/ansible/`.
- `ansible-playbook --syntax-check` con `inventory/hosts.example.yml`.
- Render de `tests/render.yml` para `docker-compose.yml`, script, variables y unidad systemd.
- `bash -n` y `shellcheck` sobre el script renderizado.
- `docker compose config` sobre el compose renderizado.
- Verificacion de que `P2P_SOURCES` usa las 4 IPs exactas y que `HOST_ALLOWLIST`
  contiene los 5 valores esperados.

Para reproducirlo localmente en Linux/WSL2:

```bash
cd deploy/ansible
ansible-galaxy collection install -r requirements.yml
ansible-playbook --syntax-check -i inventory/hosts.example.yml site.yml
ansible-playbook -i inventory/hosts.example.yml tests/render.yml \
  -e luna_hsmusers_gid=1001 -e render_dir=/tmp/cadena-render
bash -n /tmp/cadena-render/cadena-docker-firewall.sh
shellcheck /tmp/cadena-render/cadena-docker-firewall.sh
docker compose -f /tmp/cadena-render/docker-compose.yml config --quiet
```

## Fase 1: preparar la particion Luna

Crear la particion y las claves queda fuera de Ansible porque requiere el rol
Partition SO/Crypto Officer. Seguir la guia oficial:

- [Thales Luna con Besu](https://github.com/besu-eth/besu-hsm-plugin/blob/main/docs/thales-luna/README.md)

Resumen:

1. Inicializar la particion y cambiar el password CO.
2. Verificar las politicas `5`, `11` y `28`.
3. Crear 4 pares `secp256k1` con `pkcs11-tool`, etiquetas `cadena-validator1..4`,
   `CKA_SIGN=true`, `CKA_DERIVE=true`, `CKA_SENSITIVE=true`, `CKA_PRIVATE=true`.
4. Extraer las claves publicas para el genesis.

El script `scripts/bootstrap-hsm-network.sh` hace los pasos 3 y 4, y genera el genesis y el
permissioning:

```bash
cd deploy
export LUNA_TOKEN_LABEL=cadena-validators
export P2P_HOSTS=10.20.0.11,10.20.0.12,10.20.0.13,10.20.0.14
export ACCOUNTS_ALLOWLIST=0x1111111111111111111111111111111111111111
./scripts/bootstrap-hsm-network.sh
```

`P2P_HOSTS` debe ir en el mismo orden que las etiquetas `cadena-validator1..4`.
`ACCOUNTS_ALLOWLIST` es la lista de cuentas de aplicacion autorizadas; puede quedar vacia,
pero entonces ninguna cuenta podra enviar transacciones. Las direcciones pueden prefondearse
con `ALLOC_JSON`, por ejemplo:

```bash
export ALLOC_JSON='{"0x1111111111111111111111111111111111111111":{"balance":"0x21e19e0c9bab2400000"}}'
```

Salida en `deploy/artifacts/network/`:

- `genesis.json`
- `public_keys.json`
- `static-nodes.json`
- `permissions_config.toml`
- `qbftConfigFile.json`

No se genera ninguna clave privada de validador en software.

## Fase 2: generar PKI y JWT

Cada VM necesita un certificado TLS con su nombre e IP. El par JWT es compartido: la clave
privada queda en el emisor de tokens y solo la publica se copia a los validadores.

```bash
cd deploy
export VALIDATOR_HOSTS=validator1:10.20.0.11,validator2:10.20.0.12,validator3:10.20.0.13,validator4:10.20.0.14
export CADENA_DOMAIN=cadena.internal
./scripts/generate-pki.sh
```

Los nombres de `VALIDATOR_HOSTS` deben coincidir con los `inventory_hostname` del inventario,
porque Ansible busca `artifacts/pki/<host>/server.p12`.

Salida en `deploy/artifacts/pki/`:

- `ca.crt`, `ca.key`
- `jwt-public.pem`, `jwt-private.pem`
- `<host>/server.p12`, `<host>/keystore-password`, `<host>/server.crt`

No copies `ca.key` ni `jwt-private.pem` a los validadores.

## Fase 3: configurar Ansible

```bash
cd deploy/ansible
cp inventory/hosts.example.yml inventory/hosts.yml
cp group_vars/vault.example.yml group_vars/vault.yml
ansible-vault encrypt group_vars/vault.yml
```

Editar:

- `inventory/hosts.yml`: IPs, usuario SSH, `cadena_p2p_host`, `cadena_hsm_key_alias`.
- `group_vars/all.yml`:
  - `luna_client_local_package`: ruta del RPM/DEB en el nodo de control, o
    `luna_client_package_url`.
  - `luna_client_slot`: slot de la particion Luna.
  - `luna_client_token_label`.
  - CIDRs de administracion, RPC y metricas. Las IPs de P2P se derivan de
    `groups['validators']` y se aplican como `/32`; no se configuran a mano.
  - `besu_image` y `besu_hsm_plugin_version` solo si se cambia de version; actualizar
    tambien `besu_hsm_plugin_sha256`.
- `group_vars/vault.yml`: `vault_hsm_pin` con el password CO.

Probar conectividad y sintaxis:

```bash
ansible all -m ping
ansible-playbook --ask-vault-pass --syntax-check site.yml
```

Desplegar:

```bash
ansible-playbook --ask-vault-pass site.yml
```

## Fase 4: verificar

En cada VM:

```bash
docker compose -f /opt/cadena/besu/docker-compose.yml ps
docker compose -f /opt/cadena/besu/docker-compose.yml logs --tail=100
```

Ver altura y validadores desde el nodo de control con un tunel SSH:

```bash
ssh -L 8545:127.0.0.1:8545 cadena@10.20.0.11
```

En otra terminal:

```bash
cd deploy
CA_FILE="$PWD/artifacts/pki/ca.crt" \
JWT_PRIVATE_KEY_FILE="$PWD/artifacts/pki/jwt-private.pem" \
RPC_URL=https://localhost:8545 \
node ../network/tools/rpc.mjs eth_blockNumber

cd deploy
CA_FILE="$PWD/artifacts/pki/ca.crt" \
JWT_PRIVATE_KEY_FILE="$PWD/artifacts/pki/jwt-private.pem" \
RPC_URL=https://localhost:8545 \
node ../network/tools/rpc.mjs qbft_getValidatorsByBlockNumber latest
```

La lista de validadores debe contener las 4 direcciones derivadas de las claves de Luna.

## Operacion

### Actualizaciones

- Probar primero en staging.
- Actualizar una VM a la vez con `serial: 1` o `--limit validator1`.
- Mantener Besu y el plugin HSM en versiones compatibles.
- Si el plugin no soporta la nueva version de Besu, no actualizar.

### Backups

- Respaldar `genesis.json`, `permissions_config.toml`, `static-nodes.json`,
  `public_keys.json`, `ca.crt` y `jwt-public.pem`.
- Respaldar la particion Luna y su politica de backup/HA.
- Las claves privadas de validador nunca salen de la HSM; no hay keyfiles que respaldar.
- Respaldar snapshots de `/opt/cadena/data` de forma consistente.
- Probar restauracion antes de produccion.

### Firewall

- `30303/tcp` solo desde las IPs exactas de los 4 validadores (`/32`), no desde el `/24`.
- `8545/tcp` solo desde la red de aplicaciones o por tunel SSH.
- `9545/tcp` solo desde monitoreo.
- No exponer RPC a Internet.
- Docker publica puertos con reglas propias de iptables y puede saltarse UFW/firewalld. Por eso
  el rol `docker_firewall` crea la cadena `CADENA-FW`, la engancha al principio de
  `DOCKER-USER` y aplica allowlist/deny para `30303`, `8545` y `9545`.
- El firewall se ejecuta como servicio systemd `cadena-docker-firewall`; al reiniciar Docker,
  `PartOf=docker.service` lo vuelve a aplicar. No depende de `ufw-docker`.
- El script construye `CADENA-FW-tmp` y cambia el jump de `DOCKER-USER` solo cuando la
  cadena temporal ya tiene todas las reglas; asi no queda una ventana con el jump activo
  y la cadena vacia.
- Verificar en cada VM:

```bash
systemctl status cadena-docker-firewall --no-pager
iptables -S DOCKER-USER
iptables -S CADENA-FW
```

No confíes solo en la regla de UFW/firewalld del host: la cadena `DOCKER-USER` es la que
frena el tráfico publicado por Docker.

### HSM

- Si se pierde la sesion PKCS#11 (partition deactivate, firmware update, perdida total de
  HA), el validador debe reiniciarse.
- Configurar HA de Luna con `HAOnly=1` si se usa un HA group.
- El PIN CO debe rotarse con procedimiento y actualizarse en Vault + Ansible Vault.
- Auditar `lunacm`, `pkcs11-tool` y accesos al HSM con `auditd`.
- `pkcs11-tool` no permite fijar `CKA_EXTRACTABLE=false`; si la politica lo exige, generar
  las claves con una herramienta PKCS#11 que controle ese atributo.

## Fase 2 pendiente: Web3Signer + Vault + Luna

Web3Signer no puede abrir PKCS#11 directamente. La unica forma de mantener claves de
transaccion en Luna con Web3Signer es:

1. Vault Enterprise (o OpenBao) con `seal "pkcs11"` apuntando a Luna.
2. Claves de cuenta de aplicacion guardadas en Vault.
3. Web3Signer `eth1` con un key config de tipo `hashicorp`.

Vault Community no soporta `seal "pkcs11"`; en ese caso las alternativas son:

- Web3Signer con AWS KMS o Azure Key Vault para claves de transaccion.
- Web3Signer con keystores cifrados en disco (menos seguro).
- Un firmante PKCS#11 propio que implemente `eth_signTransaction`.

No se debe co-locar Vault en un validador: usar hosts de gestion dedicados. Esta fase no
esta implementada en este scaffold; requiere decidir licencia de Vault Enterprise/OpenBao y
los hosts de gestion.

## Limitaciones de este scaffold

- No incluye aprovisionamiento de VMs ni del HSM; asume infraestructura existente.
- No incluye un rol de Vault/Web3Signer porque falta decidir Enterprise vs OpenBao y hosts.
- No migra la cadena local a produccion. La red HSM arranca de genesis nuevo.
- El cliente Luna dentro del contenedor puede necesitar dependencias adicionales; validar
  con `docker logs` y `ldd` sobre la libreria.
- El plugin HSM se fija a `26.10.1`; validar compatibilidad antes de subir a `26.11.x`.

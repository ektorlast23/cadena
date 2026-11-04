[CmdletBinding()]
param(
    [string]$BesuImage = "hyperledger/besu:26.11.0"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$configDir = Join-Path $root "config"
$networkFiles = Join-Path $configDir "networkFiles"
$keysDir = Join-Path $configDir "keys"
$devDir = Join-Path $configDir "dev-account"
$permissionsDir = Join-Path $configDir "permissions"
$envFile = Join-Path $root ".env"
$dataDir = Join-Path $root "data"

function Fail([string]$Message) {
    throw $Message
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker no esta instalado o no esta en PATH."
}

$null = & docker info --format "{{.ServerVersion}}" 2>$null
if ($LASTEXITCODE -ne 0) {
    Fail "Docker no esta corriendo. Inicia Docker Desktop y reintenta."
}

if (Test-Path -LiteralPath $dataDir) {
    $dataItems = @(Get-ChildItem -LiteralPath $dataDir -Force -ErrorAction SilentlyContinue)
    if ($dataItems.Count -gt 0) {
        Fail "Ya hay datos de la red en $dataDir. Ejecuta scripts/down.ps1 -Reset antes de regenerar."
    }
}

New-Item -ItemType Directory -Force -Path $configDir, $permissionsDir | Out-Null

Write-Host "1/4 Generando cuenta de desarrollo ..."
if (Test-Path -LiteralPath $devDir) {
    Remove-Item -LiteralPath $devDir -Recurse -Force
}
New-Item -ItemType Directory -Path $devDir | Out-Null

$devKeyPath = Join-Path $devDir "key"
$devAddressPath = Join-Path $devDir "address"
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$address = $null

for ($attempt = 1; $attempt -le 3; $attempt++) {
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $keyHex = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    [System.IO.File]::WriteAllText($devKeyPath, $keyHex, (New-Object System.Text.ASCIIEncoding))

    if (Test-Path -LiteralPath $devAddressPath) {
        Remove-Item -LiteralPath $devAddressPath -Force
    }

    & docker run --rm --mount "type=bind,source=$devDir,target=/config/dev-account" $BesuImage public-key export-address --node-private-key-file=/config/dev-account/key --to=/config/dev-account/address 2>$null | Out-Null

    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $devAddressPath)) {
        $candidate = (Get-Content -LiteralPath $devAddressPath -Raw).Trim()
        if ($candidate -match '^0x[0-9a-fA-F]{40}$') {
            $address = $candidate.ToLowerInvariant()
            break
        }
    }
}

if (-not $address) {
    Fail "No se pudo derivar la direccion de la cuenta de desarrollo."
}

Write-Host "    Cuenta de desarrollo: $address"

Write-Host "2/4 Generando genesis y claves de los 4 validadores ..."
if (Test-Path -LiteralPath $networkFiles) {
    Remove-Item -LiteralPath $networkFiles -Recurse -Force
}

$configPath = Join-Path $configDir "qbftConfigFile.json"
$configJson = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$allocEntry = [pscustomobject]@{ balance = "0x21e19e0c9bab2400000" }
$configJson.genesis.alloc | Add-Member -NotePropertyName $address -NotePropertyValue $allocEntry -Force

$runtimeConfig = Join-Path $configDir "qbftConfigFile.runtime.json"
$runtimeJson = $configJson | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($runtimeConfig, $runtimeJson, (New-Object System.Text.UTF8Encoding($false)))

& docker run --rm --mount "type=bind,source=$configDir,target=/config" $BesuImage operator generate-blockchain-config --config-file=/config/qbftConfigFile.runtime.json --to=/config/networkFiles --private-key-file-name=key
$operatorExit = $LASTEXITCODE

$genesisPath = Join-Path $networkFiles "genesis.json"
$generatedKeysRoot = Join-Path $networkFiles "keys"
$generatedKeys = @()
if (Test-Path -LiteralPath $generatedKeysRoot) {
    $generatedKeys = @(Get-ChildItem -LiteralPath $generatedKeysRoot -Directory | Sort-Object Name)
}

if ($operatorExit -ne 0) {
    if ((Test-Path -LiteralPath $genesisPath) -and $generatedKeys.Count -eq 4) {
        Write-Warning "Besu devolvio codigo $operatorExit ('Output directory already exists') pero genero genesis y 4 claves; continuo."
    } else {
        Fail "Fallo el generador de Besu (codigo $operatorExit) y no genero artefactos completos."
    }
}

if (-not (Test-Path -LiteralPath $genesisPath)) {
    Fail "Besu no genero genesis.json."
}
if ($generatedKeys.Count -ne 4) {
    Fail "Se esperaban 4 validadores y se generaron $($generatedKeys.Count)."
}

$genesis = Get-Content -LiteralPath $genesisPath -Raw | ConvertFrom-Json
if ([int64]$genesis.config.chainId -ne 7331) {
    Fail "Chain ID inesperado en genesis: $($genesis.config.chainId)."
}
if (-not $genesis.config.qbft) {
    Fail "El genesis no tiene configuracion QBFT."
}

foreach ($keyDir in $generatedKeys) {
    $keyAddress = $keyDir.Name.ToLowerInvariant() -replace '^0x', ''
    if (-not $genesis.extraData.ToLowerInvariant().Contains($keyAddress)) {
        Fail "El validador $($keyDir.Name) no figura en extraData."
    }
}

$allocEntryFound = $genesis.alloc.PSObject.Properties | Where-Object { $_.Name -eq $address }
if (-not $allocEntryFound) {
    Fail "El genesis no prefondea la cuenta de desarrollo $address."
}

Copy-Item -LiteralPath $genesisPath -Destination (Join-Path $configDir "genesis.json") -Force

Write-Host "3/4 Preparando claves y enodes ..."
if (Test-Path -LiteralPath $keysDir) {
    Remove-Item -LiteralPath $keysDir -Recurse -Force
}
New-Item -ItemType Directory -Path $keysDir | Out-Null

$enodes = @()
for ($i = 0; $i -lt 4; $i++) {
    $nodeNumber = $i + 1
    $dest = Join-Path $keysDir ("key$nodeNumber")
    New-Item -ItemType Directory -Path $dest | Out-Null

    $sourceDir = $generatedKeys[$i].FullName
    Copy-Item -LiteralPath (Join-Path $sourceDir "key") -Destination (Join-Path $dest "key")
    Copy-Item -LiteralPath (Join-Path $sourceDir "key.pub") -Destination (Join-Path $dest "key.pub")

    $pub = (Get-Content -LiteralPath (Join-Path $dest "key.pub") -Raw).Trim()
    $pub = $pub -replace '^0[xX]', ''
    if ($pub.Length -ne 128) {
        Fail "Clave publica inesperada para key$nodeNumber."
    }

    $ip = "172.28.0.$($i + 11)"
    $enodes += "enode://$pub@${ip}:30303"
    Write-Host ("    key{0} -> validador {1} ({2})" -f $nodeNumber, $generatedKeys[$i].Name, $ip)
}

Write-Host "4/4 Escribiendo permissioning y .env ..."
$tomlLines = @(
    "accounts-allowlist = [`"$address`"]",
    "nodes-allowlist = ["
)
for ($i = 0; $i -lt 4; $i++) {
    $tomlLines += "  `"$($enodes[$i])`","
}
$tomlLines += "]"

$permissionsFile = Join-Path $permissionsDir "permissions_config.toml"
[System.IO.File]::WriteAllText($permissionsFile, (($tomlLines -join "`n") + "`n"), (New-Object System.Text.ASCIIEncoding))

$staticNodesFile = Join-Path $permissionsDir "static-nodes.json"
$staticNodesJson = $enodes | ConvertTo-Json
[System.IO.File]::WriteAllText($staticNodesFile, ($staticNodesJson + "`n"), (New-Object System.Text.ASCIIEncoding))

$envLines = @(
    "# Generado por scripts/generate.ps1 - no editar a mano",
    "BESU_IMAGE=$BesuImage"
)
[System.IO.File]::WriteAllText($envFile, (($envLines -join "`n") + "`n"), (New-Object System.Text.ASCIIEncoding))

if (Test-Path -LiteralPath $networkFiles) {
    Remove-Item -LiteralPath $networkFiles -Recurse -Force
}

Write-Host ""
Write-Host "Red generada."
Write-Host "  Genesis:            $configDir\genesis.json"
Write-Host "  Claves validadores: $keysDir"
Write-Host "  Cuenta desarrollo:  $devDir"
Write-Host "  Direccion:          $address"
Write-Host ""
Write-Host "Respalda config/keys y config/dev-account: sin ellas no podes reiniciar la red."
Write-Host "Siguiente paso: .\scripts\up.ps1"

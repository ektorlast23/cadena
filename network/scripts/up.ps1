[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$root = Split-Path -Parent $PSScriptRoot
$required = @(
    (Join-Path $root ".env"),
    (Join-Path $root "config/genesis.json"),
    (Join-Path $root "config/permissions/permissions_config.toml"),
    (Join-Path $root "config/permissions/static-nodes.json"),
    (Join-Path $root "config/keys/key1/key")
)

foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Falta $path. Ejecuta primero scripts/generate.ps1."
    }
}

Push-Location $root
try {
    & docker compose up -d
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose up fallo (codigo $LASTEXITCODE)."
    }

    Write-Host "Esperando el primer bloque ..."
    $rpc = "http://127.0.0.1:8545"
    $deadline = (Get-Date).AddSeconds(90)
    $block = 0

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        try {
            $body = '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
            $resp = Invoke-RestMethod -Uri $rpc -Method Post -ContentType "application/json" -Body $body -TimeoutSec 3
            $block = [Convert]::ToInt64($resp.result.Substring(2), 16)
            if ($block -gt 0) {
                break
            }
        } catch {
        }
    }

    if ($block -le 0) {
        & docker compose logs --tail=80
        throw "La red no produjo bloques en 90 segundos."
    }

    Write-Host "Red arriba. Altura actual: $block"
    & docker compose ps
} finally {
    Pop-Location
}

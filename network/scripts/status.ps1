[CmdletBinding()]
param(
    [string]$RpcUrl = "http://127.0.0.1:8545"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Rpc {
    param(
        [string]$Method,
        [object[]]$Params = @()
    )

    $payload = @{
        jsonrpc = "2.0"
        id      = 1
        method  = $Method
        params  = $Params
    } | ConvertTo-Json -Compress -Depth 10

    $resp = Invoke-RestMethod -Uri $RpcUrl -Method Post -ContentType "application/json" -Body $payload -TimeoutSec 5
    if ($resp.error) {
        throw "$Method -> $($resp.error.message)"
    }
    return $resp.result
}

function From-Hex([string]$Value) {
    if ($Value -like "0x*") {
        return [Convert]::ToInt64($Value.Substring(2), 16)
    }
    return [int64]$Value
}

try {
    $chainId = From-Hex (Invoke-Rpc "eth_chainId")
    $block = From-Hex (Invoke-Rpc "eth_blockNumber")
    $peers = From-Hex (Invoke-Rpc "net_peerCount")
    $gasPrice = From-Hex (Invoke-Rpc "eth_gasPrice")
    $validators = @(Invoke-Rpc "qbft_getValidatorsByBlockNumber" @("latest"))

    Write-Host ""
    Write-Host "Cadena:      $chainId"
    Write-Host "Altura:      $block"
    Write-Host "Pares:       $peers"
    Write-Host "Gas price:   $gasPrice wei"
    Write-Host "Validadores:"
    foreach ($validator in $validators) {
        Write-Host "  - $validator"
    }
    Write-Host ""
} catch {
    Write-Host "No se pudo consultar $RpcUrl : $($_.Exception.Message)"
    exit 1
}

Push-Location $root
try {
    & docker compose ps
} finally {
    Pop-Location
}

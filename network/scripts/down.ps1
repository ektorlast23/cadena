[CmdletBinding()]
param(
    [switch]$Reset
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
    & docker compose down --remove-orphans
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose down fallo (codigo $LASTEXITCODE)."
    }

    if ($Reset) {
        $dataDir = Join-Path $root "data"
        if (Test-Path -LiteralPath $dataDir) {
            Remove-Item -LiteralPath $dataDir -Recurse -Force
            Write-Host "Datos de la red eliminados."
        } else {
            Write-Host "No habia datos para eliminar."
        }
    }
} finally {
    Pop-Location
}

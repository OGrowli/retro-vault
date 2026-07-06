#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot

Set-Location $RootDir

# Free port 3000 if held by a previous run
$existing = try { Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop } catch { $null }
if ($existing) {
    $pid3000 = $existing.OwningProcess | Select-Object -First 1
    Write-Host "Killing stale process on port 3000 (PID: $pid3000)..." -ForegroundColor Yellow
    Stop-Process -Id $pid3000 -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

# -- 1. Seed --
Write-Host "==> Seeding test database..." -ForegroundColor Cyan
& npm run seed
if ($LASTEXITCODE -ne 0) { throw "Seed script failed (exit $LASTEXITCODE)" }

# -- 2. API --
Write-Host ""
Write-Host "==> Starting API (port 3000)..." -ForegroundColor Cyan

$apiJob = Start-Job -ScriptBlock {
    Set-Location $using:RootDir
    & npm run dev:api
}

# -- 3. Wait for API --
Write-Host "==> Waiting for API..."
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    try {
        Invoke-WebRequest -Uri 'http://localhost:3000/meta/systems' -UseBasicParsing -ErrorAction Stop | Out-Null
        $ready = $true
        Write-Host "    API ready." -ForegroundColor Green
        break
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
if (-not $ready) {
    Write-Warning "API did not respond in time - web will start anyway"
}

# -- 4. Web --
Write-Host ""
Write-Host "==> Starting web dev server (port 5173)..." -ForegroundColor Cyan

$webJob = Start-Job -ScriptBlock {
    Set-Location $using:RootDir
    & npm run dev:web
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Yellow
Write-Host "  RetroVault dev environment running"       -ForegroundColor Yellow
Write-Host "  API:  http://localhost:3000"              -ForegroundColor White
Write-Host "  Web:  http://localhost:5173"              -ForegroundColor White
Write-Host "  Ctrl+C to stop both servers"              -ForegroundColor White
Write-Host "==========================================" -ForegroundColor Yellow
Write-Host ""

# -- 5. Keep alive + cleanup --
try {
    while ($true) {
        $apiState = Get-Job -Id $apiJob.Id | Select-Object -ExpandProperty State
        $webState = Get-Job -Id $webJob.Id | Select-Object -ExpandProperty State

        if ($apiState -ne "Running") {
            Write-Warning "API job exited (state: $apiState)"
            break
        }
        if ($webState -ne "Running") {
            Write-Warning "Web job exited (state: $webState)"
            break
        }
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host ""
    Write-Host "Shutting down..." -ForegroundColor Cyan

    Stop-Job -Job $apiJob -ErrorAction SilentlyContinue
    Stop-Job -Job $webJob -ErrorAction SilentlyContinue

    Remove-Job -Job $apiJob -Force -ErrorAction SilentlyContinue
    Remove-Job -Job $webJob -Force -ErrorAction SilentlyContinue

    Write-Host "Done." -ForegroundColor Green
}

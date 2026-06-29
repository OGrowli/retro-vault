#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
$TestDataDir = "$env:TEMP\retrovault-test"
$TestDb = "$TestDataDir\retrovault.db"

$env:RETROVAULT_DATA_DIR = $TestDataDir
$env:RETROVAULT_DB_PATH  = $TestDb

Set-Location $RootDir

function Stop-Tree {
    param([int]$Pid)
    & taskkill /T /F /PID $Pid | Out-Null
}

# ── 1. Seed ───────────────────────────────────────────────────────────────────
Write-Host "==> Seeding test database at $TestDb..." -ForegroundColor Cyan
& npx tsx packages/api/src/seed.ts
if ($LASTEXITCODE -ne 0) { throw "Seed script failed (exit $LASTEXITCODE)" }

# ── 2. API ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==> Starting API (port 3000)..." -ForegroundColor Cyan

$apiCmd = "set RETROVAULT_DATA_DIR=$TestDataDir && set RETROVAULT_DB_PATH=$TestDb && npx tsx packages/api/src/index.ts"
$apiParams = @{
    FilePath     = 'cmd.exe'
    ArgumentList = '/c', $apiCmd
    NoNewWindow  = $true
    PassThru     = $true
}
$apiProc = Start-Process @apiParams

# ── 3. Wait for API ───────────────────────────────────────────────────────────
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
    Write-Warning "API did not respond in time — web will start anyway"
}

# ── 4. Web ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==> Starting web dev server (port 5173)..." -ForegroundColor Cyan

$webParams = @{
    FilePath     = 'cmd.exe'
    ArgumentList = '/c', 'npm run dev -w packages/web'
    NoNewWindow  = $true
    PassThru     = $true
}
$webProc = Start-Process @webParams

Write-Host ""
Write-Host "==========================================" -ForegroundColor Yellow
Write-Host "  RetroVault dev environment running"       -ForegroundColor Yellow
Write-Host "  API:  http://localhost:3000"              -ForegroundColor White
Write-Host "  Web:  http://localhost:5173"              -ForegroundColor White
Write-Host "  DB:   $TestDb"                            -ForegroundColor White
Write-Host "  Ctrl+C to stop both servers"              -ForegroundColor White
Write-Host "==========================================" -ForegroundColor Yellow
Write-Host ""

# ── 5. Keep alive + cleanup ───────────────────────────────────────────────────
try {
    while (-not $apiProc.HasExited -and -not $webProc.HasExited) {
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host ""
    Write-Host "Shutting down..." -ForegroundColor Cyan
    Stop-Tree $apiProc.Id
    Stop-Tree $webProc.Id
    Write-Host "Done." -ForegroundColor Green
}

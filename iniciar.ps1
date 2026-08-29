#Requires -Version 5.1
<#
.SYNOPSIS
  Cerebro de Agentes — Levanta todo el entorno correctamente (PowerShell, más robusto que .bat)
.DESCRIPTION
  Checks, pnpm install, playwright, .env, DB, y levanta Orquestador (3001) + Web (3000) en ventanas separadas.
  Uso: powershell -ExecutionPolicy Bypass -File .\iniciar.ps1
       o click derecho → Ejecutar con PowerShell
#>
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = Get-Location }
Set-Location -LiteralPath $Root
Write-Host "Cerebro Root: $Root" -ForegroundColor Cyan

Write-Host ""
Write-Host "==============================================" -ForegroundColor White
Write-Host " Cerebro de Agentes — Iniciando entorno (PS)" -ForegroundColor White
Write-Host "==============================================" -ForegroundColor White
Write-Host ""

function Test-Command($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

# 1. Node
Write-Host "[1/7] Verificando Node..." -ForegroundColor Yellow
if (-not (Test-Command node)) { Write-Host "[ERROR] Node no encontrado" -ForegroundColor Red; pause; exit 1 }
Write-Host "  Node $(node --version) OK" -ForegroundColor Green

# 2. pnpm
Write-Host "[2/7] Verificando pnpm..." -ForegroundColor Yellow
if (-not (Test-Command pnpm)) {
  Write-Host "  pnpm no encontrado, habilitando via corepack..." -ForegroundColor Yellow
  corepack enable pnpm
}
Write-Host "  pnpm $(pnpm --version) OK" -ForegroundColor Green

# 3. Git
Write-Host "[3/7] Verificando Git..." -ForegroundColor Yellow
if (Test-Command git) { Write-Host "  $(git --version) OK" -ForegroundColor Green } else { Write-Host "  [WARN] Git no encontrado — worktrees usarán mkdir" -ForegroundColor Yellow }

# 4. Playwright
Write-Host "[4/7] Verificando Playwright..." -ForegroundColor Yellow
$pwPath = "$env:LOCALAPPDATA\ms-playwright"
if (Test-Path $pwPath) { Write-Host "  Playwright OK en $pwPath" -ForegroundColor Green } else { Write-Host "  Playwright no encontrado — se instalará" -ForegroundColor Yellow }

# 5. Qwen profile
Write-Host "[5/7] Verificando Qwen profile..." -ForegroundColor Yellow
$qwenDir = "$env:LOCALAPPDATA\CerebroQwen\user-data"
if (-not (Test-Path $qwenDir)) {
  New-Item -ItemType Directory -Path $qwenDir -Force | Out-Null
  Write-Host "  Creado $qwenDir" -ForegroundColor Green
} else {
  Write-Host "  Qwen profile OK en $qwenDir" -ForegroundColor Green
}
if (-not (Test-Path "$qwenDir\Default") -and -not (Test-Path "$qwenDir\Preferences")) {
  Write-Host "  [INFO] Primera vez: ejecuta pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful" -ForegroundColor Yellow
}

# 6. .env
Write-Host "[6/7] Verificando .env..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    Write-Host "  Creado .env desde .env.example — edita DATABASE_URL si usas Neon/PG (vacío = pglite)" -ForegroundColor Yellow
  }
} else { Write-Host "  .env OK" -ForegroundColor Green }

# 7. node_modules
Write-Host "[7/7] Verificando node_modules..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
  Write-Host "  Instalando deps (pnpm install)..." -ForegroundColor Yellow
  pnpm install
  if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] pnpm install falló" -ForegroundColor Red; pause; exit 1 }
} else { Write-Host "  node_modules OK" -ForegroundColor Green }

# Playwright install si falta
Write-Host "Verificando Chromium..." -ForegroundColor Yellow
pnpm --filter @cerebro/orchestrator exec playwright install chromium 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "  [WARN] playwright install pudo fallar (puede ya estar)" -ForegroundColor Yellow } else { Write-Host "  Chromium OK" -ForegroundColor Green }

# DB: docker compose si DATABASE_URL es local
$envContent = Get-Content ".env" -ErrorAction SilentlyContinue | Out-String
if ($envContent -match "DATABASE_URL=postgresql://cerebro:cerebro@localhost") {
  if (Test-Command docker) {
    Write-Host "[DB] Levantando PostgreSQL via docker compose..." -ForegroundColor Yellow
    docker compose up -d db
  } else {
    Write-Host "[DB] Docker no encontrado — usando pglite" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor White
Write-Host " Levantando Orquestador (3001) y Web (3000)" -ForegroundColor White
Write-Host "==============================================" -ForegroundColor White
Write-Host ""

Write-Host "[Cerebro] Iniciando Orquestador en http://localhost:3001 ..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "cd /d `"$Root`" && pnpm --filter @cerebro/orchestrator dev" -WindowStyle Normal

Write-Host "[Cerebro] Iniciando Web en http://localhost:3000 ..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "cd /d `"$Root`" && pnpm --filter @cerebro/web dev" -WindowStyle Normal

Write-Host ""
Write-Host "Esperando 6s..." -ForegroundColor Yellow
Start-Sleep -Seconds 6

Write-Host ""
Write-Host "Comprobando salud..." -ForegroundColor Yellow
try {
  $r = Invoke-WebRequest -Uri http://localhost:3001/health -TimeoutSec 5 -UseBasicParsing
  Write-Host "  Orquestador: $($r.StatusCode) OK http://localhost:3001/health" -ForegroundColor Green
} catch { Write-Host "  Orquestador: aún iniciando... ($_.Exception.Message)" -ForegroundColor Yellow }
try {
  $r = Invoke-WebRequest -Uri http://localhost:3000 -TimeoutSec 5 -UseBasicParsing
  Write-Host "  Web: $($r.StatusCode) OK http://localhost:3000" -ForegroundColor Green
} catch { Write-Host "  Web: aún iniciando..." -ForegroundColor Yellow }

Write-Host ""
Write-Host "==============================================" -ForegroundColor White
Write-Host " Listo!" -ForegroundColor Green
Write-Host "   Web Chat Misiones: http://localhost:3000" -ForegroundColor White
Write-Host "   Qwen Chat:         http://localhost:3000/qwen-chat  (FASE 6b)" -ForegroundColor White
Write-Host "   Dashboard Kanban:  http://localhost:3000/dashboard" -ForegroundColor White
Write-Host "   Orquestador:       http://localhost:3001/health" -ForegroundColor White
Write-Host "==============================================" -ForegroundColor White
Write-Host ""
Write-Host "Para detener: cierra las dos ventanas CMD." -ForegroundColor Yellow
Write-Host "Para Qwen login: pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful" -ForegroundColor Yellow
Write-Host ""

# Abrir navegador
Start-Process "http://localhost:3000"

Write-Host "Presiona Enter para salir (las ventanas seguirán abiertas)..." -ForegroundColor Gray
Read-Host

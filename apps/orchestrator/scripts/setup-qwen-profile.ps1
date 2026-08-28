# setup-qwen-profile.ps1 — Prepara perfil persistente Qwen Chat QwenMax-3.8
# Uso: powershell -ExecutionPolicy Bypass -File scripts/setup-qwen-profile.ps1
# Luego: pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful

$ErrorActionPreference = "Stop"

$profileDir = "$env:LOCALAPPDATA\CerebroQwen\user-data"
Write-Host "Qwen Playwright profile dir: $profileDir" -ForegroundColor Cyan

if (-not (Test-Path $profileDir)) {
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  Write-Host "Directorio creado" -ForegroundColor Green
}

Write-Host "Instalando Chromium (si falta)..." -ForegroundColor Cyan
pnpm --filter @cerebro/orchestrator exec playwright install chromium

Write-Host ""
Write-Host "Perfil listo en: $profileDir" -ForegroundColor Green
Write-Host "Siguiente paso:" -ForegroundColor Yellow
Write-Host "  1. Ejecuta: pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful"
Write-Host "     Se abrirá Chromium con chat.qwen.ai — inicia sesión con GitHub y selecciona QwenMax-3.8"
Write-Host "  2. Verifica: RUN_REAL_QWEN=1 pnpm test -- -t 'Qwen'"
Write-Host "  3. Para uso normal, el bridge usa headless:true automáticamente"

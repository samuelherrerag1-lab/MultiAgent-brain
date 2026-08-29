@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Cerebro de Agentes — Iniciando...

:: ============================================================
:: Cerebro de Agentes — Levanta todo el entorno correctamente
:: - Checks: Node, pnpm, Git, Ollama, Playwright, Qwen profile
:: - pnpm install, playwright install, .env, DB, Orquestador + Web
:: Ubicación: C:\Users\USUARIO\Documents\Samuel\Cerebro de Agentes
:: Uso: doble click o .\iniciar.bat
:: ============================================================

set "ROOT=%~dp0"
:: Quitar barra final si existe
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
echo [Cerebro] Root: %ROOT%
cd /d "%ROOT%"

echo.
echo ==============================================
echo  Cerebro de Agentes — Iniciando entorno
echo ==============================================
echo.

:: ---------- Checks ----------
echo [1/7] Verificando Node...
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node no encontrado. Instala Node 22 LTS.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo   Node %%v OK

echo [2/7] Verificando pnpm...
where pnpm >nul 2>&1
if errorlevel 1 (
  echo [WARN] pnpm no encontrado, habilitando via corepack...
  call corepack enable pnpm
)
for /f "tokens=*" %%v in ('pnpm --version 2^>nul') do echo   pnpm %%v OK

echo [3/7] Verificando Git...
where git >nul 2>&1
if errorlevel 1 echo   [WARN] Git no encontrado (worktrees usarán fallback mkdir)
for /f "tokens=*" %%v in ('git --version 2^>nul') do echo   %%v OK

echo [4/7] Verificando Playwright...
if not exist "%LOCALAPPDATA%\ms-playwright" (
  echo   Playwright no encontrado, se instalará con pnpm...
) else (
  echo   Playwright OK en %LOCALAPPDATA%\ms-playwright
)

echo [5/7] Verificando Qwen profile...
set "QWEN_DIR=%LOCALAPPDATA%\CerebroQwen\user-data"
if not exist "%QWEN_DIR%" (
  echo   Creando %QWEN_DIR%...
  mkdir "%QWEN_DIR%" 2>nul
) else (
  echo   Qwen profile OK en %QWEN_DIR%
)
if not exist "%QWEN_DIR%\Default" (
  echo   [INFO] Primera vez: ejecuta pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful para login GitHub
)

echo [6/7] Verificando .env...
if not exist ".env" (
  if exist ".env.example" (
    echo   Creando .env desde .env.example...
    copy /y ".env.example" ".env" >nul
    echo   [ACCION] Edita .env con DATABASE_URL si usas Neon/PG (vacío = pglite)
  ) else (
    echo   [WARN] .env.example no encontrado
  )
) else (
  echo   .env OK
)

echo [7/7] Verificando node_modules...
if not exist "node_modules" (
  echo   Instalando deps (pnpm install)...
  call pnpm install
  if errorlevel 1 (
    echo [ERROR] pnpm install falló
    pause
    exit /b 1
  )
) else (
  echo   node_modules OK
)

:: Playwright Chromium si falta
pnpm --filter @cerebro/orchestrator exec playwright install chromium >nul 2>&1
if errorlevel 1 echo [WARN] playwright install chromium falló (puede ya estar instalado)

:: DB: Docker compose si disponible y DATABASE_URL es local
findstr /R "DATABASE_URL=postgresql://cerebro:cerebro@localhost" .env >nul 2>&1
if %errorlevel%==0 (
  where docker >nul 2>&1
  if not errorlevel 1 (
    echo [DB] Levantando PostgreSQL via docker compose...
    docker compose up -d db
  ) else (
    echo [DB] Docker no encontrado — usando pglite (DATABASE_URL vacío o Neon)
  )
)

echo.
echo ==============================================
echo  Levantando Orquestador (3001) y Web (3000)
echo ==============================================
echo.

:: Matar procesos previos en esos puertos (opcional)
:: Cerramos solo si el usuario quiere — no forzamos

echo [Cerebro] Iniciando Orquestador en http://localhost:3001 ...
start "Cerebro Orquestador — Hono 3001" cmd /k "cd /d "%ROOT%" && pnpm --filter @cerebro/orchestrator dev"

echo [Cerebro] Iniciando Web en http://localhost:3000 ...
start "Cerebro Web — Next 3000" cmd /k "cd /d "%ROOT%" && pnpm --filter @cerebro/web dev"

echo.
echo Esperando 6s para que ambos levanten...
timeout /t 6 /nobreak >nul

echo.
echo Comprobando salud...
powershell -Command "try { $r=Invoke-WebRequest -Uri http://localhost:3001/health -TimeoutSec 5; Write-Host \"  Orquestador: $($r.StatusCode) OK\" -ForegroundColor Green } catch { Write-Host \"  Orquestador: aún iniciando... ($_)\" -ForegroundColor Yellow }"
powershell -Command "try { $r=Invoke-WebRequest -Uri http://localhost:3000 -TimeoutSec 5; Write-Host \"  Web: $($r.StatusCode) OK\" -ForegroundColor Green } catch { Write-Host \"  Web: aún iniciando...\" -ForegroundColor Yellow }"

echo.
echo ==============================================
echo  Listo!
echo    Web Chat Misiones: http://localhost:3000
echo    Qwen Chat:         http://localhost:3000/qwen-chat  (FASE 6b pendiente de implementar)
echo    Dashboard Kanban:  http://localhost:3000/dashboard
echo    Orquestador:       http://localhost:3001/health
echo ==============================================
echo.
echo Para detener: cierra las dos ventanas CMD abiertas.
echo Para Qwen login: pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful
echo.
:: Abrir navegador
start "" "http://localhost:3000"

pause
endlocal

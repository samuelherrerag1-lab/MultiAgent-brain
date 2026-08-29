@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Cerebro de Agentes - Iniciando...

REM ============================================================
REM Cerebro de Agentes - Levanta todo el entorno correctamente
REM - Checks: Node, pnpm, Git, Playwright, Qwen profile, env
REM - Orquestador en puerto 3001 y Web en puerto 3000
REM ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo.
echo ==============================================
echo  Cerebro de Agentes - Iniciando entorno
echo ==============================================
echo.

REM ---------- Checks ----------
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
if errorlevel 1 where pnpm.cmd >nul 2>&1
if errorlevel 1 (
  echo [WARN] pnpm no encontrado, habilitando via corepack...
  call corepack enable pnpm
)
for /f "tokens=*" %%v in ('pnpm --version 2^>nul') do echo   pnpm %%v OK

echo [3/7] Verificando Git...
where git >nul 2>&1
if errorlevel 1 (
  echo   [WARN] Git no encontrado - worktrees usaran fallback mkdir
) else (
  for /f "tokens=*" %%v in ('git --version 2^>nul') do echo   %%v OK
)

echo [4/7] Verificando Playwright...
if not exist "%LOCALAPPDATA%\ms-playwright" (
  echo   Playwright no encontrado, se instalara con pnpm...
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
  echo   [INFO] Primera vez: ejecuta pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful
)

echo [6/7] Verificando .env...
if not exist ".env" (
  if exist ".env.example" (
    echo   Creando .env desde .env.example...
    copy /y ".env.example" ".env" >nul
    echo   [ACCION] Edita .env con DATABASE_URL si usas Neon/PG [vacio = pglite]
  ) else (
    echo   [WARN] .env.example no encontrado
  )
) else (
  echo   .env OK
)

echo [7/7] Verificando node_modules...
if not exist "node_modules" (
  echo   Instalando dependencias [pnpm install]...
  call pnpm install
  if errorlevel 1 (
    echo [ERROR] pnpm install fallo
    pause
    exit /b 1
  )
) else (
  echo   node_modules OK
)

REM Playwright Chromium
call pnpm --filter "@cerebro/orchestrator" exec playwright install chromium >nul 2>&1
if errorlevel 1 echo [WARN] playwright install chromium pudo fallar [puede ya estar instalado]

REM DB Docker si DATABASE_URL local (cualquier PG en localhost)
findstr /R "DATABASE_URL=.*localhost" .env >nul 2>&1
if not errorlevel 1 (
  where docker >nul 2>&1
  if not errorlevel 1 (
    echo [DB] Levantando PostgreSQL via docker compose...
    call docker compose up -d db
  ) else (
    echo [DB] Docker no encontrado - usando pglite
  )
)

echo.
echo ==============================================
echo  Levantando Orquestador en 3001 y Web en 3000
echo ==============================================
echo.

echo [Cerebro] Limpiando procesos previos en puertos 3000 y 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":3001.*LISTENING"') do (
  echo   Liberando puerto 3001 [PID %%a]...
  taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":3000.*LISTENING"') do (
  echo   Liberando puerto 3000 [PID %%a]...
  taskkill /F /PID %%a >nul 2>&1
)

echo [Cerebro] Iniciando Orquestador en http://localhost:3001 ...
start "Cerebro-Orquestador" /D "%ROOT%" cmd /k "pnpm --filter @cerebro/orchestrator dev"

echo [Cerebro] Iniciando Web en http://localhost:3000 ...
start "Cerebro-Web" /D "%ROOT%" cmd /k "pnpm --filter @cerebro/web dev"

echo.
echo Esperando servicios (hasta 30s)...
for /L %%i in (1,1,15) do (
  timeout /t 2 /nobreak >nul
  powershell -Command "try { $r=Invoke-WebRequest -Uri http://localhost:3001/health -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200){ Write-Host '  Orquestador: 200 OK' -ForegroundColor Green; exit 0 } } catch {}" >nul 2>&1
  if not errorlevel 1 goto :health_web
)
:health_web
for /L %%i in (1,1,15) do (
  timeout /t 2 /nobreak >nul
  powershell -Command "try { $r=Invoke-WebRequest -Uri http://localhost:3000 -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200){ Write-Host '  Web: 200 OK' -ForegroundColor Green; exit 0 } } catch {}" >nul 2>&1
  if not errorlevel 1 goto :health_done
)
:health_done
echo Comprobando salud final...
powershell -Command "try { $r=Invoke-WebRequest -Uri http://localhost:3001/health -TimeoutSec 5 -UseBasicParsing; Write-Host '  Orquestador: ' + $r.StatusCode + ' OK' -ForegroundColor Green } catch { Write-Host '  Orquestador: iniciando...' -ForegroundColor Yellow }"
powershell -Command "try { $r=Invoke-WebRequest -Uri http://localhost:3000 -TimeoutSec 5 -UseBasicParsing; Write-Host '  Web: ' + $r.StatusCode + ' OK' -ForegroundColor Green } catch { Write-Host '  Web: iniciando...' -ForegroundColor Yellow }"

echo.
echo ==============================================
echo  Listo!
echo    Web Chat Misiones: http://localhost:3000
echo    Qwen Chat:         http://localhost:3000/qwen-chat
echo    Dashboard Kanban:  http://localhost:3000/dashboard
echo    Orquestador:       http://localhost:3001/health
echo ==============================================
echo.
echo Para detener: cierra las dos ventanas CMD abiertas.
echo Para Qwen login: pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful
echo.
powershell -Command "Start-Process 'http://localhost:3000'" >nul 2>&1
if errorlevel 1 explorer "http://localhost:3000" >nul 2>&1

pause
endlocal

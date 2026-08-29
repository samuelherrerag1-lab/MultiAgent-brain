# Setup y Ejecución — Cerebro de Agentes

> Guía escalable para levantar todo el entorno correctamente. Ver `iniciar.bat` / `iniciar.ps1` para automatización.

## Requisitos

- **Node** `^22.19` (probado 22.20), **pnpm** `11.24` (`corepack enable pnpm`)
- **Git** 2.55+, **Ollama** (opcional, para Opencode local), **Playwright Chromium** (instalado vía `pnpm`)
- **PostgreSQL 16 + pgvector** opcional — sin Docker usa **pglite** (auto, cero config)

## 1. Instalación

```ps
# Desde la raíz del proyecto (con comillas por el espacio)
Set-Location -LiteralPath "C:\Users\USUARIO\Documents\Samuel\Cerebro de Agentes"

# Instalar deps (monorepo pnpm + turbo)
pnpm install

# Playwright (ya incluido en pnpm-lock, solo descargar binarios)
pnpm --filter @cerebro/orchestrator exec playwright install chromium

# Opcional: verificar binarios
pnpm exec tsc --version
opencode --version  # 1.18.23
ollama list         # qwen2.5-coder:7b, qwen3:4b, etc.
```

## 2. Configuración `.env`

```ps
Copy-Item .env.example .env
# Edita .env — mínimo:
# PORT=3001
# DATABASE_URL=  (vacío → pglite memory, OK para dev)
# DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/cerebro?sslmode=require  (Neon remoto)
# DATABASE_URL=postgresql://cerebro:cerebro@localhost:5432/cerebro  (Docker)
# NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:3001
# OPENCODE_API_KEY=sk-... (opencode-zen, opcional)
# OPENROUTER_API_KEY=sk-or-v1-... (opcional)
# QWEN_USER_DATA_DIR=C:\Users\USUARIO\AppData\Local\CerebroQwen\user-data
```

Si `DATABASE_URL` vacío o `memory://`, el orquestador usa **pglite** y crea tablas automáticamente (sin `drizzle-kit migrate`).

Con PG real:
```ps
psql $env:DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
pnpm --filter @cerebro/orchestrator db:generate
pnpm --filter @cerebro/orchestrator db:migrate
```

## 3. Qwen Chat — sesión persistente (QwenMax-3.8)

Ya tienes sesión iniciada con GitHub en la app Qwen. Para que Playwright la reutilice:

```ps
# Opción A — automática (recomendada, abre ventana headful para login)
pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful
# → Loguéate con GitHub en la ventana Chromium, selecciona QwenMax-3.8, envía "hola", cierra

# Opción B — manual via bat
.\iniciar.ps1  # ofrece menú para abrir perfil Qwen
```

Perfil en `%LOCALAPPDATA%\CerebroQwen\user-data` (fuera del repo, no se commitea). Verifica:
```ps
RUN_REAL_QWEN=1 pnpm test -- -t "Qwen"
```

Si ves `QWEN_LOGIN_REQUIRED`, repite el paso headful o usa el botón **Iniciar sesión Qwen** en `/qwen-chat`.

## 4. Ejecución — todo el sistema

### Opción A — Script automático (recomendado)

```ps
# Doble click o:
.\iniciar.bat        # CMD — abre 2 ventanas (Orquestador + Web)
.\iniciar.ps1        # PowerShell — más robusto, con checks
```

Hace:
1. Checks `node`/`pnpm`/`git`/`ollama`/`playwright`
2. `pnpm install` si falta `node_modules`
3. Crea `.env` desde `.env.example` si no existe
4. `playwright install chromium` si falta `ms-playwright`
5. Crea `%LOCALAPPDATA%\CerebroQwen\user-data` si no existe
6. `docker compose up -d db` si Docker disponible y `DATABASE_URL` es local
7. `start "Cerebro Orquestador" cmd /k pnpm --filter @cerebro/orchestrator dev` (3001)
8. `start "Cerebro Web" cmd /k pnpm --filter @cerebro/web dev` (3000)
9. Espera 5s y abre `http://localhost:3000` y `http://localhost:3001/health`

Para detener: cierra las dos ventanas CMD o `Ctrl+C`.

### Opción B — Turbo (una sola ventana, logs intercalados)

```ps
pnpm dev  # turbo run dev — orquestador + web en paralelo (persistent)
```

### Opción C — Manual por separado

```ps
# Terminal 1
pnpm --filter @cerebro/orchestrator dev
# → http://localhost:3001/health

# Terminal 2
pnpm --filter @cerebro/web dev
# → http://localhost:3000 (Chat Misiones) y http://localhost:3000/qwen-chat y /dashboard
```

## 5. Verificación

```ps
pnpm run typecheck   # 3 paquetes
pnpm test            # 73 passed +5 skipped (2 reales skip sin RUN_REAL_*)
RUN_REAL_QWEN=1 pnpm test -- -t "Qwen"          # Qwen Chat real (requiere sesión)
RUN_REAL_TESTS=1 pnpm test -- -t "Opencode"     # Opencode real (requiere ollama)
```

## 6. Estructura de arranque

```
iniciar.bat / iniciar.ps1
  ├─ checks (node, pnpm, git, playwright, qwen-profile, .env)
  ├─ pnpm install (si falta)
  ├─ docker compose up -d db (opcional)
  └─ start Orquestador (3001) + Web (3000) → http://localhost:3000
```

Ver `docs/qwen-chat.md` para detalles del asistente escalable y `docs/architecture.md` para flujo Turn.

# AGENTS.md — Cerebro de Agentes

Instrucciones para agentes (humanos, DSH, Opencode, Qwen) que trabajen en este repo.

## Proyecto

Orquestador multi-agente Hono + Next.js + PostgreSQL/pgvector. Monorepo `pnpm + Turborepo`, `Node 22`, `TypeScript 6 strict`. Ver `README.md` y `docs/architecture.md`.

## Estructura

```
packages/shared/src/protocols.ts  # Zod Mission/MissionReport — única verdad
apps/orchestrator/src/            # Hono Líder: bridges/, adapters/, router/, governance/, db/
apps/web/                         # Next.js 15 App Router
tooling/tsconfig/base.json        # base TS strict
docs/                             # 8 docs del plan
```

## Comandos

```ps
# Levantar todo (recomendado)
.\iniciar.bat          # CMD — 2 ventanas (3001 + 3000)
.\iniciar.ps1          # PowerShell — checks + playwright + .env + DB
# o
pnpm install
pnpm run dev          # turbo: orquestador (3001) + web (3000) en paralelo
pnpm run build
pnpm run typecheck
pnpm test             # 73 passed +5 skipped (RUN_REAL_QWEN=1 para Qwen Chat real)
pnpm --filter @cerebro/orchestrator db:generate
pnpm --filter @cerebro/orchestrator db:migrate
pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful  # login QwenMax-3.8
```

Siempre ejecutar desde `C:\Users\USUARIO\Documents\Samuel\Cerebro de Agentes` con comillas por el espacio:
```ps
Set-Location -LiteralPath "C:\Users\USUARIO\Documents\Samuel\Cerebro de Agentes"
```

## Reglas

* **ESM** (`"type": "module"`), imports relativos con `.ts`, `paths` `@cerebro/*`.
* **Zod primero**: todo `Mission`/`MissionReport` validado con `packages/shared/protocols.ts`. No duplicar schemas.
* **Aislamiento**: cada misión en `git worktree` + rama `mission/<id>`. Nunca `main`. Ver `docs/governance.md:8.1`.
* **Comandos bloqueados**: `rm -rf /`, `sudo`, `DROP DATABASE`, `git push --force` → `governanceGuard` los rechaza sin aprobación humana (`docs/governance.md:8.2`).
* **Gate de calidad**: ninguna misión a `done` sin `tests pasan` + `acceptanceCriteria` cumplidos (`docs/governance.md:8.3`).
* **Memoria**: toda `decision` va a tabla `decisions` + `embeddings` (`docs/governance.md:8.5`).
* **Qwen**: **QwenMax-3.8** vía Chat Playwright `PersistentContext` `%LOCALAPPDATA%\CerebroQwen\user-data` (sin API). Ver `docs/qwen-chat.md`, `apps/orchestrator/src/bridges/qwen.chat.ts:1` y `qwen.ts:1`. Login en caliente: botón `Iniciar sesión Qwen` en `/qwen-chat` o `setup-qwen-profile.ts --headful`.
* **Qwen Chat Asistente**: ruta `/qwen-chat` (streaming, PG `qwenConversations`/`qwenMessages`, auto-misión si intent==project → `Supervisor`). Ver `docs/qwen-chat.md:1`.
* **Opencode CLI**: `opencode run "<prompt>" --format json --dir <worktree>` (no `--non-interactive -p`).
* **DSH**: `dsh-api-gateway` es Typert RPC, no HTTP genérico. `dsh-worktree`/`verification`/`permission-rules` no existen — usar `git worktree` + `sandbox-policy` + `permission-presets` (`docs/adapters.md:5.2`).
* **DB**: `vector(1536)` custom type, `CREATE EXTENSION vector` manual antes de `db:migrate`. `pglite` para tests sin PG (`docs/database.md`).

## Flujo de trabajo

1. Leer `docs/roadmap.md` para fase actual y criterio de salida.
2. Implementar con tests (`*.test.ts`) antes de avanzar de fase.
3. `pnpm run typecheck` + `pnpm run test` verde antes de commit.
4. Commits: `feat:`, `fix:`, `docs:`, `chore:`.

## Env

Copiar `.env.example` → `.env`. Requeridas: `DATABASE_URL`, `QWEN_TOKEN_PLAN_API_KEY` (o `QWEN_API_KEY`), `OPENCODE_API_KEY`/`OLLAMA_BASE_URL`.

## Referencias

* `docs/architecture.md` — flujo turn y ADRs (actualizado con Qwen Chat + iniciar.bat)
* `docs/protocols.md` — contratos Zod con ejemplos
* `docs/adapters.md` — cada adaptador y sus tests
* `docs/qwen-chat.md` — diseño escalable Qwen Chat (streaming, PG, auto-misión, login, Obsidian)
* `docs/setup.md` — guía escalable y `iniciar.bat`/`iniciar.ps1`
* `docs/roadmap.md` — 6b fases + `docs/governance.md` — hard constraints en `guard.ts`
* `deepseek-harness/docs/architecture.md` — inspiración Cordis turn flow

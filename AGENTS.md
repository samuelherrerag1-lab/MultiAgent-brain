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
pnpm install
pnpm run dev          # orquestador (3001) + web (3000) en paralelo
pnpm run build
pnpm run typecheck
pnpm run test
pnpm --filter orchestrator db:generate
pnpm --filter orchestrator db:migrate
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
* **Qwen**: vía API `qwen-token-plan` por defecto. Playwright `chat.qwen.ai` solo con `QWEN_BRIDGE_MODE=playwright` (experimental, `docs/adapters.md:5.1`).
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

* `docs/architecture.md` — flujo turn y ADRs
* `docs/protocols.md` — contratos Zod con ejemplos
* `docs/adapters.md` — cada adaptador y sus tests
* `docs/governance.md` — hard constraints implementadas en `guard.ts`
* `deepseek-harness/docs/architecture.md` — inspiración Cordis turn flow

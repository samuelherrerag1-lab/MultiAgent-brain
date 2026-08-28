# Cerebro de Agentes — MultiAgent-brain

> **Repo:** https://github.com/samuelherrerag1-lab/MultiAgent-brain

Orquestador multi-agente **Líder → Pro Agents** (Qwen + DeepSeek Harness + Opencode) con contratos Zod, aislamiento `git worktree`, gate de calidad y memoria `pgvector`.

> Ruta local: `C:\Users\USUARIO\Documents\Samuel\Cerebro de Agentes` · Monorepo `pnpm + Turborepo` · Runtime `Node 22 LTS`

## Quickstart

```ps
# 1. Instalar deps (desde esta carpeta, con comillas por el espacio)
pnpm install

# 2. Configurar env
Copy-Item .env.example .env
# edita DATABASE_URL (Neon remoto o local), QWEN_TOKEN_PLAN_API_KEY, etc.

# 3. DB (sin Docker: usa Neon + pglite)
psql $env:DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
pnpm --filter orchestrator db:generate
pnpm --filter orchestrator db:migrate

# 4. Dev (orquestador + web en paralelo)
pnpm run dev
# Hono: http://localhost:3001/health
# Next: http://localhost:3000
```

## Estructura

Ver `docs/monorepo.md` para árbol exacto.

```
packages/shared        # @cerebro/shared — Zod Mission/MissionReport
apps/orchestrator      # Hono Líder + bridges/adapters/router/governance
apps/web               # Next.js 15 Chat + Kanban + SSE
tooling/tsconfig       # TS 6.0 strict base
docs/                  # 8 docs del plan (arquitectura → gobernanza)
```

## Docs del plan

| # | Doc | Descripción |
|---|---|---|
| 1 | `docs/architecture.md` | Visión, componentes, flujo turn, ADRs |
| 2 | `docs/stack.md` | Stack, requisitos máquina, mitigaciones Windows |
| 3 | `docs/monorepo.md` | Árbol, workspaces, turbo pipelines |
| 4 | `docs/protocols.md` | `MissionSchema` / `MissionReportSchema` (Zod) |
| 5 | `docs/adapters.md` | Qwen (API+Playwright), DSH, Opencode |
| 6 | `docs/database.md` | Drizzle + pgvector, `vector(1536)`, pglite fallback |
| 7 | `docs/roadmap.md` | 6 fases (13 días) + gates |
| 8 | `docs/governance.md` | Aislamiento, comandos bloqueados, gate calidad, memoria |

## Stack

Node 22 + pnpm 11 + Turborepo 2.5 · TypeScript 6.0 strict · Hono 4 · Zod 3 · Drizzle 0.38 · PostgreSQL 16 + pgvector 0.8 · Next.js 15 + Tailwind 4 + shadcn/ui · Qwen API · DSH 0.1.1-rc.2 · Opencode 1.18 + Ollama

Ver `docs/stack.md` para alternativas sin Docker/Bun.

## Comandos

```ps
pnpm run build        # turbo build
pnpm run dev          # turbo dev (persistent)
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm --filter orchestrator db:studio  # Drizzle Studio
```

## Gobernanza

Hard constraints en `apps/orchestrator/src/governance/guard.ts`: worktree obligatorio, regex `rm -rf|sudo|DROP DATABASE|git push --force` bloqueados, gate `tests + acceptanceCriteria`, kill tras 5 iteraciones/10min, memoria en `decisions` + `embeddings`.

Ver `docs/governance.md`.

## Roadmap

FASE 0 (hoy): scaffold + docs ✓
FASE 1: Core (Hono+PG) → FASE 2: Opencode → FASE 3: DSH → FASE 4: Qwen → FASE 5: Router/Supervisor → FASE 6: Frontend

Ver `docs/roadmap.md` para criterio de salida por fase.

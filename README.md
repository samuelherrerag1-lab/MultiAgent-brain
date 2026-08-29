# Cerebro de Agentes — MultiAgent-brain

> **Repo:** https://github.com/samuelherrerag1-lab/MultiAgent-brain

Orquestador multi-agente **Líder → Pro Agents** (Qwen + DeepSeek Harness + Opencode) con contratos Zod, aislamiento `git worktree`, gate de calidad y memoria `pgvector`.

> Ruta local: `C:\Users\USUARIO\Documents\Samuel\Cerebro de Agentes` · Monorepo `pnpm + Turborepo` · Runtime `Node 22 LTS`

## Quickstart — Un click

```ps
# Opción A — Ejecutable (recomendado): levanta todo correctamente
.\iniciar.bat        # CMD — abre 2 ventanas (Orquestador 3001 + Web 3000)
.\iniciar.ps1        # PowerShell — más robusto, con checks
# Hace: checks Node/pnpm/Git/Playwright, pnpm install, playwright install, .env, Qwen profile, DB (docker/pglite), y abre http://localhost:3000

# Opción B — Manual
# 1. Instalar deps (desde esta carpeta, con comillas por el espacio)
pnpm install

# 2. Configurar env
Copy-Item .env.example .env
# edita DATABASE_URL (vacío = pglite, cero config), QWEN_USER_DATA_DIR, OPENCODE_API_KEY, etc. Ver docs/setup.md

# 3. Qwen Chat — sesión persistente QwenMax-3.8 (una vez)
pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful
# → Loguéate con GitHub, selecciona QwenMax-3.8, envía "hola", cierra

# 4. DB (sin Docker: pglite auto, cero config. Con PG real:)
psql $env:DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
pnpm --filter @cerebro/orchestrator db:generate
pnpm --filter @cerebro/orchestrator db:migrate

# 5. Dev (orquestador + web en paralelo)
pnpm run dev
# Hono: http://localhost:3001/health — Qwen Chat: http://localhost:3000/qwen-chat
# Misiones: http://localhost:3000 — Dashboard: http://localhost:3000/dashboard
```

Ver `docs/setup.md` (guía escalable) y `docs/qwen-chat.md` (diseño Qwen Chat).

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
| 5 | `docs/adapters.md` | Qwen Chat QwenMax-3.8, DSH, Opencode |
| 6 | `docs/database.md` | Drizzle + pgvector, `vector(1536)`, pglite fallback |
| 7 | `docs/roadmap.md` | 6 fases + 6b Qwen Chat (16 días) + gates |
| 8 | `docs/governance.md` | Aislamiento, comandos bloqueados, gate calidad, memoria |
| 9 | `docs/qwen-chat.md` | Diseño escalable Qwen Chat (streaming, PG, auto-misión, login, Obsidian) |
| 10 | `docs/setup.md` | Guía escalable + `iniciar.bat` (levanta todo) |

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

FASE 0: scaffold ✓ — FASE 1: Core ✓ — FASE 2: Opencode ✓ — FASE 3: DSH ✓ — FASE 4: Qwen Chat QwenMax-3.8 ✓ — FASE 5: Router/Supervisor ✓ — FASE 6: Frontend ✓ — FASE 6b: Qwen Chat Asistente (ruta `/qwen-chat`, PG, streaming, auto-misión, login en caliente, Obsidian prep)

Ver `docs/roadmap.md` y `docs/qwen-chat.md`.

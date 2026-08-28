# @cerebro/orchestrator

Hono Líder — API del Cerebro de Agentes (FASE 1).

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` `/api/health` | Liveness |
| POST | `/api/missions` | Crea misión (valida `MissionSchema` sin `missionId`/`createdAt`) |
| GET | `/api/missions` | Lista misiones (100 latest) |
| GET | `/api/missions/:id` | Detalle + report |
| PUT | `/api/missions/:id/report` | Upsert `MissionReport` |
| GET | `/api/missions/:id/stream` | SSE polling (1s, 30 ticks) |

## Dev

```ps
# Desde la raíz del monorepo
pnpm install
Copy-Item .env.example .env
# Opción A: pglite (0 config, default)
# DATABASE_URL vacío → pglite memory + tablas auto-creadas

# Opción B: Docker PG16+pgvector
docker compose up -d db
$env:DATABASE_URL="postgresql://cerebro:cerebro@localhost:5432/cerebro"
psql $env:DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Opción C: Neon remoto
# $env:DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/cerebro?sslmode=require"

pnpm --filter @cerebro/orchestrator dev
# http://localhost:3001/health
```

## Drizzle

```ps
pnpm --filter @cerebro/orchestrator db:generate
pnpm --filter @cerebro/orchestrator db:migrate
pnpm --filter @cerebro/orchestrator db:studio
```

Tablas: `missions`, `mission_reports`, `decisions`, `worktrees`, `embeddings` (vector 1536).

## Tests

```ps
pnpm test              # raíz: 25 tests (protocols + hono)
pnpm --filter @cerebro/orchestrator test
pnpm run typecheck
```

## Notas FASE 1

* DB pglite por defecto (sin Docker). PG real solo si `DATABASE_URL` apunta a PG.
* SSE actual es polling simple; en FASE 6 será pub/sub real.
* Router/Supervisor/Governance vienen en FASE 5.

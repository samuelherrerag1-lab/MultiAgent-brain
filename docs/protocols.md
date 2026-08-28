# 4. Protocolos de Comunicación (Zod Schemas)

> Ubicación: `packages/shared/protocols.ts` — única fuente de verdad.
> Todos los agentes deben comunicarse con el Líder usando estos contratos JSON. Validación en ambos extremos.

## 4.1 Misión (Líder → Pro Agent) — `MissionSchema`

```typescript
import { MissionSchema, type Mission } from "@cerebro/shared/protocols";

const mission: Mission = MissionSchema.parse({
  missionId: "550e8400-e29b-41d4-a716-446655440000",
  type: "build",
  complexity: "medium",
  title: "Crear API de usuarios CRUD",
  prompt: "Implementa CRUD de usuarios con Hono + Drizzle...",
  workspace: { repo: ".", branch: "main" },
  contextFiles: ["apps/orchestrator/src/db/schema.ts"],
  acceptanceCriteria: [
    "POST /users crea usuario y retorna 201",
    "GET /users lista con paginación",
    "Tests pasan con coverage >80%"
  ],
  priority: "normal",
  timeoutMs: 300_000,
  traceId: "trace-abc123",
  createdAt: Date.now(),
  attempt: 1
});
```

### Campos

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `missionId` | `string(uuid)` | Sí | UUID v4, clave primaria |
| `type` | `MissionType` | Sí | `planificar_arquitectura` \| `revisar_entregable` \| `resolver_bloqueo` \| `build` \| `execute` \| `refactor` \| `tests` |
| `complexity` | `low\|medium\|high` | Sí | Estimación; influye en routing |
| `title` | `string(5-80)` | Sí | Para Kanban |
| `prompt` | `string(20-65536)` | Sí | Prompt estructurado inyectado al agente. Límite 65536 = `agent-instructions maxBytes` |
| `workspace` | `{repo, branch?, worktree?, baseCommit?}` | Sí | `repo` local o remoto; `worktree` lo genera el Líder |
| `contextFiles` | `string[0..20]` | No | Archivos que el agente debe leer primero |
| `acceptanceCriteria` | `string[1..n]` | Sí | **Obligatorio** — Gate de Calidad los verifica |
| `toolsAllowed` | `string[]` | No | Whitelist; si vacío usa defaults del adaptador |
| `priority` | `low\|normal\|high` | No | Default `normal` |
| `timeoutMs` | `10000-600000` | No | Default `300000` (5min). Supervisor mata tras esto |
| `traceId` | `string` | No | Correlación SSE/logs |
| `createdAt` | `number` | Sí | `Date.now()` |
| `attempt` | `number>=1` | No | Default 1, incrementa en retry |

## 4.2 Reporte de Misión (Pro Agent → Líder) — `MissionReportSchema`

```typescript
import { MissionReportSchema, type MissionReport } from "@cerebro/shared/protocols";

const report: MissionReport = MissionReportSchema.parse({
  missionId: "550e8400-e29b-41d4-a716-446655440000",
  status: "success",
  adapter: "dsh",
  summary: "CRUD implementado, 12 tests pasan, coverage 84%",
  artifacts: [
    { path: "src/routes/users.ts", kind: "file" },
    { path: "tests/users.test.ts", kind: "file" }
  ],
  testResults: { passed: 12, failed: 0, coverage: 84 },
  decisions: [{ decision: "Usar Drizzle + pg", rationale: "Type-safe, ya en stack", at: Date.now() }],
  durationMs: 42_000
});
```

### Campos

| Campo | Tipo | Descripción |
|---|---|---|
| `missionId` | `uuid` | Debe coincidir con la misión |
| `status` | `success\|failed\|aborted\|needs_review` | `needs_review` → Gate pide revisión humana |
| `adapter` | `qwen\|dsh\|opencode` | Quién ejecutó |
| `summary` | `string<=4000` | Para Kanban y tabla `decisions` |
| `artifacts` | `{path, kind, bytes}[]` | `kind: file\|diff\|log\|test_report` |
| `testResults` | `{passed, failed, coverage?, output?}` | `output` max 50000 (respeta `spill maxInlineBytes`) |
| `decisions` | `{decision, rationale, at}[]` | Se persiste en `decisions` para memoria RAG |
| `traceId` | `string` | Propagado |
| `durationMs` | `number` | Tiempo real |
| `error` | `{message, stack?, code?}` | Solo si `status != success` |
| `nextActions` | `string[]` | Sugerencias del agente |

## 4.3 Uso en Hono

```typescript
// apps/orchestrator/src/index.ts
import { zValidator } from "@hono/zod-validator";
import { MissionSchema } from "@cerebro/shared/protocols";

app.post("/api/missions", zValidator("json", MissionSchema.omit({ missionId: true, createdAt: true })), async (c) => {
  const body = c.req.valid("json");
  const mission = MissionSchema.parse({ ...body, missionId: crypto.randomUUID(), createdAt: Date.now() });
  // ...
});
```

## 4.4 Versionado

* Schemas versionados por `packages/shared/package.json` version. Breaking change → bump minor + migración.
* Validación en **ambos extremos**: Líder valida antes de enviar, adaptador valida al recibir. Doble gate evita payloads corruptos.

## 4.5 Tests

```typescript
// packages/shared/src/protocols.test.ts (a crear en FASE 1)
import { MissionSchema } from "./protocols.ts";
test("rechaza prompt vacío", () => {
  expect(() => MissionSchema.parse({ ...base, prompt: "" })).toThrow();
});
```

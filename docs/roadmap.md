# 7. Plan de Ejecución (Roadmap)

> Fases en orden. Cada fase genera tests unitarios para sus adaptadores antes de avanzar.

## Resumen

| Fase | Nombre | Días | Entregable |
|---|---|---|---|
| 0 | Fundación | 1 | Repo git, docs completos, `pnpm install` verde |
| 1 | Core | 2 | Monorepo + Zod + PG + Hono base |
| 2 | Opencode | 1 | `OpencodeAdapter` con `Bun.spawn` |
| 3 | DSH Gateway | 2 | `DeepSeekAdapter` + `dsh-mission-gateway` stub |
| 4 | Qwen | 2 | `QwenApiAdapter` + `consultArchitect()` JSON |
| 5 | Router & Supervisor | 2 | `TaskRouter` + `Supervisor` + Governance |
| 6 | Frontend | 3 | Next.js Chat + Kanban + SSE |

**Total: 13 días** (ajustado de 12 por FASE 0).

---

## FASE 0: Fundación (Día 0) — ESTA FASE

**Objetivo:** Cerrar vacíos de documentación que bloqueaban el plan.

**Tareas:**

- [x] Inicializar carpetas `docs/`, `packages/shared`, `apps/orchestrator`, `apps/web`, `tooling/`
- [x] `package.json` raíz + `pnpm-workspace.yaml` (aislado) + `turbo.json` + `tooling/tsconfig/base.json`
- [x] `packages/shared/src/protocols.ts` con `MissionSchema`/`MissionReportSchema` completos
- [x] `docs/architecture.md` (1), `docs/stack.md` (2), `docs/monorepo.md` (3), `docs/protocols.md` (4), `docs/adapters.md` (5), `docs/database.md` (6), `docs/governance.md` (8)
- [ ] `git init`, `git add .`, primer commit `chore: scaffold cerebro de agentes`
- [ ] `pnpm install` y `pnpm run typecheck` verde
- [ ] Crear `DATABASE_URL` (Neon) o `pglite` memory para dev

**Criterio de salida:** `pnpm install` sin errores, `docs/` completo, `protocols.ts` validado con `zod`.

---

## FASE 1: Inicialización y Core (Días 1-2)

**Tareas:**

1. `packages/shared` — tests `protocols.test.ts` (Zod valid/invalid).
2. PostgreSQL: `docker compose up -d db` (si Docker) o `Neon` + `psql $DATABASE_URL -c "CREATE EXTENSION vector;"` + `drizzle.config.ts`.
3. Drizzle: `src/db/schema.ts`, `drizzle-kit generate`, `drizzle-kit migrate`.
4. Hono base en `apps/orchestrator/src/index.ts`:
   ```typescript
   const app = new Hono();
   app.get("/health", (c) => c.json({ ok: true }));
   app.post("/api/missions", zValidator("json", MissionSchema), ...);
   app.get("/api/missions", ...); // lista Kanban
   app.get("/api/missions/:id/stream", ...); // SSE
   ```
5. `.env.example` → `.env`, `PORT=3001`.

**Tests:** `missions.test.ts` (POST valid/invalid), `db.test.ts` (insert/select).

**Salida:** `curl localhost:3001/health` → 200, `GET /api/missions` lee PG.

---

## FASE 2: Adaptador Opencode (Día 3)

*Antes que DSH/Qwen porque es local y barato, valida aislamiento worktree.*

**Tareas:**

1. `src/adapters/opencode.ts` — `Bun.spawn` (o `node:child_process`), `ensureAgentsMd()`, `opencode run --format json --dir`.
2. `templates/AGENTS.md` — plantilla que el adaptador copia a worktree.
3. Script prueba: `pnpm --filter orchestrator test:opencode` → envía misión `"Crea hello_world.py"` y valida `MissionReport` con `status: success` y `artifacts: [{path: "hello_world.py"}]`.
4. Pre-flight `ollama list` + fallback `opencode-zen`.

**Tests:** `opencode.test.ts` con mock spawn, verifica args y `AGENTS.md`.

**Salida:** Misión `refactor` → Opencode genera archivo en worktree, report parseado.

---

## FASE 3: Adaptador DSH (Días 4-5)

*Requiere DSH instalado en `C:\Users\USUARIO\Documents\Samuel\deepseek-harness`.*

**Tareas:**

1. Crear plugin `dsh-mission-gateway` en DSH (`packages/mission/mission-gateway`) — Service Definition + Provider que envuelva `ctx.agents` + `tool-subagent` + `session-persistence`.
   * Si no se quiere tocar DSH aún, usar stub HTTP: `apps/orchestrator/src/adapters/deepseek.stub.ts` que simula polling.
2. `src/adapters/deepseek.ts` — `createWorktree()`, `buildDSHPrompt()`, `fetch(${DSH_API_URL}/missions)` o `spawn pnpm dsh`.
3. Instalar plugins útiles en DSH si faltan: `dsh plugin add` — pero `dsh-api-gateway` ya existe, no instalar `dsh-worktree` (no existe).
4. Script prueba: misión `build` → DSH genera archivo vía subagentes, Líder pollea `GET /missions/:id/status`.

**Tests:** `deepseek.test.ts` mock fetch/worktree.

**Salida:** Misión `build` → DSH ejecuta con subagentes, report con `testResults`.

---

## FASE 4: Qwen Bridge (Días 6-7)

**Tareas:**

1. `src/bridges/qwen.ts` — `consultArchitect(objective)` vía `qwen-token-plan` API (Aliyun). `response_format: json_object` cuando se pide JSON.
2. `src/bridges/qwen.playwright.ts` (experimental, feature-flag `QWEN_BRIDGE_MODE`):
   * `scripts/setup-qwen-profile.sh` — `playwright install chromium`, `user-data-dir` persistente.
   * Selectores robustos `textarea`, `.assistant-message`, `waitForSelector Stop hidden`.
   * `consultArchitectPlaywright()` con retry + screenshot on failure.
3. Método `executeQwen(mission)` que delega a API por defecto, Playwright solo si flag.

**Tests:** `qwen.test.ts` mock fetch, `qwen.playwright.test.ts` skip si no hay `QWEN_BRIDGE_MODE=playwright`.

**Salida:** `consultArchitect("diseña API de usuarios")` → JSON parseado `{summary, decisions}`.

---

## FASE 5: Router y Lógica del Líder (Días 8-9)

**Tareas:**

1. `src/router/task-router.ts`:
   ```typescript
   export function route(mission: Mission): AdapterId {
     if (mission.complexity === "high" && mission.type === "planificar_arquitectura") return "qwen";
     if (mission.type === "revisar_entregable" || mission.type === "resolver_bloqueo") return "qwen";
     if (mission.type === "refactor" || mission.type === "tests") return "opencode";
     if (mission.type === "build" || mission.type === "execute") return "dsh";
     return "dsh"; // default
   }
   ```
   + matriz fallback si adaptador falla.
2. `src/router/supervisor.ts` — `maxRetries:3`, `maxIterations:5`, `timeoutMs:600_000`, escalado a `qwen` con traceback, `AbortController`.
3. `src/governance/guard.ts` — `BLOCKED` regex, `qualityGate()`, `saveDecision()`, `approval` flow.
4. Integración en `POST /api/missions` → `route → guard.preExecute → supervisor.run → qualityGate → saveDecision`.

**Tests:** `task-router.test.ts` (tabla de decisión), `supervisor.test.ts` (retry, timeout, escalado), `guard.test.ts` (bloqueos).

**Salida:** Misión falla 3 veces → Supervisor escala a Qwen con traceback, mata tras 5 iteraciones/10min.

---

## FASE 6: Frontend y UI (Días 10-12)

**Tareas:**

1. `apps/web` — `npx create-next-app@15` (App Router), Tailwind 4, `shadcn init`, `pnpm add @cerebro/shared`.
2. Chat: `app/page.tsx` — `textarea` → `POST /api/missions` → SSE `GET /api/missions/:id/stream` para logs.
3. Dashboard Kanban: `app/dashboard/page.tsx` — `GET /api/missions` → columnas `pending|running|success|failed|needs_review` (lectura PG), `useEffect` + `EventSource`.
4. SSE en Hono: `app.get("/api/missions/:id/stream", (c) => streamSSE(c, async (stream) => { ... }))`.
5. Aprobación humana: modal si `governanceGuard` bloquea → `POST /api/missions/:id/approve`.

**Tests:** `apps/web` Vitest + Playwright e2e (opcional).

**Salida:** Usuario escribe objetivo en Chat, ve progreso en Kanban y logs streaming.

---

## Hitos y gates

* Cada fase **no avanza** sin `pnpm run typecheck` + `pnpm run test` verde.
* FASE 1-5 requieren `DATABASE_URL` válida (Neon o local).
* FASE 3 requiere DSH corriendo (`pnpm dsh web --no-open` en `deepseek-harness`).
* FASE 4 requiere `QWEN_TOKEN_PLAN_API_KEY` en `.env` (ya en `~/.dsh/settings.yaml`).
* FASE 2 requiere `ollama` o `OPENCODE_API_KEY`.

## Riesgos y mitigaciones en roadmap

| Riesgo | Fase | Mitigación |
|---|---|---|
| PG sin Docker | 1 | Neon remoto + pglite memory |
| Bun en Windows | 1-2 | Mantener Node, Bun solo WSL2 |
| DSH plugins inexistentes | 3 | Stub + `dsh-mission-gateway` custom |
| Qwen DOM frágil | 4 | API primario, Playwright experimental |
| SSE en Hono | 6 | `@hono/node-server` + `streamSSE` helper |

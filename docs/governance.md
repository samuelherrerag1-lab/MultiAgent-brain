# 8. Reglas de Gobernanza y Seguridad (Hard Constraints)

> Programadas en el núcleo del Orquestador (`apps/orchestrator/src/governance/guard.ts`). Nunca permitas que subagentes las violen.

## 8.1 Aislamiento

**Regla:** Toda tarea de DSH/Opencode debe ejecutarse en una rama Git aislada o Worktree. Nunca trabajar directo sobre `main`.

**Implementación:**

```typescript
// guard.ts
export async function createWorktree(missionId: string): Promise<string> {
  const branch = `mission/${missionId}`;
  const path = `.cerebro-worktrees/${missionId}`;
  await $`git worktree add ${path} -b ${branch}`;
  await db.insert(worktrees).values({ missionId, path, branch });
  return path;
}

export function assertNotMain(cwd: string) {
  const branch = execSync("git branch --show-current", { cwd }).toString().trim();
  if (branch === "main" || branch === "master") throw new Error("Hard constraint: nunca ejecutar sobre main");
}
```

* GC: `Supervisor` marca `gcAt` al finalizar; cron diario borra worktrees con `gcAt < now - 7d`.
* Colisión: si dos misiones comparten `missionId` (imposible por uuid) o `worktree` huérfano, GC lo detecta vía `worktrees` table.

## 8.2 Comandos Prohibidos

**Regla:** El Orquestador intercepta y bloquea regex de comandos destructivos a menos que haya aprobación humana explícita vía UI.

**Lista bloqueada (regex):**

```typescript
const BLOCKED = [
  /rm\s+-rf\s+(\/|~|\*)/i,
  /sudo\s+/i,
  /drop\s+database/i,
  /drop\s+table/i,
  /git\s+push\s+--force/i,
  /mkfs/i,
  /dd\s+if=/i,
  /shutdown/i,
  /:\(\)\{\s*:\|\:&\s*\};:/, // fork bomb
  />\s*\/dev\/sda/i,
];
```

**Implementación:** `tools/pre-execute` waterfall listener (Hono middleware `governanceGuard`):

```typescript
export const governanceGuard = async (mission: Mission, command: string) => {
  for (const rx of BLOCKED) {
    if (rx.test(command)) {
      if (!await hasHumanApproval(mission.traceId)) {
        throw new BlockedCommandError(`Comando bloqueado por gobernanza: ${rx}`, command);
      }
    }
  }
};
```

* UI: si bloqueado, SSE emite `approval:required` → Frontend muestra modal "Aprobar `rm -rf`?" → `POST /api/missions/:id/approve`.
* Log: todo bloqueo se persiste en `mission_reports.error` con `code: BLOCKED_COMMAND`.

## 8.3 Gate de Calidad

**Regla:** Ninguna tarea pasa a `done` sin que QA Agent (o Qwen) haya validado que tests pasan y `acceptance_criteria` se cumplen.

**Implementación:**

```typescript
export async function qualityGate(mission: Mission, report: MissionReport): Promise<boolean> {
  // 1. Tests
  if (report.testResults && report.testResults.failed > 0) return false;
  // 2. Acceptance criteria — delega a Qwen revisor si no hay tests que lo cubran
  if (mission.type === "revisar_entregable" || report.status === "needs_review") {
    const review = await qwenReview(mission, report); // consultArchitect con checklist
    if (!review.passed) {
      report.summary += `\n[Gate] Criterio fallido: ${review.failedCriteria.join(", ")}`;
      return false;
    }
  }
  // 3. Coverage mínimo (opcional, configurable)
  if (report.testResults?.coverage !== undefined && report.testResults.coverage < 70) return false;
  return true;
}
```

* Si `qualityGate` falla → `Supervisor` reintenta (max 3) o escala a Qwen con traceback.
* Estado `needs_review` requiere aprobación humana en Dashboard antes de `done`.

## 8.4 Límite de Tokens / Iteraciones

**Regla:** Si un agente entra en bucle, Supervisor mata proceso tras 5 iteraciones o timeout 10 minutos.

```typescript
const SUPERVISOR_CONFIG = {
  maxRetries: 3,          // reintentos con mismo adaptador
  maxIterations: 5,       // iteraciones totales (incluye escalados)
  timeoutMs: 600_000,     // 10 min por misión
  escalateAdapter: "qwen" as AdapterId, // tras 3 fallos, escala a Qwen API
};

export class Supervisor {
  async run(mission: Mission, attempt = 1): Promise<MissionReport> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), mission.timeoutMs);
    try {
      const report = await adapters[route(mission)].execute(mission, { signal: controller.signal });
      if (await qualityGate(mission, report)) return report;
      if (attempt >= SUPERVISOR_CONFIG.maxRetries) {
        // Escala a Qwen con traceback
        const escalated = { ...mission, prompt: mission.prompt + `\n\n[TRACEBACK]\n${report.error?.stack}`, attempt: attempt+1 };
        return this.run({ ...escalated, type: "resolver_bloqueo" }, attempt+1);
      }
      return this.run({ ...mission, attempt: attempt+1 }, attempt+1);
    } finally { clearTimeout(timeout); }
  }
}
```

* Kill usa `AbortController` + `proc.kill()` + `job_stop` (futuro `dsh-mission-gateway`).
* Métricas: `durationMs`, `attempt`, `traceId` en `mission_reports` para auditoría.

## 8.5 Memoria

**Regla:** Todo error resuelto debe guardarse en tabla `decisions` para que Qwen no cometa el mismo error arquitectónico.

```typescript
export async function saveDecision(mission: Mission, report: MissionReport) {
  if (report.decisions) {
    for (const d of report.decisions) {
      await db.insert(decisions).values({
        id: crypto.randomUUID(),
        missionId: mission.missionId,
        decision: d.decision,
        rationale: d.rationale,
      });
      // Opcional: embedding para RAG
      const emb = await embed(`${d.decision} ${d.rationale}`);
      await db.insert(embeddings).values({ id: crypto.randomUUID(), missionId: mission.missionId, content: d.decision, embedding: emb });
    }
  }
}
```

* En `consultArchitect()`, el prompt incluye `SELECT * FROM decisions ORDER BY embedding <=> query LIMIT 5` como contexto RAG.
* `flowctx-dsh` o `dsh-memory-toolkit` (ya instalados en DSH) pueden usarse como alternativa a tabla propia, pero `decisions` es fuente canónica del Cerebro.

## 8.6 Auditoría

* Toda decisión de `governanceGuard`, `qualityGate`, `supervisor` emite `SessionEvent` loggeable y SSE `governance:*`.
* Dashboard muestra badge `blocked`, `needs_review`, `escalated` por misión.

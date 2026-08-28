# 5. Especificaciones de Adaptadores

> Tres adaptadores, un contrato (`Mission`/`MissionReport`). Cada uno implementa `interface Adapter { execute(mission: Mission): Promise<MissionReport> }`.

## 5.1 Qwen Bridge — `src/bridges/qwen.ts`

### Propósito
Solo para `planificar_arquitectura`, `revisar_entregable`, `resolver_bloqueo`. Qwen es el arquitecto de mayor ventana (1M) y razonamiento.

### Mecanismo primario (recomendado): API

```typescript
// apps/orchestrator/src/bridges/qwen.ts
import { Mission, MissionReport } from "@cerebro/shared/protocols";

// Usa qwen-token-plan ya credencial en ~/.dsh/settings.yaml
const QWEN_BASE_URL = process.env.QWEN_BASE_URL; // https://ws-cvkj.../compatible-mode/v1
const QWEN_API_KEY = process.env.QWEN_TOKEN_PLAN_API_KEY;
const QWEN_MODEL = "qwen3.7-plus"; // o qwen3-max

export async function consultArchitect(objective: string): Promise<string> {
  const res = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${QWEN_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: QWEN_MODEL,
      messages: [{ role: "user", content: objective }],
      stream: false,
      // Qwen extra: enable_thinking, response_format json_object si se pide JSON
    })
  });
  const json = await res.json();
  return json.choices[0].message.content;
}

export async function executeQwen(mission: Mission): Promise<MissionReport> {
  const start = Date.now();
  try {
    const prompt = buildArchitectPrompt(mission); // inyecta Mission JSON + contextFiles
    const content = await consultArchitect(prompt);
    // Si se pidió JSON, parsear; si no, envolver como summary
    const parsed = tryParseJson(content);
    return {
      missionId: mission.missionId,
      status: "success",
      adapter: "qwen",
      summary: parsed?.summary ?? content.slice(0, 4000),
      artifacts: [],
      decisions: parsed?.decisions,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return { missionId: mission.missionId, status: "failed", adapter: "qwen", summary: String(e), artifacts: [], durationMs: Date.now()-start, error: { message: String(e) } };
  }
}
```

**Ventajas:** estable, sin DOM frágil, sin `user-data-dir`, sin login manual, con `response_format: json_object` para `consultArchitect()` que devuelva JSON parseado.

### Mecanismo experimental (feature-flag): Playwright Headless

Solo si el usuario exige automatizar `chat.qwen.ai` (ToS permitting). No en ruta crítica.

* **Setup:** `scripts/setup-qwen-profile.sh` → `npx playwright install chromium`, `chromium.launchPersistentContext(userDataDir, { headless: true })`.
* **Flujo:**
  1. `page.goto("https://chat.qwen.ai")`
  2. `page.fill("textarea[placeholder*='Ask']", prompt)` — selector robusto con fallback `[contenteditable]`
  3. `page.keyboard.press("Enter")`
  4. `page.waitForSelector("[data-testid='stop']", { state: "hidden", timeout: 90_000 })` o `waitForSelector(".assistant-message:last-child")`
  5. `page.locator(".assistant-message").last().innerText()`
* **Riesgos documentados:** DOM cambia sin aviso, headless detection, `user-data-dir` contiene sesión completa (no versionar), 90s timeout.
* **Flag:** `QWEN_BRIDGE_MODE=api|playwright` (default `api`). Playwright solo si `QWEN_BRIDGE_MODE=playwright`.

```typescript
export async function executeQwenPlaywright(mission: Mission): Promise<MissionReport> {
  // solo si process.env.QWEN_BRIDGE_MODE === "playwright"
  // ver implementación completa en src/bridges/qwen.playwright.ts (experimental)
}
```

---

## 5.2 DeepSeek Harness Adapter — `src/adapters/deepseek.ts`

### Propósito
`build` / `execute` — tareas que requieren sandbox, subagentes, herramientas FS/shell.

### Realidad DSH instalada

* `dsh-api-gateway` **existe** pero es Typert RPC (`packages/api/gateway/src/index.ts`), no HTTP mission runner. No expone polling/webhook.
* `dsh-worktree`, `dsh-verification`, `dsh-permission-rules` **no existen** como plugins. Mapeo:
  * worktree → `git worktree add` + `fs-sandbox workspaceRoot`
  * verification → `jobs-local + session-query-sqlite + tool-call-timeout-policy`
  * permission-rules → `sandbox-policy + permission-presets + fs-observation-policy`

### Arquitectura propuesta: `dsh-mission-gateway` (plugin custom)

Crear plugin en DSH (`packages/mission/mission-gateway`) que:

1. **Service Definition** `MissionGateway` con `createMission(mission: Mission)`, `getMission(id)`, `pollReport(id)`.
2. **Provider** que valida `MissionSchema`, emite `SessionEvent` `mission/start`, crea agente vía `ctx.agents` + `ctx.agentLoop`, delega a `tool-subagent` (`spawn` continuable).
3. **Expone** HTTP vía `dsh-host-webserver` (`GET /missions/:id`, `POST /missions`) o MCP vía `mcp-client` (cliente, no server — el gateway es server).

**Mientras el plugin no exista (v0.1):** el adaptador usa **subprocess DSH CLI** como puente:

```typescript
// apps/orchestrator/src/adapters/deepseek.ts
import { spawn } from "node:child_process";

export async function executeDSH(mission: Mission): Promise<MissionReport> {
  // 1. Crear worktree aislado
  const worktree = await createWorktree(mission.missionId); // git worktree add .cerebro-worktrees/<id>

  // 2. Escribir Mission como prompt estructurado + AGENTS.md
  const prompt = buildDSHPrompt(mission); // JSON frontmatter + acceptanceCriteria
  await writeAgentsMd(worktree, prompt);

  // 3. Invocar DSH headless (cuando dsh-mission-gateway no esté, usar dsh CLI)
  // Futuro: fetch(`${DSH_API_URL}/missions`, {method:"POST", body: JSON.stringify(mission)})
  // Temporal: spawn dsh
  const proc = spawn("pnpm", ["dsh", "--profile", "web", "--", prompt], { cwd: worktree });

  // 4. Poll o esperar stdout, parsear MissionReport JSON del final
  const output = await collectOutput(proc, mission.timeoutMs);
  return parseReport(output, mission);
}
```

**Polling vs Webhook:** v0.1 usa polling `GET /missions/:id/status` leyendo `session-persistence-jsonl` + `session-projection`. Webhook requiere firma + cola, se deja para v0.2.

---

## 5.3 Opencode Adapter — `src/adapters/opencode.ts`

### Propósito
`refactor` / `tests` — edición quirúrgica, generación de tests, refactorización profunda. Local, barato, rápido.

### CLI real (corregido)

Plan decía `opencode --non-interactive -p` — **no existe**. CLI `1.18.23` (`~/.config/opencode/opencode.json`):

```ps
opencode run "<prompt>" --format json --dir <worktree> --model <provider/model>
# Flags: --format json|default, --model, --agent, --dir, --continue, --session, --title
```

### Implementación

```typescript
// apps/orchestrator/src/adapters/opencode.ts
import { spawn } from "node:child_process";

export async function executeOpencode(mission: Mission): Promise<MissionReport> {
  const worktree = await ensureWorktree(mission);
  await ensureAgentsMd(worktree, mission); // opencode lee AGENTS.md si existe, no lo crea

  const args = [
    "run", buildPrompt(mission),
    "--format", "json",
    "--dir", worktree,
  ];
  // Modelo: usa small_model de opencode.json o env
  if (process.env.OPENCODE_MODEL) args.push("--model", process.env.OPENCODE_MODEL);

  const proc = Bun.spawn(["opencode", ...args], { cwd: worktree }); // o node:child_process
  const stdout = await proc.stdout.text(); // o collect stream
  const events = parseJsonLines(stdout); // filtra reasoning_token, tool_result
  return toMissionReport(events, mission);
}
```

**Pre-flight checks:**

```typescript
async function preflight() {
  // Ollama local?
  try { await fetch("http://localhost:11434/api/tags"); } catch { warn("Ollama down, opencode usará opencode-zen si OPENCODE_API_KEY set"); }
  // opencode bin?
  await Bun.$`opencode --version`;
}
```

**AGENTS.md:** el adaptador debe asegurar que `worktree/AGENTS.md` existe antes de `run` (copia desde `templates/AGENTS.md` + inyecta `mission.prompt`).

---

## 5.4 Interface común

```typescript
// apps/orchestrator/src/adapters/index.ts
export interface Adapter {
  id: AdapterId;
  execute(mission: Mission): Promise<MissionReport>;
  healthCheck(): Promise<{ ok: boolean; latencyMs?: number }>;
}

export const adapters: Record<AdapterId, Adapter> = {
  qwen: qwenAdapter,
  dsh: dshAdapter,
  opencode: opencodeAdapter,
};
```

## 5.5 Tests por adaptador (obligatorio antes de siguiente fase)

Cada adaptador debe tener `*.test.ts` con mock de `fetch`/`spawn`:

* `qwen.test.ts` — mock Aliyun API, verifica JSON parse.
* `deepseek.test.ts` — mock `createWorktree`, verifica prompt frontmatter.
* `opencode.test.ts` — mock `Bun.spawn`, verifica `AGENTS.md` + args `--format json`.

# Qwen Chat Asistente — Diseño Escalable (FASE 6b)

> Ruta separada `/qwen-chat`, persistente en PG, streaming incremental, auto-misión, selector de modelos, login en caliente, preparado para Obsidian.

## 1. Visión

El Chat actual (`/`, `apps/web/app/page.tsx:1`) es un **formulario de Misión** (title/type/complexity/prompt → `POST /api/missions` → `Supervisor` → `git worktree`). No sirve para `Hola` o preguntas libres.

**Nuevo:** `/qwen-chat` — asistente conversacional **QwenMax-3.8** (Chat, sin API) que:
- Responde a `Hola`, preguntas generales, con historial persistente
- Si detecta intención de proyecto (`crea|genera|proyecto|API|CRUD`) auto-genera `Mission` y la ejecuta vía `Supervisor`
- Sobrevive a recargas, escala a múltiples conversaciones y a futuro ingesta Obsidian como fuente de conocimiento
- Streaming incremental (`chat:chunk`) y selector de modelo en UI

## 2. Arquitectura

```
Usuario ─ /qwen-chat (Next.js bubbles + selector + login btn)
            │ POST /api/qwen/chat {message, conversationId?, modelLabel}
            │ POST /api/qwen/chat/stream (SSE chat:chunk → chat:done + mission_created)
            ▼
        Hono Orquestador — qwenChatRouter
        ├─ PG: qwen_conversations (id, title, modelLabel) + qwen_messages (role, content)
        ├─ Mutex (p-queue concurrency:1) — qwen.chat.ts singleton PersistentContext
        ├─ Intent: heuristic + Qwen classifier (consultArchitectJson)
        │   ├─ chat → consultArchitectChatStream(message) → SSE
        │   └─ project → MissionGenerator (Qwen JSON) → MissionSchema → Supervisor.run() → report
        └─ qwen.chat.ts (%LOCALAPPDATA%\CerebroQwen\user-data, QwenMax-3.8)
              ↑
        Futuro: Obsidian vault → obsidian_documents (embedding) → RAG prepend a prompt
```

*Separación limpia:* `/qwen-chat` no toca `/api/missions` existente. Escalable sin acoplamiento.

## 3. Esquema DB (Drizzle)

```ts
// apps/orchestrator/src/db/schema.ts — nuevo
qwenConversations: {id varchar PK uuid, title varchar(120), modelLabel varchar(40), createdAt, updatedAt}
qwenMessages: {id uuid PK, conversationId FK, role enum[user,assistant,system], content text(65k), modelLabel, createdAt, index(conversationId, createdAt)}
qwenMemory: {id uuid, conversationId FK, summary text, embedding vector(1536) nullable} // RAG, sin pgvector aún = text
// Futuro Obsidian (solo reserva):
// obsidianDocuments: {id, vaultPath text, content text, mtime, embedding vector, chunkIndex}
```

*Por qué PG y no localStorage:* supervivencia a reload/dispositivo, consultable por Supervisor y futuro `dsh-memory-toolkit`. `localStorage` solo cache opcional.

Migración: `pnpm --filter @cerebro/orchestrator db:generate && db:migrate`

## 4. Backend Endpoints

| Método | Ruta | Body | Resp | Uso |
|---|---|---|---|---|
| POST | `/api/qwen/chat` | `{conversationId?, message, modelLabel?="QwenMax-3.8", history?}` | `{reply, conversationId, intent, missionId?}` | Chat no-stream (compat) |
| POST | `/api/qwen/chat/stream` | igual | `text/event-stream` (`chat:chunk`, `chat:done {conversationId}`, `chat:mission_created {missionId}`, `chat:error`) | UI streaming |
| GET | `/api/qwen/conversations` | — | `{conversations}` | Lista sidebar |
| GET | `/api/qwen/conversations/:id/messages` | — | `{messages}` | Historial |
| GET | `/api/qwen/health` | — | `{ok, latencyMs, error?}` | Badge + botón login |
| POST | `/api/qwen/login` | — | `{status:"opened"}` | Abre Chromium headful para login |

**Lógica `POST /chat/stream`:**
1. `conversationId` || `crypto.randomUUID()` → insert `qwenConversations` si nuevo
2. Insert `user` message
3. `mutex.runExclusive(async () => {`
4. Intent: `if /crea|genera|proyecto|build/i.test(message) || await classifierJson → project else chat`
5. Si `project`:
   - `draft = await consultArchitectJson<Mission>("Convierte a Mission JSON: "+message)`
   - `mission = MissionSchema.parse({...draft, missionId: uuid, createdAt: Date.now(), workspace:{repo:"." }})`
   - `route(mission)` + `supervisor.run(mission)` (background, emite SSE `mission_created`)
   - `reply = "He creado misión ${mission.title} → ${route.adapter} → ${report.status}"`
6. Si `chat`: `consultArchitectChatStream(message, onChunk → sse "chat:chunk")`
7. Insert `assistant` message + `qwenMemory` si hace falta
8. `})`

**Truncamiento:** para chat subir de 4000 a 32000 (no limitar). Para `MissionReport.summary` mantener 4000.

**Mutex:** `p-queue` o `let busy + queue FIFO`. Si `busy`, encola y responde `chat:queued`.

## 5. Streaming incremental — modificación `qwen.chat.ts:305`

Hoy `waitForStreamingEnd` espera a `Stop` hidden + polling `innerText` estable. Para stream:

```ts
export async function consultArchitectChatStream(objective, onChunk, opts) {
  // ... igual hasta textarea.fill + Enter
  let prev = "";
  while (true) {
    await page.waitForTimeout(400);
    const cur = await page.locator(assistant).last().innerText().catch(()=>prev);
    if (cur.length > prev.length) { onChunk(cur.slice(prev.length)); prev = cur; }
    const stopVisible = await page.locator(stop).first().isVisible().catch(()=>false);
    if (!stopVisible) {
      const regenVisible = await page.locator(regenerate).first().isVisible().catch(()=>false);
      if (regenVisible || prev.length>0) break;
    }
    if (Date.now()-start > timeoutMs) break;
  }
  return prev;
}
```

`consultArchitectChat` se vuelve wrapper que acumula.

## 6. Login en caliente

Hoy `healthCheckChat` retorna `QWEN_LOGIN_REQUIRED` si `login` selector visible. Hoy debes correr `setup-qwen-profile.ts --headful` manual.

**Nuevo:** Botón UI `Iniciar sesión Qwen` visible si `GET /health` → `ok:false` y `error==QWEN_LOGIN_REQUIRED`.

- Click → `POST /api/qwen/login` → orquestador `chromium.launchPersistentContext(userDataDir, {headless:false})` + `page.goto("https://chat.qwen.ai")` y **mantiene ventana abierta** (no `await close`).
- Front muestra `SSE qwen:login_status` + botón `Ya inicié sesión` que re-hace `GET /health`. Al cerrar el usuario, `ctx` queda con sesión persistida en `%LOCALAPPDATA%\CerebroQwen\user-data` (reutiliza tu `UserDataDir` ya confirmado con GitHub).

No se crea nuevo `userDataDir`; se reutiliza el existente.

## 7. Frontend `/qwen-chat`

**Ruta:** `apps/web/app/qwen-chat/page.tsx` (`"use client"`)

- Estado `conversations[]`, `activeId`, `messages[]` (fetch `GET /conversations/:id/messages`), `input`, `streamingText`, `modelLabel`
- Header: `Select` modelo (`QwenMax-3.8` default, `QwenMax`, `QwenTurbo`, `QwenPlus` → mapea a `QWEN_SELECTORS.modelOption*` en `qwen.selector.ts:91` ampliado), `Badge` health (poll 30s), `Button` login
- Main: `ScrollArea` bubbles (user `bg-white text-black` derecha, assistant `bg-zinc-900` izquierda), `Loader2` + `chat:chunk` incremental
- Footer: `Textarea` + `Send` (Enter), `fetch` `POST /stream` con `response.body.getReader()` para `chat:chunk`
- Sidebar: lista `conversations` (título = primer mensaje), `+ Nueva conversación`

**Cambios:**
- `apps/web/app/layout.tsx:1` — añadir `<Link href="/qwen-chat">Qwen Chat</Link>` (renombrar `Chat` → `Misiones`)
- `apps/web/lib/qwenApi.ts` nuevo: `sendQwenMessage`, `streamQwenMessage`, `listConversations`, `checkQwenHealth`, `startQwenLogin`

## 8. Obsidian — preparado sin implementar

- Dejar `qwenMessages.embedding` y `qwenMemory` para cuando se ingeste vault. `consultArchitectChatStream` aceptará `opts.ragContext?: string` que se prependea como `Contexto Obsidian:\n${chunks}\n\nPregunta: ${message}`.
- Futuro: `scripts/ingest-obsidian.ts` lee `vaultPath`, chunk, embedding, inserta `obsidian_documents`, y `qwenChatRouter` hace `vector search` antes de llamar Qwen.

## 9. Plan de ejecución (3 días)

- **Día 1:** DB `qwenConversations`/`qwenMessages` + migraciones, `routes/qwenChat.ts` (`POST /chat` sin stream, `GET health`, `GET conversations`), `qwenApi.ts` front stub, `layout` link.
- **Día 2:** `qwen.chat.ts` streaming (`consultArchitectChatStream` + `Mutex`), `POST /chat/stream` SSE, `app/qwen-chat/page.tsx` bubbles + `Select` modelo + `Badge` health.
- **Día 3:** `MissionGenerator` + auto `Supervisor.run` + `POST /qwen/login` en caliente + tests reales (`RUN_REAL_QWEN=1` ya existe en `qwen.test.ts:1`, extender con `stream` y `login`), docs y `iniciar.bat` actualizado.

**Criterio de salida:** `RUN_REAL_QWEN=1` → en `/qwen-chat` escribes `Hola`, ves streaming incremental de `QwenMax-3.8`, cambias a `QwenTurbo` y responde diferente, cierras sesión y botón restaura, escribes `crea API de notas` → se crea `Mission` visible en `Dashboard` y se ejecuta vía `Supervisor`.

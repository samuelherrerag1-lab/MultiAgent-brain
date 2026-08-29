import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { qwenConversations, qwenMessages, missions } from "../db/schema.ts";
import { eq, desc, asc } from "drizzle-orm";
import {
  consultArchitectChat,
  consultArchitectChatStream,
  healthCheckChat,
  startQwenHeadfulLogin,
} from "../bridges/qwen.ts";
import { MissionSchema, type Mission } from "@cerebro/shared/protocols";
import { route } from "../router/task-router.ts";

export const qwenChatRouter = new Hono();

let backgroundMissionExecutor: ((mission: Mission) => Promise<void>) | null = null;

export function setMissionExecutor(fn: (mission: Mission) => Promise<void>) {
  backgroundMissionExecutor = fn;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SendMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(65_536),
  modelLabel: z.string().default("QwenMax-3.8").optional(),
});

function isProjectIntent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 15) return false;
  const projectPatterns = [
    /^(crea|crear|genera|generar|implementa|implementar|construye|construir|desarrolla|desarrollar)\b/i,
    /\b(crea|crear|haz|genera|escribe)\s+(una?\s+)?(api|crud|modulo|servicio|endpoint|componente|pagina|script|bot|aplicacion|app)\b/i,
    /\b(refactoriza|refactorizar|optimiza|optimizar|corrige|arregla|repara)\s+(el|la|los|las|este|esta)?\b/i,
    /\b(añade|agrega|escribe)\s+(tests|pruebas|unit\s*tests)\b/i,
  ];
  return projectPatterns.some((pattern) => pattern.test(trimmed));
}

function generateMissionDraft(prompt: string, title?: string): Mission {
  const missionId = crypto.randomUUID();
  const rawTitle = title || (prompt.length > 50 ? prompt.slice(0, 47) + "..." : prompt);
  const cleanTitle = rawTitle.replace(/[\n\r]+/g, " ").trim();

  let type: Mission["type"] = "build";
  const lower = prompt.toLowerCase();
  if (lower.includes("test") || lower.includes("prueba")) type = "tests";
  else if (lower.includes("refactor")) type = "refactor";
  else if (lower.includes("arquitectura") || lower.includes("diseña") || lower.includes("plan")) type = "planificar_arquitectura";

  return {
    missionId,
    type,
    complexity: prompt.length > 300 ? "high" : "medium",
    title: cleanTitle.slice(0, 80),
    prompt: prompt.trim(),
    workspace: { repo: "." },
    acceptanceCriteria: [
      "El entregable cumple con los requerimientos descritos en el prompt",
      "El código generado compila y no introduce errores de sintaxis",
    ],
    priority: "normal",
    timeoutMs: 300_000,
    createdAt: Date.now(),
    attempt: 1,
  };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

// 1. Health check & login status
qwenChatRouter.get("/health", async (c) => {
  const health = await healthCheckChat();
  return c.json(health);
});

// 2. Iniciar sesión en caliente (lanza ventana headful)
qwenChatRouter.post("/login", async (c) => {
  try {
    startQwenHeadfulLogin().catch((err) => console.error("[qwen/login]", err));
    return c.json({ ok: true, status: "opened", message: "Ventana Chromium iniciada para login manual" });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// 3. Listar conversaciones
qwenChatRouter.get("/conversations", async (c) => {
  try {
    const { db } = await getDb();
    const rows = await db.select().from(qwenConversations).orderBy(desc(qwenConversations.updatedAt)).limit(50);
    return c.json({ conversations: rows });
  } catch (err) {
    console.error("[GET /api/qwen/conversations]", err);
    return c.json({ error: String(err) }, 500);
  }
});

// 4. Obtener mensajes de una conversación
qwenChatRouter.get("/conversations/:id/messages", async (c) => {
  const id = c.req.param("id");
  try {
    const { db } = await getDb();
    const rows = await db
      .select()
      .from(qwenMessages)
      .where(eq(qwenMessages.conversationId, id))
      .orderBy(asc(qwenMessages.createdAt));
    return c.json({ messages: rows });
  } catch (err) {
    console.error(`[GET /api/qwen/conversations/${id}/messages]`, err);
    return c.json({ error: String(err) }, 500);
  }
});

// 5. Chat síncrono (sin stream)
qwenChatRouter.post("/chat", zValidator("json", SendMessageSchema), async (c) => {
  const { conversationId: givenConvId, message, modelLabel = "QwenMax-3.8" } = c.req.valid("json");
  const { db } = await getDb();
  const convId = givenConvId || crypto.randomUUID();
  const now = new Date();

  try {
    if (!givenConvId) {
      const title = message.slice(0, 50).replace(/[\n\r]+/g, " ");
      await db.insert(qwenConversations).values({
        id: convId,
        title,
        modelLabel,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await db.update(qwenConversations).set({ updatedAt: now }).where(eq(qwenConversations.id, convId));
    }

    await db.insert(qwenMessages).values({
      id: crypto.randomUUID(),
      conversationId: convId,
      role: "user",
      content: message,
      modelLabel,
      createdAt: now,
    });

    if (isProjectIntent(message)) {
      const mission = generateMissionDraft(message);
      const decision = route(mission);

      await db.insert(missions).values({
        id: mission.missionId,
        type: mission.type,
        complexity: mission.complexity,
        title: mission.title,
        prompt: mission.prompt,
        status: "pending",
        workspaceRepo: mission.workspace.repo,
        acceptanceCriteria: mission.acceptanceCriteria,
        priority: mission.priority,
        timeoutMs: mission.timeoutMs,
        attempt: 1,
        adapter: decision.adapter,
      });

      if (backgroundMissionExecutor) {
        backgroundMissionExecutor(mission).catch((e) => console.error("[autoMission]", e));
      }

      const reply = `He detectado una solicitud de proyecto y he creado la misión **"${mission.title}"** (ID: \`${mission.missionId.slice(0, 8)}\`).\n\nEl router la ha asignado a **${decision.adapter.toUpperCase()}** (${decision.reason}). Puedes seguir el progreso en el Dashboard.`;

      await db.insert(qwenMessages).values({
        id: crypto.randomUUID(),
        conversationId: convId,
        role: "assistant",
        content: reply,
        modelLabel,
        createdAt: new Date(),
      });

      return c.json({
        reply,
        conversationId: convId,
        intent: "project",
        missionId: mission.missionId,
      });
    }

    const reply = await consultArchitectChat(message, { modelLabel });

    await db.insert(qwenMessages).values({
      id: crypto.randomUUID(),
      conversationId: convId,
      role: "assistant",
      content: reply,
      modelLabel,
      createdAt: new Date(),
    });

    return c.json({
      reply,
      conversationId: convId,
      intent: "chat",
    });
  } catch (err: any) {
    console.error("[POST /api/qwen/chat]", err);
    return c.json({ error: String(err) }, 500);
  }
});

// 6. Chat con streaming SSE
qwenChatRouter.post("/chat/stream", zValidator("json", SendMessageSchema), async (c) => {
  const { conversationId: givenConvId, message, modelLabel = "QwenMax-3.8" } = c.req.valid("json");
  const { db } = await getDb();
  const convId = givenConvId || crypto.randomUUID();
  const now = new Date();

  if (!givenConvId) {
    const title = message.slice(0, 50).replace(/[\n\r]+/g, " ");
    await db.insert(qwenConversations).values({
      id: convId,
      title,
      modelLabel,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db.update(qwenConversations).set({ updatedAt: now }).where(eq(qwenConversations.id, convId));
  }

  await db.insert(qwenMessages).values({
    id: crypto.randomUUID(),
    conversationId: convId,
    role: "user",
    content: message,
    modelLabel,
    createdAt: now,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      send("chat:started", { conversationId: convId, at: Date.now() });

      try {
        if (isProjectIntent(message)) {
          send("chat:chunk", { delta: "Detectada intención de proyecto. Generando misión...\n\n" });

          const mission = generateMissionDraft(message);
          const decision = route(mission);

          await db.insert(missions).values({
            id: mission.missionId,
            type: mission.type,
            complexity: mission.complexity,
            title: mission.title,
            prompt: mission.prompt,
            status: "pending",
            workspaceRepo: mission.workspace.repo,
            acceptanceCriteria: mission.acceptanceCriteria,
            priority: mission.priority,
            timeoutMs: mission.timeoutMs,
            attempt: 1,
            adapter: decision.adapter,
          });

          if (backgroundMissionExecutor) {
            backgroundMissionExecutor(mission).catch((e) => console.error("[autoMission]", e));
          }

          send("chat:mission_created", {
            missionId: mission.missionId,
            title: mission.title,
            adapter: decision.adapter,
          });

          const reply = `He creado la misión **"${mission.title}"** (ID: \`${mission.missionId.slice(0, 8)}\`).\n\nAsignada a **${decision.adapter.toUpperCase()}** (${decision.reason}). Puedes ver la ejecución en tiempo real en el Dashboard.`;
          send("chat:chunk", { delta: reply });

          await db.insert(qwenMessages).values({
            id: crypto.randomUUID(),
            conversationId: convId,
            role: "assistant",
            content: `Detectada intención de proyecto. Generando misión...\n\n${reply}`,
            modelLabel,
            createdAt: new Date(),
          });

          send("chat:done", { conversationId: convId, missionId: mission.missionId });
          controller.close();
          return;
        }

        let fullReply = "";
        fullReply = await consultArchitectChatStream(
          message,
          (chunk) => {
            send("chat:chunk", { delta: chunk });
          },
          { modelLabel },
        );

        await db.insert(qwenMessages).values({
          id: crypto.randomUUID(),
          conversationId: convId,
          role: "assistant",
          content: fullReply,
          modelLabel,
          createdAt: new Date(),
        });

        send("chat:done", { conversationId: convId });
        controller.close();
      } catch (err: any) {
        console.error("[SSE /api/qwen/chat/stream error]", err);
        send("chat:error", { error: err.message || String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

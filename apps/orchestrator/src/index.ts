import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { MissionSchema, MissionReportSchema } from "@cerebro/shared/protocols";
import { getDb } from "./db/client.ts";
import { missions, missionReports } from "./db/schema.ts";
import { eq, desc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export const app = new Hono();

// Middleware global
app.use("*", logger());
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/health", (c) => {
  return c.json({ ok: true, service: "cerebro-orchestrator", version: "0.1.0", timestamp: Date.now() });
});

app.get("/api/health", (c) => {
  return c.json({ ok: true, service: "cerebro-orchestrator", version: "0.1.0" });
});

// ---------------------------------------------------------------------------
// Missions — CRUD básico (FASE 1, sin Router/Supervisor aún)
// ---------------------------------------------------------------------------

// Schema para crear misión (sin missionId/createdAt, los genera el servidor)
const CreateMissionSchema = MissionSchema.omit({ missionId: true, createdAt: true, attempt: true }).extend({
  attempt: z.number().int().min(1).default(1).optional(),
});

app.get("/api/missions", async (c) => {
  try {
    const { db } = await getDb();
    const rows = await db.select().from(missions).orderBy(desc(missions.createdAt)).limit(100);
    return c.json({ missions: rows });
  } catch (err) {
    console.error("[GET /api/missions]", err);
    return c.json({ error: String(err) }, 500);
  }
});

app.get("/api/missions/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const { db } = await getDb();
    const [mission] = await db.select().from(missions).where(eq(missions.id, id)).limit(1);
    if (!mission) return c.json({ error: "Mission not found" }, 404);
    const [report] = await db.select().from(missionReports).where(eq(missionReports.missionId, id)).limit(1);
    return c.json({ mission, report: report || null });
  } catch (err) {
    console.error(`[GET /api/missions/${id}]`, err);
    return c.json({ error: String(err) }, 500);
  }
});

app.post("/api/missions", zValidator("json", CreateMissionSchema), async (c) => {
  const body = c.req.valid("json");
  const missionId = crypto.randomUUID();
  const now = Date.now();

  const mission = MissionSchema.parse({
    ...body,
    missionId,
    createdAt: now,
    attempt: body.attempt ?? 1,
  });

  try {
    const { db } = await getDb();
    await db.insert(missions).values({
      id: mission.missionId,
      type: mission.type,
      complexity: mission.complexity,
      title: mission.title,
      prompt: mission.prompt,
      status: "pending",
      workspaceRepo: mission.workspace.repo,
      workspaceBranch: mission.workspace.branch,
      worktreePath: mission.workspace.worktree,
      baseCommit: mission.workspace.baseCommit,
      contextFiles: mission.contextFiles,
      acceptanceCriteria: mission.acceptanceCriteria,
      toolsAllowed: mission.toolsAllowed,
      priority: mission.priority,
      timeoutMs: mission.timeoutMs,
      traceId: mission.traceId,
      attempt: mission.attempt,
      adapter: null,
    });

    // SSE: emitir evento (en FASE 5 se conectará a Supervisor)
    // Por ahora solo guardamos en PG, el polling del Kanban lo lee.

    return c.json({ mission }, 201);
  } catch (err) {
    console.error("[POST /api/missions]", err);
    return c.json({ error: String(err) }, 500);
  }
});

// Actualizar reporte de misión (usado por adaptadores)
app.put("/api/missions/:id/report", zValidator("json", MissionReportSchema), async (c) => {
  const id = c.req.param("id");
  const report = c.req.valid("json");

  if (report.missionId !== id) {
    return c.json({ error: "missionId mismatch" }, 400);
  }

  try {
    const { db } = await getDb();
    const [mission] = await db.select().from(missions).where(eq(missions.id, id)).limit(1);
    if (!mission) return c.json({ error: "Mission not found" }, 404);

    // Upsert report — cast por exactOptionalPropertyTypes
    const reportValues = {
      id: report.missionId,
      missionId: report.missionId,
      status: report.status,
      adapter: report.adapter,
      summary: report.summary,
      artifacts: report.artifacts as any,
      testResults: report.testResults as any,
      decisions: report.decisions as any,
      traceId: report.traceId,
      durationMs: report.durationMs,
      error: report.error as any,
      nextActions: report.nextActions as any,
    } as any;

    await db
      .insert(missionReports)
      .values(reportValues)
      .onConflictDoUpdate({
        target: missionReports.id,
        set: {
          status: report.status,
          adapter: report.adapter,
          summary: report.summary,
          artifacts: report.artifacts as any,
          testResults: report.testResults as any,
          decisions: report.decisions as any,
          durationMs: report.durationMs,
          error: report.error as any,
          nextActions: report.nextActions as any,
        } as any,
      });

    // Actualizar status de misión
    const missionStatus = report.status === "success" ? "success" : report.status === "failed" ? "failed" : report.status;
    await db.update(missions).set({ status: missionStatus, updatedAt: new Date() }).where(eq(missions.id, id));

    return c.json({ ok: true, report });
  } catch (err) {
    console.error(`[PUT /api/missions/${id}/report]`, err);
    return c.json({ error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// SSE — streaming de misiones (FASE 1: polling simple, FASE 6: logs reales)
// ---------------------------------------------------------------------------
app.get("/api/missions/:id/stream", async (c) => {
  const id = c.req.param("id");

  // Hono SSE helper manual
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("connected", { missionId: id, at: Date.now() });

      // Poll cada 1s durante 30s (FASE 1 simple; FASE 6 usará pub/sub)
      let ticks = 0;
      const interval = setInterval(async () => {
        ticks++;
        try {
          const { db } = await getDb();
          const [mission] = await db.select().from(missions).where(eq(missions.id, id)).limit(1);
          if (mission) {
            send("mission:update", mission);
            if (["success", "failed", "aborted"].includes(mission.status) || ticks > 30) {
              clearInterval(interval);
              send("done", { status: mission.status });
              controller.close();
            }
          } else if (ticks > 5) {
            clearInterval(interval);
            send("error", { message: "Mission not found" });
            controller.close();
          }
        } catch (err) {
          send("error", { message: String(err) });
        }
      }, 1000);

      // Cleanup si cliente desconecta
      c.req.raw.signal?.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {}
      });
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

// 404
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const port = Number(process.env.PORT || 3001);

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("index.ts")) {
  // Solo auto-serve si se ejecuta directamente (no en tests)
  if (process.env.NODE_ENV !== "test") {
    console.log(`[cerebro] starting on port ${port}...`);
    serve({ fetch: app.fetch, port }, (info) => {
      console.log(`[cerebro] listening on http://localhost:${info.port}`);
      console.log(`[cerebro] health: http://localhost:${info.port}/health`);
    });
  }
}

export type AppType = typeof app;

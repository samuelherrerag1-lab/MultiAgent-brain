import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { MissionSchema, MissionReportSchema, type Mission } from "@cerebro/shared/protocols";
import { getDb } from "./db/client.ts";
import { missions, missionReports, decisions } from "./db/schema.ts";
import { eq, desc } from "drizzle-orm";
import { route } from "./router/task-router.ts";
import { Supervisor } from "./router/supervisor.ts";
import { scanMissionForBlockedCommands, qualityGate } from "./governance/guard.ts";
import { opencodeAdapter } from "./adapters/opencode.ts";
import { deepSeekAdapter } from "./adapters/deepseek.ts";
import { qwenAdapter } from "./bridges/qwen.ts";
import { qwenChatRouter, setMissionExecutor } from "./routes/qwen-chat.ts";
import type { AdapterId } from "@cerebro/shared/protocols";

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
// Router + Supervisor + Governance (FASE 5)
// ---------------------------------------------------------------------------

const adapters: Record<AdapterId, any> = {
  opencode: opencodeAdapter,
  dsh: deepSeekAdapter,
  qwen: qwenAdapter,
};

function getSupervisor() {
  return new Supervisor({ adapters });
}

async function persistDecision(missionId: string, report: any) {
  try {
    if (!report.decisions?.length) return;
    const { db } = await getDb();
    for (const d of report.decisions) {
      await db.insert(decisions).values({
        id: crypto.randomUUID(),
        missionId,
        decision: d.decision,
        rationale: d.rationale,
      });
    }
  } catch (err) {
    console.warn("[persistDecision]", err);
  }
}

async function executeMissionInBackground(mission: Mission) {
  const { db } = await getDb();
  await db.update(missions).set({ status: "running", updatedAt: new Date() }).where(eq(missions.id, mission.missionId));

  const supervisor = getSupervisor();
  let report: any;

  try {
    const result = await supervisor.run(mission);
    report = result.report;

    await db
      .insert(missionReports)
      .values({
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
      } as any)
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

    const finalStatus = report.status === "success" ? "success" : report.status === "failed" ? "failed" : report.status;
    await db.update(missions).set({ status: finalStatus, updatedAt: new Date(), adapter: report.adapter }).where(eq(missions.id, mission.missionId));

    await persistDecision(mission.missionId, report);
    console.log(`[executeMission] ${mission.missionId} -> ${report.status} via ${report.adapter} (${result.iterations} iter, escalated=${result.escalated})`);
  } catch (err) {
    //确保错误时任务状态为failed，不会在dashboard卡在running
    try {
      await db.update(missions).set({ status: "failed", updatedAt: new Date() }).where(eq(missions.id, mission.missionId));
    } catch {}
    console.error("[executeMissionInBackground] error:", err);
    throw err;
  }
}

setMissionExecutor(executeMissionInBackground);

// ---------------------------------------------------------------------------
// Missions — CRUD + Router/Supervisor (FASE 5)
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

  // Governance: scan bloqueados
  const blocked = scanMissionForBlockedCommands(mission);
  if (blocked.blocked) {
    // Sin aprobación, marcar needs_review y no ejecutar
    try {
      const { db } = await getDb();
      await db.insert(missions).values({
        id: mission.missionId,
        type: mission.type,
        complexity: mission.complexity,
        title: mission.title,
        prompt: mission.prompt,
        status: "needs_review",
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
    } catch {}
    return c.json({ error: `Bloqueado por gobernanza: ${blocked.pattern}`, blocked: true, mission, approvalRequired: true }, 403);
  }

  const decision = route(mission);

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
      adapter: decision.adapter,
    });

    // Ejecutar en background si ?execute != false
    const shouldExecute = c.req.query("execute") !== "false";
    if (shouldExecute) {
      // No esperar — background
      executeMissionInBackground(mission).catch((e) => console.error("[executeMissionInBackground]", e));
      // Marcar running inmediatamente para SSE
      await db.update(missions).set({ status: "running", updatedAt: new Date() }).where(eq(missions.id, mission.missionId));
    }

    return c.json({ mission, route: decision }, 201);
  } catch (err) {
    console.error("[POST /api/missions]", err);
    return c.json({ error: String(err) }, 500);
  }
});

// Ejecutar misión existente manualmente
app.post("/api/missions/:id/run", async (c) => {
  const id = c.req.param("id");
  try {
    const { db } = await getDb();
    const [row] = await db.select().from(missions).where(eq(missions.id, id)).limit(1);
    if (!row) return c.json({ error: "Mission not found" }, 404);
    if (row.status === "running") return c.json({ error: "Mission already running" }, 409);

    // Reconstruir Mission desde row
    const mission: Mission = {
      missionId: row.id,
      type: row.type as any,
      complexity: row.complexity as any,
      title: row.title,
      prompt: row.prompt,
      workspace: { repo: row.workspaceRepo, branch: row.workspaceBranch || undefined, worktree: row.worktreePath || undefined, baseCommit: row.baseCommit || undefined },
      contextFiles: row.contextFiles || undefined,
      acceptanceCriteria: row.acceptanceCriteria,
      toolsAllowed: row.toolsAllowed || undefined,
      priority: row.priority as any,
      timeoutMs: row.timeoutMs,
      traceId: row.traceId || undefined,
      createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
      attempt: row.attempt,
    };

    const blocked = scanMissionForBlockedCommands(mission);
    if (blocked.blocked) {
      return c.json({ error: `Bloqueado: ${blocked.pattern}`, blocked: true }, 403);
    }

    await db.update(missions).set({ status: "running", updatedAt: new Date() }).where(eq(missions.id, id));
    executeMissionInBackground(mission).catch((e) => console.error("[run]", e));
    return c.json({ ok: true, missionId: id, status: "running" });
  } catch (err) {
    console.error(`[POST /api/missions/${id}/run]`, err);
    return c.json({ error: String(err) }, 500);
  }
});

// Aprobar misión bloqueada (needs_review → pending + ejecutar)
app.post("/api/missions/:id/approve", async (c) => {
  const id = c.req.param("id");
  try {
    const { db } = await getDb();
    const [row] = await db.select().from(missions).where(eq(missions.id, id)).limit(1);
    if (!row) return c.json({ error: "Mission not found" }, 404);
    if (row.status !== "needs_review") return c.json({ error: `No está en needs_review (actual: ${row.status})` }, 400);

    await db.update(missions).set({ status: "pending", updatedAt: new Date() }).where(eq(missions.id, id));

    const mission: Mission = {
      missionId: row.id,
      type: row.type as any,
      complexity: row.complexity as any,
      title: row.title,
      prompt: row.prompt,
      workspace: { repo: row.workspaceRepo },
      acceptanceCriteria: row.acceptanceCriteria,
      priority: row.priority as any,
      timeoutMs: row.timeoutMs,
      createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
      attempt: row.attempt,
    };

    await db.update(missions).set({ status: "running", updatedAt: new Date() }).where(eq(missions.id, id));
    executeMissionInBackground(mission).catch((e) => console.error("[approve]", e));
    return c.json({ ok: true, status: "running" });
  } catch (err) {
    console.error(`[POST /api/missions/${id}/approve]`, err);
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

      // Poll cada 1s durante hasta 300s (5min)
      let ticks = 0;
      const interval = setInterval(async () => {
        ticks++;
        try {
          const { db } = await getDb();
          const [mission] = await db.select().from(missions).where(eq(missions.id, id)).limit(1);
          if (mission) {
            send("mission:update", mission);
            if (["success", "failed", "aborted"].includes(mission.status) || ticks >= 300) {
              clearInterval(interval);
              send("done", { status: mission.status });
              controller.close();
            }
          } else if (ticks > 10) {
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

// Qwen Chat Asistente (FASE 6b)
app.route("/api/qwen", qwenChatRouter);

// 404
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

// ---------------------------------------------------------------------------
// Boot & Graceful Shutdown
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

    const shutdown = async () => {
      await qwenAdapter.close().catch(() => {});
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

export type AppType = typeof app;

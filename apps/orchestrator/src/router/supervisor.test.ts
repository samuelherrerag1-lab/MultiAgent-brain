import { describe, it, expect, vi } from "vitest";
import { Supervisor, SUPERVISOR_CONFIG } from "./supervisor.ts";
import type { Mission, MissionReport, AdapterId } from "@cerebro/shared/protocols";
import type { Adapter } from "../adapters/types.ts";

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    missionId: crypto.randomUUID(),
    type: "build",
    complexity: "medium",
    title: "Supervisor test",
    prompt: "Prompt suficientemente largo para pasar validación y ejecutar test supervisor.",
    workspace: { repo: "." },
    acceptanceCriteria: ["criterio 1 largo suficiente para supervisor"],
    createdAt: Date.now(),
    priority: "normal",
    timeoutMs: 10_000,
    attempt: 1,
    ...overrides,
  } as Mission;
}

function fakeAdapter(
  id: AdapterId,
  behavior: (mission: Mission, call: number, signal?: AbortSignal) => Promise<MissionReport>,
): Adapter & { calls: number } {
  let calls = 0;
  const adapter: Adapter & { calls: number } = {
    id,
    get calls() {
      return calls;
    },
    async healthCheck() {
      return { ok: true };
    },
    async execute(mission: Mission, opts?: { signal?: AbortSignal }) {
      calls++;
      return behavior(mission, calls, opts?.signal);
    },
  };
  return adapter;
}

describe("Supervisor — retry y gate", () => {
  it("éxito al primer intento (dsh)", async () => {
    const mission = makeMission({ type: "build", complexity: "medium" });
    const dsh = fakeAdapter("dsh", async (m) => ({
      missionId: m.missionId,
      status: "success",
      adapter: "dsh",
      summary: "ok",
      artifacts: [],
      durationMs: 10,
    }));
    const qwen = fakeAdapter("qwen", async (m) => ({
      missionId: m.missionId,
      status: "success",
      adapter: "qwen",
      summary: "qwen ok",
      artifacts: [],
      durationMs: 10,
    }));
    const opencode = fakeAdapter("opencode", async (m) => ({
      missionId: m.missionId,
      status: "success",
      adapter: "opencode",
      summary: "op ok",
      artifacts: [],
      durationMs: 10,
    }));

    const sup = new Supervisor({ adapters: { dsh, qwen, opencode } as any });
    const result = await sup.run(mission);
    expect(result.report.status).toBe("success");
    expect(result.report.adapter).toBe("dsh");
    expect(result.iterations).toBe(1);
    expect(result.escalated).toBe(false);
    expect(dsh.calls).toBe(1);
  });

  it("reintenta 3 veces con mismo adapter si gate falla por tests", async () => {
    const mission = makeMission({ type: "build", complexity: "low" });
    let call = 0;
    const dsh = fakeAdapter("dsh", async (m) => {
      call++;
      if (call < 3) {
        return {
          missionId: m.missionId,
          status: "success",
          adapter: "dsh",
          summary: "ok pero tests fallan",
          artifacts: [],
          durationMs: 10,
          testResults: { passed: 1, failed: 1 },
        };
      }
      return {
        missionId: m.missionId,
        status: "success",
        adapter: "dsh",
        summary: "ok final",
        artifacts: [],
        durationMs: 10,
        testResults: { passed: 2, failed: 0 },
      };
    });
    const qwen = fakeAdapter("qwen", async (m) => ({
      missionId: m.missionId,
      status: "success",
      adapter: "qwen",
      summary: "qwen",
      artifacts: [],
      durationMs: 10,
    }));
    const opencode = fakeAdapter("opencode", async (m) => ({
      missionId: m.missionId,
      status: "success",
      adapter: "opencode",
      summary: "op",
      artifacts: [],
      durationMs: 10,
    }));

    const sup = new Supervisor({ adapters: { dsh, qwen, opencode } as any });
    const result = await sup.run(mission);
    expect(result.report.status).toBe("success");
    expect(result.iterations).toBe(3);
    expect(dsh.calls).toBe(3);
  });

  it("fallback a opencode si dsh falla 3 veces, luego qwen si sigue fallando", async () => {
    const mission = makeMission({ type: "build", complexity: "low" });
    const dsh = fakeAdapter("dsh", async (m) => ({
      missionId: m.missionId,
      status: "failed",
      adapter: "dsh",
      summary: "dsh fail",
      artifacts: [],
      durationMs: 10,
      error: { message: "dsh error" },
    }));
    const opencode = fakeAdapter("opencode", async (m) => ({
      missionId: m.missionId,
      status: "failed",
      adapter: "opencode",
      summary: "op fail",
      artifacts: [],
      durationMs: 10,
      error: { message: "op fail" },
    }));
    const qwen = fakeAdapter("qwen", async (m) => ({
      missionId: m.missionId,
      status: "success",
      adapter: "qwen",
      summary: "qwen success after escalate",
      artifacts: [],
      durationMs: 10,
    }));

    const sup = new Supervisor({ adapters: { dsh, qwen, opencode } as any });
    const result = await sup.run(mission);
    // Debe escalar a qwen tras agotar reintentos + fallbacks
    expect(result.escalated).toBe(true);
    expect(result.report.adapter).toBe("qwen");
    expect(result.report.status).toBe("success");
    expect(result.iterations).toBeGreaterThanOrEqual(3);
  });

  it("escala a qwen con traceback si falla 3 veces y es build", async () => {
    const mission = makeMission({ type: "build", complexity: "medium", prompt: "prompt largo para build test supervisor" });
    const dsh = fakeAdapter("dsh", async (m) => ({
      missionId: m.missionId,
      status: "failed",
      adapter: "dsh",
      summary: "fail",
      artifacts: [],
      durationMs: 10,
      error: { message: "traceback error details", stack: "stack..." },
    }));
    const qwen = fakeAdapter("qwen", async (m) => {
      // Verificar que el prompt escalado contiene traceback
      expect(m.prompt).toContain("TRACEBACK");
      expect(m.type).toBe("resolver_bloqueo");
      return {
        missionId: m.missionId,
        status: "success",
        adapter: "qwen",
        summary: "qwen resuelve bloqueo",
        artifacts: [],
        durationMs: 10,
      };
    });
    const opencode = fakeAdapter("opencode", async (m) => ({
      missionId: m.missionId,
      status: "failed",
      adapter: "opencode",
      summary: "fail",
      artifacts: [],
      durationMs: 10,
      error: { message: "op fail" },
    }));

    const sup = new Supervisor({ adapters: { dsh, qwen, opencode } as any });
    const result = await sup.run(mission);
    expect(result.escalated).toBe(true);
    expect(qwen.calls).toBeGreaterThanOrEqual(1);
  });

  it("kill tras maxIterations (5)", async () => {
    const mission = makeMission({ timeoutMs: 5000 });
    const dsh = fakeAdapter("dsh", async (m) => ({
      missionId: m.missionId,
      status: "failed",
      adapter: "dsh",
      summary: "always fail",
      artifacts: [],
      durationMs: 10,
      error: { message: "fail" },
    }));
    const qwen = fakeAdapter("qwen", async (m) => ({
      missionId: m.missionId,
      status: "failed",
      adapter: "qwen",
      summary: "always fail qwen",
      artifacts: [],
      durationMs: 10,
      error: { message: "fail qwen" },
    }));
    const opencode = fakeAdapter("opencode", async (m) => ({
      missionId: m.missionId,
      status: "failed",
      adapter: "opencode",
      summary: "fail op",
      artifacts: [],
      durationMs: 10,
      error: { message: "fail" },
    }));

    const sup = new Supervisor({ adapters: { dsh, qwen, opencode } as any });
    const result = await sup.run(mission);
    expect(result.iterations).toBe(SUPERVISOR_CONFIG.maxIterations);
    expect(result.report.status).toBe("failed");
  });

  it("abort via signal", async () => {
    const mission = makeMission({ timeoutMs: 60000 });
    const dsh = fakeAdapter("dsh", async (m, _call, signal) => {
      // Simular trabajo largo que respeta abort
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 5000);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("abort"));
        });
      });
      return {
        missionId: m.missionId,
        status: "success",
        adapter: "dsh",
        summary: "should be aborted",
        artifacts: [],
        durationMs: 10,
      };
    });
    const qwen = fakeAdapter("qwen", async (m) => ({
      missionId: m.missionId,
      status: "success",
      adapter: "qwen",
      summary: "qwen",
      artifacts: [],
      durationMs: 10,
    }));
    const opencode = fakeAdapter("opencode", async (m) => ({
      missionId: m.missionId,
      status: "success",
      adapter: "opencode",
      summary: "op",
      artifacts: [],
      durationMs: 10,
    }));

    const controller = new AbortController();
    const sup = new Supervisor({ adapters: { dsh, qwen, opencode } as any });
    setTimeout(() => controller.abort(), 100);
    const result = await sup.run(mission, { signal: controller.signal });
    // Debe abortar y retornar aborted o failed con iterations 1
    expect(["aborted", "failed"].includes(result.report.status)).toBe(true);
  });
});

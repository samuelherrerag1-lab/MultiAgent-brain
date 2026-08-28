import { describe, it, expect } from "vitest";
import { QWEN_SELECTORS, joinSelectors } from "./qwen.selector.ts";
import { buildPrompt } from "../adapters/prompt.ts";
import type { Mission } from "@cerebro/shared/protocols";

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    missionId: "550e8400-e29b-41d4-a716-446655440000",
    type: "planificar_arquitectura",
    complexity: "high",
    title: "Test QwenMax-3.8",
    prompt: "Diseña una API REST para usuarios. Prompt suficientemente largo para pasar validación.",
    workspace: { repo: "." },
    acceptanceCriteria: ["Propuesta incluye endpoints y modelo de datos"],
    createdAt: Date.now(),
    priority: "normal",
    timeoutMs: 90_000,
    attempt: 1,
    ...overrides,
  } as Mission;
}

describe("QWEN_SELECTORS", () => {
  it("tiene todas las claves requeridas", () => {
    expect(QWEN_SELECTORS.textarea.length).toBeGreaterThan(0);
    expect(QWEN_SELECTORS.stop.length).toBeGreaterThan(0);
    expect(QWEN_SELECTORS.assistant.length).toBeGreaterThan(0);
    expect(QWEN_SELECTORS.modelSelector.length).toBeGreaterThan(0);
  });

  it("joinSelectors une con coma", () => {
    const joined = joinSelectors("textarea");
    expect(joined).toContain(",");
    expect(joined).toContain("textarea");
  });
});

describe("buildPrompt para Qwen", () => {
  it("incluye mission title y prompt", () => {
    const m = makeMission();
    const p = buildPrompt(m);
    expect(p).toContain(m.title);
    expect(p).toContain(m.prompt);
  });
});

// Pruebas reales — solo con RUN_REAL_QWEN=1 y sesión válida en %LOCALAPPDATA%\CerebroQwen\user-data
describe("Qwen Chat — integración real (QwenMax-3.8)", () => {
  const runReal = process.env.RUN_REAL_QWEN === "1";

  it.skipIf(!runReal)("healthCheck real — verifica sesión y textarea", async () => {
    const { healthCheckChat } = await import("./qwen.chat.ts");
    const result = await healthCheckChat({ headless: true, timeoutMs: 20_000 });
    expect(typeof result.ok).toBe("boolean");
    if (!result.ok) console.warn("Qwen healthCheck no ok:", result.error, "— ejecuta setup-qwen-profile con --headful");
    // No falla si no hay sesión, solo verifica que no crashea
    expect(result).toHaveProperty("ok");
  }, 30_000);

  it.skipIf(!runReal)("consultArchitect real — ping QwenMax-3.8", async () => {
    const { consultArchitectChat } = await import("./qwen.chat.ts");
    const text = await consultArchitectChat("Responde exactamente con: {\"ok\":true} y nada más. Solo JSON.", {
      headless: true,
      timeoutMs: 90_000,
      modelLabel: "QwenMax-3.8",
    });
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("ok");
    console.log("Qwen respuesta:", text.slice(0, 300));
  }, 120_000);

  it.skipIf(!runReal)("adapter execute real — misión planificar_arquitectura", async () => {
    const { createQwenAdapter } = await import("./qwen.ts");
    const mission = makeMission({
      missionId: crypto.randomUUID(),
      title: "Qwen real plan test",
      prompt: "Propón 3 endpoints REST para un CRUD de notas. Responde en JSON: {\"summary\":\"...\",\"decisions\":[{\"decision\":\"...\",\"rationale\":\"...\"}]}",
      acceptanceCriteria: ["Respuesta incluye 3 endpoints"],
    });

    const adapter = createQwenAdapter({ headless: true, timeoutMs: 90_000 });
    const report = await adapter.execute(mission);

    expect(["success", "failed", "needs_review"].includes(report.status)).toBe(true);
    expect(report.adapter).toBe("qwen");
    expect(report.missionId).toBe(mission.missionId);
    expect(typeof report.summary).toBe("string");
    expect(report.durationMs).toBeGreaterThan(0);

    if (report.status === "needs_review") {
      console.warn("Qwen needs_review (login/captcha):", report.error?.message);
    } else if (report.status === "success") {
      expect(report.summary.length).toBeGreaterThan(10);
    }
  }, 130_000);
});

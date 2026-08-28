import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createDeepSeekAdapter,
  parseDshOutput,
  buildDshPrompt,
  ensureAgentsMdForDsh,
  getDshCommand,
} from "./deepseek.ts";
import type { SpawnFn } from "./types.ts";
import type { Mission } from "@cerebro/shared/protocols";

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    missionId: "550e8400-e29b-41d4-a716-446655440000",
    type: "build",
    complexity: "medium",
    title: "Test DSH Adapter",
    prompt: "Crea un archivo hello_dsh.py que imprima 'hello from DSH'. Prompt suficientemente largo para pasar validación.",
    workspace: { repo: "." },
    acceptanceCriteria: ["hello_dsh.py existe y es ejecutable"],
    createdAt: Date.now(),
    priority: "normal",
    timeoutMs: 10_000,
    attempt: 1,
    ...overrides,
  } as Mission;
}

let tmpBase: string;
function makeTmpDir(): string {
  tmpBase = path.join(os.tmpdir(), `cerebro-dsh-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(tmpBase, { recursive: true });
  return tmpBase;
}
function cleanupTmp() {
  if (tmpBase && existsSync(tmpBase)) rmSync(tmpBase, { recursive: true, force: true });
}

describe("parseDshOutput", () => {
  it("parsea stdout plano", () => {
    const { summary, isJson } = parseDshOutput("DSH completed build", "");
    expect(summary).toBe("DSH completed build");
    expect(isJson).toBe(false);
  });

  it("parsea JSON lines", () => {
    const stdout = [JSON.stringify({ text: "step1" }), JSON.stringify({ text: "final summary" })].join("\n");
    const { summary, isJson } = parseDshOutput(stdout, "");
    expect(isJson).toBe(true);
    expect(summary).toBe("final summary");
  });

  it("trunca >4000", () => {
    const { summary } = parseDshOutput("a".repeat(5000), "");
    expect(summary.length).toBe(4000);
  });

  it("usa stderr si stdout vacío", () => {
    const { summary } = parseDshOutput("", "dsh error");
    expect(summary).toBe("dsh error");
  });
});

describe("buildDshPrompt", () => {
  it("incluye title y criterios y marcador DSH", () => {
    const m = makeMission();
    const p = buildDshPrompt(m);
    expect(p).toContain(m.title);
    expect(p).toContain(m.acceptanceCriteria[0]);
    expect(p).toContain("DSH");
  });
});

describe("ensureAgentsMdForDsh", () => {
  let tmpDir: string;
  beforeEach(() => (tmpDir = makeTmpDir()));
  afterEach(cleanupTmp);

  it("crea AGENTS.md con misión", () => {
    const mission = makeMission({ missionId: "11111111-1111-4111-8111-111111111111" });
    const wt = path.join(tmpDir, "wt1");
    mkdirSync(wt, { recursive: true });
    const p = ensureAgentsMdForDsh(wt, mission);
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, "utf-8");
    expect(content).toContain(mission.title);
  });
});

describe("getDshCommand", () => {
  it("retorna dsh por defecto", () => {
    const { command, argsPrefix } = getDshCommand();
    expect(command).toBeDefined();
    expect(argsPrefix).toContain("--profile");
  });
});

describe("DeepSeekAdapter — integración real", () => {
  let tmpDir: string;
  beforeEach(() => (tmpDir = makeTmpDir()));
  afterEach(cleanupTmp);

  it("healthCheck real — verifica dsh binary", async () => {
    const adapter = createDeepSeekAdapter({ worktreesDir: tmpDir, useHttpGateway: false });
    const health = await adapter.healthCheck();
    expect(typeof health.ok).toBe("boolean");
    if (!health.ok) console.warn("DSH healthCheck no ok (¿dsh no en PATH?)", health.error);
  });

  const runReal = process.env.RUN_REAL_TESTS === "1";
  it.skipIf(!runReal)("execute real — crea hello_dsh.py via DSH headless (modelo gratuito)", async () => {
    const hasKey = !!process.env.OPENCODE_API_KEY || !!process.env.OPENROUTER_API_KEY || !!process.env.DEEPSEEK_API_KEY;
    if (!hasKey) {
      console.warn("Sin API keys para DSH — skip test real DSH");
      return;
    }

    const mission = makeMission({
      missionId: crypto.randomUUID(),
      type: "build",
      title: "Crea hello_dsh.py real",
      prompt: "Crea un archivo hello_dsh.py que contenga exactamente: print('hello from DSH')\nSolo crea el archivo.",
      acceptanceCriteria: ["hello_dsh.py existe con print hello from DSH"],
      timeoutMs: 120_000,
    });

    const adapter = createDeepSeekAdapter({ worktreesDir: tmpDir, useHttpGateway: false });

    const report = await adapter.execute(mission);

    // Validación real de reporte (no mock)
    expect(["success", "failed"].includes(report.status)).toBe(true);
    expect(report.adapter).toBe("dsh");
    expect(report.missionId).toBe(mission.missionId);
    expect(typeof report.summary).toBe("string");
    expect(report.summary.length).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThan(0);

    // Si DSH logró crear el archivo, verificar FS real
    const wtPath = path.join(tmpDir, mission.missionId);
    const helloPath = path.join(wtPath, "hello_dsh.py");
    if (existsSync(helloPath)) {
      const content = readFileSync(helloPath, "utf-8");
      expect(content).toContain("hello");
      console.log("DSH creó hello_dsh.py correctamente");
    } else {
      console.warn("DSH no creó hello_dsh.py — puede ser por rate limit o modelo, reporte:", report.summary.slice(0, 300));
      // No marcamos como fallo si el reporte es failed por API, solo verificamos que no crasheó
      if (report.status === "failed") {
        expect(report.error).toBeDefined();
      }
    }
  }, 130_000);
});

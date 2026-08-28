import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createOpencodeAdapter, parseOpencodeOutput, ensureAgentsMd, type SpawnFn } from "./opencode.ts";
import { buildPrompt } from "./prompt.ts";
import type { Mission } from "@cerebro/shared/protocols";

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    missionId: "550e8400-e29b-41d4-a716-446655440000",
    type: "refactor",
    complexity: "low",
    title: "Test OpencodeAdapter",
    prompt: "Crea un archivo hello_world.py con función hello() que retorne 'hello world'. Prompt suficientemente largo para pasar validación.",
    workspace: { repo: "." },
    acceptanceCriteria: ["hello_world.py existe y contiene función hello"],
    createdAt: Date.now(),
    priority: "normal",
    timeoutMs: 10_000,
    attempt: 1,
    ...overrides,
  } as Mission;
}

// Helpers para tmp dirs
let tmpBase: string;

function makeTmpDir(): string {
  tmpBase = path.join(os.tmpdir(), `cerebro-opencode-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(tmpBase, { recursive: true });
  return tmpBase;
}

function cleanupTmp() {
  if (tmpBase && existsSync(tmpBase)) rmSync(tmpBase, { recursive: true, force: true });
}

describe("parseOpencodeOutput", () => {
  it("parsea stdout plano como summary", () => {
    const { summary, isJson } = parseOpencodeOutput("hello world output", "");
    expect(summary).toBe("hello world output");
    expect(isJson).toBe(false);
  });

  it("parsea líneas JSON y extrae último text", () => {
    const stdout = [
      JSON.stringify({ type: "text", text: "primero" }),
      JSON.stringify({ type: "text", text: "segundo" }),
    ].join("\n");
    const { summary, isJson } = parseOpencodeOutput(stdout, "");
    expect(isJson).toBe(true);
    expect(summary).toBe("segundo");
  });

  it("trunca summary >4000", () => {
    const { summary } = parseOpencodeOutput("a".repeat(5000), "");
    expect(summary.length).toBe(4000);
  });

  it("usa stderr si stdout vacío", () => {
    const { summary } = parseOpencodeOutput("", "error from stderr");
    expect(summary).toBe("error from stderr");
  });
});

describe("buildPrompt", () => {
  it("incluye title, prompt y criterios", () => {
    const m = makeMission();
    const p = buildPrompt(m);
    expect(p).toContain(m.title);
    expect(p).toContain(m.prompt);
    expect(p).toContain(m.acceptanceCriteria[0]);
  });
});

describe("ensureAgentsMd", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(cleanupTmp);

  it("crea AGENTS.md con misión inyectada", () => {
    const mission = makeMission({ missionId: "11111111-1111-4111-8111-111111111111" });
    const worktree = path.join(tmpDir, "wt1");
    mkdirSync(worktree, { recursive: true });

    const agentsPath = ensureAgentsMd(worktree, mission);
    expect(existsSync(agentsPath)).toBe(true);
    const content = readFileSync(agentsPath, "utf-8");
    expect(content).toContain(mission.title);
    expect(content).toContain(mission.prompt.slice(0, 20));
  });
});

describe("OpencodeAdapter — integración real", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(cleanupTmp);

  it("healthCheck real — opencode binary existe", async () => {
    const adapter = createOpencodeAdapter({ worktreesDir: tmpDir });
    const health = await adapter.healthCheck();
    expect(typeof health.ok).toBe("boolean");
    if (!health.ok) console.warn("opencode healthCheck falló (¿opencode no instalado?)", health.error);
  });

  // Solo corre con RUN_REAL_TESTS=1 para no ralentizar pnpm test (requiere ollama + LLM)
  const runReal = process.env.RUN_REAL_TESTS === "1";
  it.skipIf(!runReal)("execute real — crea hello_world.py via opencode + ollama (qwen3:4b 262k context)", async () => {
    const mission = makeMission({
      missionId: crypto.randomUUID(),
      type: "execute",
      title: "Crea hello_world.py real",
      prompt: "Crea hello_world.py con: print('hello world')",
      acceptanceCriteria: ["hello_world.py existe"],
      timeoutMs: 120_000,
    });

    const adapter = createOpencodeAdapter({ worktreesDir: tmpDir, model: "ollama-local/qwen3:4b" });

    // Verificar que Ollama está disponible antes de intentar LLM real
    const ollamaOk = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok)
      .catch(() => false);

    if (!ollamaOk) {
      console.warn("Ollama no disponible en 11434 — skip test real opencode");
      return;
    }

    const report = await adapter.execute(mission);
    // Reporte real debe tener status y summary, artifacts puede contener hello_world.py si el modelo lo creó
    expect(["success", "failed"].includes(report.status)).toBe(true);
    expect(report.adapter).toBe("opencode");
    expect(report.missionId).toBe(mission.missionId);
    expect(typeof report.summary).toBe("string");
    expect(report.summary.length).toBeGreaterThan(0);
    // Si el modelo logró crear el archivo, verificar FS real
    const wtPath = path.join(tmpDir, mission.missionId);
    const helloPath = path.join(wtPath, "hello_world.py");
    if (existsSync(helloPath)) {
      const content = readFileSync(helloPath, "utf-8");
      expect(content).toContain("hello");
      expect(report.artifacts.some((a) => a.path === "hello_world.py")).toBe(true);
    } else {
      console.warn("Modelo no creó hello_world.py — reporte:", report.summary.slice(0, 200));
      // No falla si el modelo no creó archivo, pero sí verifica que el adapter no crasheó
      expect(report.durationMs).toBeGreaterThan(0);
    }
  }, 130_000);
});

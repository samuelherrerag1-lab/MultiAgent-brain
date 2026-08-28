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

describe("OpencodeAdapter — execute con mocks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(cleanupTmp);

  it("construye args correctos y	retorna success con artifacts", async () => {
    const mission = makeMission({ missionId: "22222222-2222-4222-8222-222222222222" });

    // Mock spawn que crea hello_world.py en el worktree y retorna JSON
    const mockSpawn: SpawnFn = async (_cmd, args, opts) => {
      expect(args).toContain("run");
      expect(args).toContain("--format");
      expect(args).toContain("json");
      expect(args).toContain("--dir");
      expect(args).toContain("--model");
      // Simular que el agente creó hello_world.py
      const dir = opts.cwd;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "hello_world.py"), "def hello():\n    return 'hello world'\n", "utf-8");
      const stdout = JSON.stringify({ type: "text", text: "Archivo hello_world.py creado con éxito" });
      return { stdout, stderr: "", exitCode: 0 };
    };

    const adapter = createOpencodeAdapter({ spawnFn: mockSpawn, worktreesDir: tmpDir });
    const report = await adapter.execute(mission);

    expect(report.status).toBe("success");
    expect(report.adapter).toBe("opencode");
    expect(report.missionId).toBe(mission.missionId);
    expect(report.summary).toContain("hello_world.py");
    // artifacts debe detectar hello_world.py
    expect(report.artifacts.some((a) => a.path === "hello_world.py")).toBe(true);
  });

  it("retorna failed si spawn exitCode !=0", async () => {
    const mission = makeMission({ missionId: "33333333-3333-4333-8333-333333333333" });
    const mockSpawn: SpawnFn = async () => ({ stdout: "", stderr: "model not found", exitCode: 1 });

    const adapter = createOpencodeAdapter({ spawnFn: mockSpawn, worktreesDir: tmpDir });
    const report = await adapter.execute(mission);

    expect(report.status).toBe("failed");
    expect(report.error).toBeDefined();
    expect(report.error?.message).toContain("model not found");
  });

  it("maneja spawn throw (binario no encontrado) como failed", async () => {
    const mission = makeMission({ missionId: "44444444-4444-4444-8444-444444444444" });
    const mockSpawn: SpawnFn = async () => {
      throw new Error("spawn ENOENT");
    };

    const adapter = createOpencodeAdapter({ spawnFn: mockSpawn, worktreesDir: tmpDir });
    const report = await adapter.execute(mission);

    expect(report.status).toBe("failed");
    expect(report.summary).toContain("ENOENT");
  });

  it("valida hello_world.py — caso de uso de Fase 2 (script prueba)", async () => {
    const mission = makeMission({
      missionId: "55555555-5555-4555-8555-555555555555",
      type: "execute",
      title: "Crea hello_world.py",
      prompt: "Crea un archivo hello_world.py en la raíz del worktree que al ejecutarse imprima 'hello world'.",
      acceptanceCriteria: ["hello_world.py existe", "python hello_world.py imprime hello world"],
    });

    const mockSpawn: SpawnFn = async (_cmd, _args, opts) => {
      const dir = opts.cwd;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "hello_world.py"), "print('hello world')\n", "utf-8");
      return { stdout: JSON.stringify({ text: "Creado hello_world.py" }), stderr: "", exitCode: 0 };
    };

    const adapter = createOpencodeAdapter({ spawnFn: mockSpawn, worktreesDir: tmpDir });
    const report = await adapter.execute(mission);

    expect(report.status).toBe("success");
    expect(report.artifacts).toBeDefined();
    const hasHello = report.artifacts.some((a) => a.path.includes("hello_world.py"));
    expect(hasHello).toBe(true);
    // Simular validación del reporte de retorno como pide Fase 2
    expect(report.missionId).toBe(mission.missionId);
  });

  it("respeta timeout y retorna durationMs", async () => {
    const mission = makeMission({ missionId: "66666666-6666-4666-8666-666666666666", timeoutMs: 5000 });
    const mockSpawn: SpawnFn = async () => {
      // Simular trabajo rápido
      return { stdout: "ok", stderr: "", exitCode: 0 };
    };
    const adapter = createOpencodeAdapter({ spawnFn: mockSpawn, worktreesDir: tmpDir });
    const start = Date.now();
    const report = await adapter.execute(mission);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.durationMs).toBeLessThan(2000);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("OpencodeAdapter — healthCheck", () => {
  it("retorna ok si opencode --version exit 0", async () => {
    const mockSpawn: SpawnFn = async () => ({ stdout: "1.18.23", stderr: "", exitCode: 0 });
    const adapter = createOpencodeAdapter({ spawnFn: mockSpawn, worktreesDir: os.tmpdir() });
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.latencyMs).toBeDefined();
  });

  it("retorna !ok si spawn falla", async () => {
    const mockSpawn: SpawnFn = async () => ({ stdout: "", stderr: "not found", exitCode: 1 });
    const adapter = createOpencodeAdapter({ spawnFn: mockSpawn, worktreesDir: os.tmpdir() });
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });
});

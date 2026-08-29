import { describe, it, expect } from "vitest";
import { checkBlockedCommand, scanMissionForBlockedCommands, qualityGate } from "./guard.ts";
import type { MissionReport } from "@cerebro/shared/protocols";

describe("checkBlockedCommand", () => {
  it("bloquea rm -rf /", () => {
    expect(checkBlockedCommand("rm -rf /").blocked).toBe(true);
    expect(checkBlockedCommand("rm -rf ~").blocked).toBe(true);
  });

  it("bloquea sudo", () => {
    expect(checkBlockedCommand("sudo apt install").blocked).toBe(true);
  });

  it("bloquea DROP DATABASE", () => {
    expect(checkBlockedCommand("DROP DATABASE foo").blocked).toBe(true);
  });

  it("bloquea git push --force", () => {
    expect(checkBlockedCommand("git push --force origin main").blocked).toBe(true);
  });

  it("permite comando normal", () => {
    expect(checkBlockedCommand("pnpm install").blocked).toBe(false);
    expect(checkBlockedCommand("git status").blocked).toBe(false);
  });

  it("scanMissionForBlockedCommands detecta en prompt", () => {
    const r = scanMissionForBlockedCommands({ prompt: "Ejecuta rm -rf / para limpiar" });
    expect(r.blocked).toBe(true);
  });
});

describe("qualityGate", () => {
  const baseMission = { acceptanceCriteria: ["criterio 1 largo suficiente"] } as any;

  it("pasa si success y sin testResults", () => {
    const report: MissionReport = {
      missionId: "550e8400-e29b-41d4-a716-446655440000",
      status: "success",
      adapter: "dsh",
      summary: "todo ok",
      artifacts: [],
      durationMs: 100,
    };
    expect(qualityGate(baseMission, report).passed).toBe(true);
  });

  it("falla si tests fallaron", () => {
    const report: MissionReport = {
      missionId: "550e8400-e29b-41d4-a716-446655440000",
      status: "success",
      adapter: "opencode",
      summary: "ok",
      artifacts: [],
      durationMs: 100,
      testResults: { passed: 2, failed: 1 },
    };
    const r = qualityGate(baseMission, report);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.reason).toContain("tests fallaron");
  });

  it("falla si needs_review", () => {
    const report: MissionReport = {
      missionId: "550e8400-e29b-41d4-a716-446655440000",
      status: "needs_review",
      adapter: "qwen",
      summary: "requiere aprobación",
      artifacts: [],
      durationMs: 100,
    };
    expect(qualityGate(baseMission, report).passed).toBe(false);
  });

  it("falla si summary indica no cumple", () => {
    const report: MissionReport = {
      missionId: "550e8400-e29b-41d4-a716-446655440000",
      status: "success",
      adapter: "dsh",
      summary: "No cumple el criterio 1",
      artifacts: [],
      durationMs: 100,
    };
    expect(qualityGate(baseMission, report).passed).toBe(false);
  });

  it("falla si coverage <30", () => {
    const report: MissionReport = {
      missionId: "550e8400-e29b-41d4-a716-446655440000",
      status: "success",
      adapter: "opencode",
      summary: "ok",
      artifacts: [],
      durationMs: 100,
      testResults: { passed: 10, failed: 0, coverage: 20 },
    };
    expect(qualityGate(baseMission, report).passed).toBe(false);
  });
});

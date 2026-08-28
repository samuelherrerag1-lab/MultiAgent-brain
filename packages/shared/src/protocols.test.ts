import { describe, it, expect } from "vitest";
import { MissionSchema, MissionReportSchema, MissionType } from "./protocols.ts";

const baseMission = {
  missionId: "550e8400-e29b-41d4-a716-446655440000",
  type: "build" as const,
  complexity: "medium" as const,
  title: "Crear API de usuarios CRUD",
  prompt: "Implementa CRUD de usuarios con Hono + Drizzle. Este prompt debe tener al menos 20 caracteres para pasar validación.",
  workspace: { repo: "." },
  acceptanceCriteria: ["POST /users crea usuario y retorna 201 con validación"],
  createdAt: Date.now(),
};

describe("MissionSchema", () => {
  it("valida misión correcta", () => {
    const result = MissionSchema.safeParse(baseMission);
    expect(result.success).toBe(true);
  });

  it("rechaza prompt vacío", () => {
    const result = MissionSchema.safeParse({ ...baseMission, prompt: "" });
    expect(result.success).toBe(false);
  });

  it("rechaza prompt muy corto (<20)", () => {
    const result = MissionSchema.safeParse({ ...baseMission, prompt: "corto" });
    expect(result.success).toBe(false);
  });

  it("rechaza title muy corto (<5)", () => {
    const result = MissionSchema.safeParse({ ...baseMission, title: "Hi" });
    expect(result.success).toBe(false);
  });

  it("rechaza tipo inválido", () => {
    const result = MissionSchema.safeParse({ ...baseMission, type: "invalido" });
    expect(result.success).toBe(false);
  });

  it("rechaza sin acceptanceCriteria", () => {
    const result = MissionSchema.safeParse({ ...baseMission, acceptanceCriteria: [] });
    expect(result.success).toBe(false);
  });

  it("rechaza acceptanceCriteria con item corto (<10)", () => {
    const result = MissionSchema.safeParse({ ...baseMission, acceptanceCriteria: ["corto"] });
    expect(result.success).toBe(false);
  });

  it("aplica defaults (priority, timeoutMs, attempt)", () => {
    const parsed = MissionSchema.parse(baseMission);
    expect(parsed.priority).toBe("normal");
    expect(parsed.timeoutMs).toBe(300_000);
    expect(parsed.attempt).toBe(1);
  });

  it("acepta todos los MissionType", () => {
    for (const type of MissionType.options) {
      const result = MissionSchema.safeParse({ ...baseMission, type });
      expect(result.success, `type ${type} should be valid`).toBe(true);
    }
  });

  it("rechaza missionId no uuid", () => {
    const result = MissionSchema.safeParse({ ...baseMission, missionId: "no-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("MissionReportSchema", () => {
  const baseReport = {
    missionId: "550e8400-e29b-41d4-a716-446655440000",
    status: "success" as const,
    adapter: "dsh" as const,
    summary: "Misión completada con éxito",
    durationMs: 1234,
  };

  it("valida reporte mínimo", () => {
    const result = MissionReportSchema.safeParse(baseReport);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.artifacts).toEqual([]);
  });

  it("valida reporte con artifacts y testResults", () => {
    const result = MissionReportSchema.safeParse({
      ...baseReport,
      artifacts: [{ path: "src/index.ts", kind: "file" }],
      testResults: { passed: 5, failed: 0, coverage: 85 },
    });
    expect(result.success).toBe(true);
  });

  it("rechaza status inválido", () => {
    const result = MissionReportSchema.safeParse({ ...baseReport, status: "unknown" });
    expect(result.success).toBe(false);
  });

  it("rechaza adapter inválido", () => {
    const result = MissionReportSchema.safeParse({ ...baseReport, adapter: "unknown" });
    expect(result.success).toBe(false);
  });

  it("rechaza summary muy largo (>4000)", () => {
    const result = MissionReportSchema.safeParse({ ...baseReport, summary: "a".repeat(4001) });
    expect(result.success).toBe(false);
  });
});

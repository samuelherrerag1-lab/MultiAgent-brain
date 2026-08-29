import { describe, it, expect } from "vitest";
import { route, getFallbackAdapter, FALLBACK_MATRIX } from "./task-router.ts";

describe("TaskRouter — route", () => {
  it("high + planificar_arquitectura → qwen", () => {
    expect(route({ type: "planificar_arquitectura", complexity: "high" }).adapter).toBe("qwen");
  });

  it("high + revisar_entregable → qwen", () => {
    expect(route({ type: "revisar_entregable", complexity: "high" }).adapter).toBe("qwen");
  });

  it("high + resolver_bloqueo → qwen", () => {
    expect(route({ type: "resolver_bloqueo", complexity: "high" }).adapter).toBe("qwen");
  });

  it("revisar_entregable low → qwen", () => {
    expect(route({ type: "revisar_entregable", complexity: "low" }).adapter).toBe("qwen");
  });

  it("refactor → opencode", () => {
    expect(route({ type: "refactor", complexity: "low" }).adapter).toBe("opencode");
    expect(route({ type: "refactor", complexity: "high" }).adapter).toBe("opencode");
  });

  it("tests → opencode", () => {
    expect(route({ type: "tests", complexity: "medium" }).adapter).toBe("opencode");
  });

  it("build → dsh", () => {
    expect(route({ type: "build", complexity: "medium" }).adapter).toBe("dsh");
  });

  it("execute → dsh", () => {
    expect(route({ type: "execute", complexity: "low" }).adapter).toBe("dsh");
  });

  it("planificar_arquitectura low → qwen", () => {
    expect(route({ type: "planificar_arquitectura", complexity: "low" }).adapter).toBe("qwen");
  });

  it("fallback desconocido → dsh", () => {
    expect(route({ type: "unknown" as any, complexity: "low" }).adapter).toBe("dsh");
  });

  it("retorna reason", () => {
    const r = route({ type: "build", complexity: "low" });
    expect(r.reason).toContain("dsh");
  });
});

describe("FALLBACK_MATRIX", () => {
  it("opencode fallback es dsh luego qwen", () => {
    expect(FALLBACK_MATRIX.opencode).toEqual(["dsh", "qwen"]);
  });

  it("getFallbackAdapter retorna correcto", () => {
    expect(getFallbackAdapter("opencode", 1)).toBe("dsh");
    expect(getFallbackAdapter("opencode", 2)).toBe("qwen");
    expect(getFallbackAdapter("opencode", 3)).toBeNull();
    expect(getFallbackAdapter("dsh", 1)).toBe("opencode");
    expect(getFallbackAdapter("qwen", 1)).toBe("dsh");
  });
});

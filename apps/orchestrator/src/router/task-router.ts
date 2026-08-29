import type { Mission, AdapterId } from "@cerebro/shared/protocols";

/**
 * TaskRouter — función pura que decide qué adaptador ejecuta cada misión.
 * Reglas hard (FASE 5):
 *  - complexity == high && type == planificar_arquitectura / revisar_entregable / resolver_bloqueo → qwen
 *  - type == refactor / tests → opencode
 *  - type == build / execute → dsh
 *  - fallback → dsh
 */

export type RouteDecision = {
  adapter: AdapterId;
  reason: string;
};

export function route(mission: Pick<Mission, "type" | "complexity">): RouteDecision {
  const { type, complexity } = mission;

  // Alta complejidad de planificación → QwenMax-3.8 (arquitecto)
  if (complexity === "high" && (type === "planificar_arquitectura" || type === "revisar_entregable" || type === "resolver_bloqueo")) {
    return { adapter: "qwen", reason: `high complexity + ${type} → qwen (arquitecto)` };
  }

  // Review / unblock siempre a Qwen aunque no sea high, por su capacidad de análisis
  if (type === "revisar_entregable" || type === "resolver_bloqueo") {
    return { adapter: "qwen", reason: `${type} → qwen` };
  }

  // Refactor / tests → Opencode (edición quirúrgica local, barato)
  if (type === "refactor" || type === "tests") {
    return { adapter: "opencode", reason: `${type} → opencode` };
  }

  // Build / execute → DSH (sandbox + subagentes + herramientas)
  if (type === "build" || type === "execute") {
    return { adapter: "dsh", reason: `${type} → dsh` };
  }

  // Planificar arquitectura sin high → también qwen (por definición es plan)
  if (type === "planificar_arquitectura") {
    return { adapter: "qwen", reason: `planificar_arquitectura → qwen` };
  }

  // Fallback
  return { adapter: "dsh", reason: `fallback ${type}/${complexity} → dsh` };
}

/**
 * Matriz de fallback si el adaptador primario falla.
 * Supervisor la usa para reintentar con otro adaptador antes de escalar a Qwen.
 */
export const FALLBACK_MATRIX: Record<AdapterId, AdapterId[]> = {
  opencode: ["dsh", "qwen"],
  dsh: ["opencode", "qwen"],
  qwen: ["dsh", "opencode"],
};

export function getFallbackAdapter(failedAdapter: AdapterId, attempt: number): AdapterId | null {
  const fallbacks = FALLBACK_MATRIX[failedAdapter] || [];
  return fallbacks[attempt - 1] ?? null;
}

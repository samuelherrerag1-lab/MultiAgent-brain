import type { Mission, MissionReport, AdapterId } from "@cerebro/shared/protocols";
import type { Adapter } from "../adapters/types.ts";
import { route, getFallbackAdapter } from "./task-router.ts";
import { qualityGate } from "../governance/guard.ts";
import { buildPrompt } from "../adapters/prompt.ts";

export const SUPERVISOR_CONFIG = {
  maxRetries: 3, // reintentos con mismo adaptador antes de fallback/escalado
  maxIterations: 5, // iteraciones totales (incluye escalados)
  defaultTimeoutMs: 600_000, // 10 min por misión
  escalateAdapter: "qwen" as AdapterId, // tras 3 fallos, escala a Qwen con traceback
} as const;

export type SupervisorDeps = {
  adapters: Record<AdapterId, Adapter>;
  // Para testear sin DB real, se inyecta persistencia mínima
  onProgress?: (event: SupervisorEvent) => void;
};

export type SupervisorEvent =
  | { type: "start"; missionId: string; adapter: AdapterId; attempt: number }
  | { type: "retry"; missionId: string; adapter: AdapterId; attempt: number; reason: string }
  | { type: "fallback"; missionId: string; from: AdapterId; to: AdapterId; attempt: number }
  | { type: "escalate"; missionId: string; to: AdapterId; traceback: string }
  | { type: "gate_failed"; missionId: string; reason: string }
  | { type: "done"; missionId: string; report: MissionReport; iterations: number }
  | { type: "killed"; missionId: string; reason: string };

export type SupervisorResult = {
  report: MissionReport;
  iterations: number;
  escalated: boolean;
};

/**
 * Supervisor — orquesta reintentos, fallback, gate y escalado a Qwen.
 * Lógica:
 *  - Intenta con adapter primario (TaskRouter)
 *  - Si falla o gate no pasa → retry hasta maxRetries
 *  - Tras maxRetries, prueba fallback (matriz) hasta maxIterations
 *  - Tras agotar fallbacks, escala a Qwen con traceback del último error
 *  - Kill tras maxIterations o timeout global
 */
export class Supervisor {
  private adapters: Record<AdapterId, Adapter>;
  private onProgress: ((e: SupervisorEvent) => void) | undefined;

  constructor(deps: SupervisorDeps) {
    this.adapters = deps.adapters;
    if (deps.onProgress) this.onProgress = deps.onProgress;
  }

  private emit(e: SupervisorEvent) {
    this.onProgress?.(e);
  }

  async run(mission: Mission, opts: { signal?: AbortSignal } = {}): Promise<SupervisorResult> {
    const start = Date.now();
    const timeoutMs = mission.timeoutMs ?? SUPERVISOR_CONFIG.defaultTimeoutMs;
    const controller = new AbortController();
    const globalTimeout = setTimeout(() => controller.abort(), timeoutMs);

    // Conectar signal externo si existe
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let iterations = 0;
    let lastReport: MissionReport | null = null;
    let currentAdapter: AdapterId = route(mission).adapter;
    let escalated = false;

    const isKilled = () => controller.signal.aborted || Date.now() - start > timeoutMs;

    while (iterations < SUPERVISOR_CONFIG.maxIterations) {
      if (isKilled()) {
        this.emit({ type: "killed", missionId: mission.missionId, reason: `timeout ${timeoutMs}ms o abort` });
        clearTimeout(globalTimeout);
        return {
          report: lastReport ?? {
            missionId: mission.missionId,
            status: "aborted",
            adapter: currentAdapter,
            summary: `Killed tras ${iterations} iteraciones (timeout ${timeoutMs}ms)`,
            artifacts: [],
            durationMs: Date.now() - start,
            error: { message: "Supervisor timeout/kill", code: "TIMEOUT" },
          },
          iterations,
          escalated,
        };
      }

      iterations++;
      const attemptMission: Mission = { ...mission, attempt: iterations };

      this.emit({ type: "start", missionId: mission.missionId, adapter: currentAdapter, attempt: iterations });

      const adapter = this.adapters[currentAdapter];
      if (!adapter) {
        const errReport: MissionReport = {
          missionId: mission.missionId,
          status: "failed",
          adapter: currentAdapter,
          summary: `Adapter ${currentAdapter} no registrado`,
          artifacts: [],
          durationMs: Date.now() - start,
          error: { message: `Adapter ${currentAdapter} missing`, code: "ADAPTER_NOT_FOUND" },
        };
        lastReport = errReport;
        this.emit({ type: "retry", missionId: mission.missionId, adapter: currentAdapter, attempt: iterations, reason: "adapter missing" });
        // Fallback
        const fb = getFallbackAdapter(currentAdapter, iterations);
        if (fb) {
          this.emit({ type: "fallback", missionId: mission.missionId, from: currentAdapter, to: fb, attempt: iterations });
          currentAdapter = fb;
        }
        continue;
      }

      try {
        const report = await adapter.execute(attemptMission, { signal: controller.signal });
        lastReport = report;

        // Gate de calidad
        const gate = qualityGate(mission, report);
        if (!gate.passed) {
          this.emit({ type: "gate_failed", missionId: mission.missionId, reason: gate.reason });

          if (iterations >= SUPERVISOR_CONFIG.maxRetries && currentAdapter !== SUPERVISOR_CONFIG.escalateAdapter) {
            // Escalar a Qwen con traceback
            const traceback = report.error?.stack || report.error?.message || report.summary.slice(0, 2000);
            const escalateMission: Mission = {
              ...mission,
              type: "resolver_bloqueo",
              complexity: "high",
              title: `Escalado Qwen: ${mission.title}`,
              prompt: `${mission.prompt}\n\n---\n[TRACEBACK del intento ${iterations} con ${currentAdapter}]\n${traceback}\n\n[REPORTE]\n${report.summary.slice(0, 2000)}\n\nPropón un patch o solución.`,
              attempt: iterations + 1,
            };
            this.emit({ type: "escalate", missionId: mission.missionId, to: SUPERVISOR_CONFIG.escalateAdapter, traceback });
            currentAdapter = SUPERVISOR_CONFIG.escalateAdapter;
            escalated = true;
            // Cambiar misión para el siguiente loop a la escalada
            mission = escalateMission;
            continue;
          }

          // Reintento o fallback
          if (iterations < SUPERVISOR_CONFIG.maxRetries) {
            this.emit({ type: "retry", missionId: mission.missionId, adapter: currentAdapter, attempt: iterations, reason: gate.reason });
            continue;
          }

          const fb = getFallbackAdapter(currentAdapter, iterations - SUPERVISOR_CONFIG.maxRetries);
          if (fb) {
            this.emit({ type: "fallback", missionId: mission.missionId, from: currentAdapter, to: fb, attempt: iterations });
            currentAdapter = fb;
            continue;
          }

          // Sin fallback, escalar si no es ya qwen
          if (currentAdapter !== SUPERVISOR_CONFIG.escalateAdapter) {
            const traceback = report.error?.message || report.summary.slice(0, 2000);
            this.emit({ type: "escalate", missionId: mission.missionId, to: SUPERVISOR_CONFIG.escalateAdapter, traceback });
            currentAdapter = SUPERVISOR_CONFIG.escalateAdapter;
            escalated = true;
            continue;
          }

          // Ya es qwen y sigue fallando → terminar con failed
          break;
        }

        // Gate pasó
        if (report.status === "success") {
          this.emit({ type: "done", missionId: mission.missionId, report, iterations });
          clearTimeout(globalTimeout);
          return { report, iterations, escalated };
        }

        // Status no success pero gate pasó (ej. needs_review) → tratar como reintento si no es qwen
        if (report.status === "needs_review" && currentAdapter !== "qwen") {
          this.emit({ type: "escalate", missionId: mission.missionId, to: "qwen", traceback: report.summary.slice(0, 2000) });
          currentAdapter = "qwen";
          escalated = true;
          continue;
        }

        // Si gate pasó pero status es failed/aborted, es fallo real
        if (report.status === "failed" || report.status === "aborted") {
          if (iterations < SUPERVISOR_CONFIG.maxRetries) {
            this.emit({ type: "retry", missionId: mission.missionId, adapter: currentAdapter, attempt: iterations, reason: `status ${report.status}` });
            continue;
          }
          break;
        }

        // Caso genérico: report no success pero gate pasó → retornar como está
        this.emit({ type: "done", missionId: mission.missionId, report, iterations });
        clearTimeout(globalTimeout);
        return { report, iterations, escalated };
      } catch (err) {
        const msg = String(err);
        const isAbort = msg.includes("abort") || controller.signal.aborted;
        if (isAbort) {
          this.emit({ type: "killed", missionId: mission.missionId, reason: msg });
          clearTimeout(globalTimeout);
          return {
            report: lastReport ?? {
              missionId: mission.missionId,
              status: "aborted",
              adapter: currentAdapter,
              summary: `Aborted: ${msg.slice(0, 500)}`,
              artifacts: [],
              durationMs: Date.now() - start,
              error: { message: msg.slice(0, 1000) },
            },
            iterations,
            escalated,
          };
        }

        lastReport = {
          missionId: mission.missionId,
          status: "failed",
          adapter: currentAdapter,
          summary: `Excepción en ${currentAdapter}: ${msg.slice(0, 500)}`,
          artifacts: [],
          durationMs: Date.now() - start,
          error: { message: msg.slice(0, 1000), stack: (err as Error).stack?.slice(0, 2000) },
        };

        this.emit({ type: "retry", missionId: mission.missionId, adapter: currentAdapter, attempt: iterations, reason: msg.slice(0, 200) });

        if (iterations >= SUPERVISOR_CONFIG.maxRetries) {
          const fb = getFallbackAdapter(currentAdapter, iterations - SUPERVISOR_CONFIG.maxRetries + 1);
          if (fb) {
            this.emit({ type: "fallback", missionId: mission.missionId, from: currentAdapter, to: fb, attempt: iterations });
            currentAdapter = fb;
          } else if (currentAdapter !== SUPERVISOR_CONFIG.escalateAdapter) {
            this.emit({ type: "escalate", missionId: mission.missionId, to: SUPERVISOR_CONFIG.escalateAdapter, traceback: msg.slice(0, 2000) });
            currentAdapter = SUPERVISOR_CONFIG.escalateAdapter;
            escalated = true;
          }
        }
      }
    }

    clearTimeout(globalTimeout);
    // Agotadas iteraciones
    const finalReport = lastReport ?? {
      missionId: mission.missionId,
      status: "failed" as const,
      adapter: currentAdapter,
      summary: `Agotadas ${iterations} iteraciones sin éxito`,
      artifacts: [],
      durationMs: Date.now() - start,
      error: { message: "maxIterations exceeded", code: "MAX_ITERATIONS" },
    };

    this.emit({ type: "done", missionId: mission.missionId, report: finalReport, iterations });
    return { report: finalReport, iterations, escalated };
  }
}

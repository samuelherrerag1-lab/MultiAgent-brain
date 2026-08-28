import type { Mission, MissionReport, AdapterId } from "@cerebro/shared/protocols";

/**
 * Contrato que todo adaptador debe implementar.
 * FASE 2: Opencode, FASE 3: DSH, FASE 4: Qwen
 */
export interface Adapter {
  readonly id: AdapterId;
  /**
   * Ejecuta una misión y retorna reporte.
   * @param mission - Mission validada
   * @param opts.signal - AbortSignal para timeout/cancel
   */
  execute(mission: Mission, opts?: { signal?: AbortSignal }): Promise<MissionReport>;

  /**
   * Health check rápido (sin ejecutar misión real)
   */
  healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
}

export interface AdapterOptions {
  /** Directorio base para worktrees (default: .cerebro-worktrees) */
  worktreesDir?: string;
  /** Timeout por defecto (ms) */
  defaultTimeoutMs?: number;
}

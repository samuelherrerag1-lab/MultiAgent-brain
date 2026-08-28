/**
 * Protocolos de comunicación Líder ↔ Pro Agents
 * Fuente única de verdad — importado por Frontend, Backend y Adaptadores.
 * @module @cerebro/shared/protocols
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Tipo de misión — determina adaptador por defecto (ver TaskRouter) */
export const MissionType = z.enum([
  "planificar_arquitectura",
  "revisar_entregable",
  "resolver_bloqueo",
  "build",
  "execute",
  "refactor",
  "tests",
]);
export type MissionType = z.infer<typeof MissionType>;

/** Complejidad — influye en routing y reasoningEffort */
export const Complexity = z.enum(["low", "medium", "high"]);
export type Complexity = z.infer<typeof Complexity>;

/** Estado de misión en PG */
export const MissionStatus = z.enum([
  "pending",
  "running",
  "success",
  "failed",
  "aborted",
  "needs_review",
]);
export type MissionStatus = z.infer<typeof MissionStatus>;

/** Adaptador que ejecutó la misión */
export const AdapterId = z.enum(["qwen", "dsh", "opencode"]);
export type AdapterId = z.infer<typeof AdapterId>;

// ---------------------------------------------------------------------------
// 4.1 Misión (Líder → Pro Agent)
// ---------------------------------------------------------------------------

export const MissionSchema = z.object({
  /** UUID v4 — branded para evitar confusión con otros ids */
  missionId: z.string().uuid().describe("UUID v4 de la misión"),

  /** Tipo funcional */
  type: MissionType,

  /** Complejidad estimada — low: <1 archivo, medium: 2-5, high: >5 o arquitectura */
  complexity: Complexity,

  /** Título corto para Kanban */
  title: z.string().min(5).max(80),

  /** Prompt estructurado que el adaptador inyecta al agente */
  prompt: z.string().min(20).max(65_536).describe("Alineado con agent-instructions maxBytes"),

  /** Contexto de workspace — usado para crear worktree y aislar */
  workspace: z.object({
    repo: z.string().describe("Path local o URL remota del repo"),
    branch: z.string().optional().describe("Rama base, default main"),
    worktree: z.string().optional().describe("Path del worktree aislado (generado por Líder)"),
    baseCommit: z.string().optional().describe("SHA base para diff"),
  }),

  /** Archivos de contexto que el agente debe leer primero */
  contextFiles: z.array(z.string()).max(20).optional(),

  /** Criterios verificables — el Gate de Calidad los exige todos */
  acceptanceCriteria: z
    .array(z.string().min(10))
    .min(1)
    .describe("Criterios que el QA Agent / Qwen validará"),

  /** Whitelist de tools permitidas; si vacío, usa defaults del adaptador */
  toolsAllowed: z.array(z.string()).optional(),

  /** Prioridad para cola */
  priority: z.enum(["low", "normal", "high"]).default("normal"),

  /** Timeout en ms — Supervisor mata tras esto */
  timeoutMs: z.number().int().min(10_000).max(600_000).default(300_000),

  /** Trace id para correlación logs/SSE */
  traceId: z.string().optional(),

  /** Epoch ms de creación */
  createdAt: z.number().int().describe("Date.now()"),

  /** Intento actual (1-indexed) — Supervisor incrementa en retry */
  attempt: z.number().int().min(1).default(1),
});

export type Mission = z.infer<typeof MissionSchema>;

// ---------------------------------------------------------------------------
// 4.2 Reporte de Misión (Pro Agent → Líder)
// ---------------------------------------------------------------------------

export const MissionReportSchema = z.object({
  missionId: z.string().uuid(),

  /** Estado final según el adaptador */
  status: z.enum(["success", "failed", "aborted", "needs_review"]),

  /** Qué adaptador ejecutó */
  adapter: AdapterId,

  /** Resumen humano (para Kanban y decisions) */
  summary: z.string().max(4_000),

  /** Artefactos generados */
  artifacts: z
    .array(
      z.object({
        path: z.string().describe("Path relativo al worktree"),
        kind: z.enum(["file", "diff", "log", "test_report"]),
        bytes: z.number().optional(),
      }),
    )
    .default([]),

  /** Resultados de tests si aplica */
  testResults: z
    .object({
      passed: z.number().int().min(0),
      failed: z.number().int().min(0),
      coverage: z.number().min(0).max(100).optional(),
      output: z.string().max(50_000).optional().describe("Respeta spill maxInlineBytes"),
    })
    .optional(),

  /** Decisiones tomadas — se persisten en tabla decisions para memoria */
  decisions: z
    .array(
      z.object({
        decision: z.string(),
        rationale: z.string(),
        at: z.number().int().describe("Epoch ms"),
      }),
    )
    .optional(),

  traceId: z.string().optional(),

  /** Duración real en ms */
  durationMs: z.number().int().min(0),

  /** Error si status != success */
  error: z
    .object({
      message: z.string(),
      stack: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),

  /** Próximos pasos sugeridos por el agente */
  nextActions: z.array(z.string()).optional(),
});

export type MissionReport = z.infer<typeof MissionReportSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valida y parsea una misión, lanza ZodError si inválida */
export function parseMission(data: unknown): Mission {
  return MissionSchema.parse(data);
}

export function parseMissionReport(data: unknown): MissionReport {
  return MissionReportSchema.parse(data);
}

/** Type guards */
export function isMissionType(value: string): value is MissionType {
  return (MissionType.options as string[]).includes(value);
}

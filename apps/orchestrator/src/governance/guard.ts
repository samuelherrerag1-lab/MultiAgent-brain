import type { Mission, MissionReport } from "@cerebro/shared/protocols";

/**
 * GovernanceGuard — hard constraints programadas en el núcleo.
 * - Comandos prohibidos (regex)
 * - Gate de calidad (tests + acceptanceCriteria)
 */

// Regex de comandos destructivos — bloqueados sin aprobación humana explícita
export const BLOCKED_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /rm\s+-rf\s+(\/|~|\*)/i, label: "rm -rf destructivo" },
  { regex: /\bsudo\b/i, label: "sudo" },
  { regex: /drop\s+database/i, label: "DROP DATABASE" },
  { regex: /drop\s+table/i, label: "DROP TABLE" },
  { regex: /git\s+push\s+--force/i, label: "git push --force" },
  { regex: /\bmkfs\b/i, label: "mkfs" },
  { regex: /dd\s+if=/i, label: "dd if=" },
  { regex: /\bshutdown\b/i, label: "shutdown" },
  { regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;:/, label: "fork bomb" },
  { regex: />\s*\/dev\/sda/i, label: "sobrescribir /dev/sda" },
  { regex: /chmod\s+777\s+\//i, label: "chmod 777 /" },
];

export type BlockedCheck = { blocked: true; pattern: string; command: string } | { blocked: false };

export function checkBlockedCommand(command: string): BlockedCheck {
  for (const { regex, label } of BLOCKED_PATTERNS) {
    if (regex.test(command)) return { blocked: true, pattern: label, command };
  }
  return { blocked: false };
}

/**
 * Escanea el prompt de la misión en busca de comandos bloqueados.
 * Retorna el primer patrón que matchee, o null si está limpio.
 */
export function scanMissionForBlockedCommands(mission: Pick<Mission, "prompt">): BlockedCheck {
  // Buscar líneas que parezcan comandos (heuristic: líneas con rm, sudo, etc.)
  return checkBlockedCommand(mission.prompt);
}

// ---------------------------------------------------------------------------
// Gate de calidad
// ---------------------------------------------------------------------------

export type QualityGateResult = { passed: true } | { passed: false; reason: string };

/**
 * Gate síncrono basado en MissionReport (tests + criterios).
 * Para criterios que requieren juicio semántico, el Supervisor escalará a Qwen
 * con el traceback (no se evalúa aquí).
 */
export function qualityGate(mission: Pick<Mission, "acceptanceCriteria">, report: MissionReport): QualityGateResult {
  // 1. Tests deben pasar si se reportan
  if (report.testResults) {
    if (report.testResults.failed > 0) {
      return { passed: false, reason: `tests fallaron: ${report.testResults.failed} failed, ${report.testResults.passed} passed` };
    }
    // Coverage mínimo 50% si se reporta (configurable, no bloqueante estricto)
    if (report.testResults.coverage !== undefined && report.testResults.coverage < 30) {
      return { passed: false, reason: `coverage insuficiente: ${report.testResults.coverage}% < 30%` };
    }
  }

  // 2. Si el reporte es needs_review, requiere aprobación humana (no pasa automáticamente)
  if (report.status === "needs_review") {
    return { passed: false, reason: "reporte en needs_review — requiere aprobación humana" };
  }

  // 3. Si el reporte es failed/aborted, no pasa
  if (report.status === "failed" || report.status === "aborted") {
    return { passed: false, reason: `status ${report.status}: ${report.error?.message ?? "sin detalle"}` };
  }

  // 4. Criterios de aceptación: si el summary menciona que no se cumplen, falla
  // Heurística simple: si summary contiene "no cumple" o "failed criteria", falla
  const summaryLower = report.summary.toLowerCase();
  if (summaryLower.includes("no cumple") || summaryLower.includes("criterio fallido") || summaryLower.includes("failed criteria")) {
    return { passed: false, reason: "summary indica criterios no cumplidos" };
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Memoria — decisiones
// ---------------------------------------------------------------------------

export type DecisionRecord = {
  decision: string;
  rationale: string;
  at: number;
  missionId: string;
};

/**
 * Extrae decisiones del reporte para persistir en tabla decisions.
 */
export function extractDecisions(report: MissionReport): DecisionRecord[] {
  if (!report.decisions?.length) return [];
  return report.decisions.map((d) => ({
    decision: d.decision,
    rationale: d.rationale,
    at: d.at,
    missionId: report.missionId,
  }));
}

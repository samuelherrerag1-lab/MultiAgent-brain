import type { Mission } from "@cerebro/shared/protocols";

/**
 * Construye el prompt estructurado que se inyecta al agente.
 * Incluye Mission JSON, acceptanceCriteria y traza.
 */
export function buildPrompt(mission: Mission): string {
  const criteria = mission.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n");

  const context = mission.contextFiles?.length
    ? `Archivos de contexto a leer primero:\n${mission.contextFiles.map((f) => `- ${f}`).join("\n")}`
    : "Sin archivos de contexto específicos.";

  return `# Misión: ${mission.title}

**ID:** ${mission.missionId}
**Tipo:** ${mission.type} | **Complejidad:** ${mission.complexity} | **Trace:** ${mission.traceId ?? "n/a"}

## Objetivo
${mission.prompt}

## Criterios de Aceptación (deben cumplirse todos)
${criteria}

## Contexto
${context}

## Workspace
- Repo: ${mission.workspace.repo}
- Rama base: ${mission.workspace.branch ?? "main"}
- Worktree: ${mission.workspace.worktree ?? "(generado por orquestador)"}

## Instrucciones para el agente
1. Lee AGENTS.md en este worktree
2. Implementa los cambios requeridos para cumplir TODOS los criterios
3. Genera tests si corresponde
4. Verifica que los criterios se cumplen antes de finalizar
5. Tu salida será parseada como summary del MissionReport

---
Mission JSON (para debug):
\`\`\`json
${JSON.stringify(mission, null, 2)}
\`\`\`
`;
}

/**
 * Construye el contenido de AGENTS.md inyectado con la misión.
 */
export function buildAgentsMd(template: string, mission: Mission): string {
  const promptBlock = buildPrompt(mission);
  if (template.includes("<!-- INJECT_MISSION_JSON -->")) {
    return template.replace("<!-- INJECT_MISSION_JSON -->", promptBlock);
  }
  return `${template}\n\n---\n\n${promptBlock}`;
}

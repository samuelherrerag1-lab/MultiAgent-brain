import type { Mission, MissionReport } from "@cerebro/shared/protocols";
import type { Adapter } from "../adapters/types.ts";
import { buildPrompt } from "../adapters/prompt.ts";
import { consultArchitectChat, healthCheckChat, closeQwenContext, type QwenChatOptions } from "./qwen.chat.ts";
import { detectArtifacts } from "../adapters/opencode.ts";

// Re-export para uso directo
export { consultArchitectChat, healthCheckChat, closeQwenContext };
export type { QwenChatOptions };

/**
 * QwenMax-3.8 via Chat — único provider para Qwen en esta fase (sin API).
 * Implementa Adapter para compatibilidad con TaskRouter (high + plan → qwen)
 */

export type QwenBridgeOptions = QwenChatOptions & {
  /** Timeout por misión (ms) */
  timeoutMs?: number;
};

function tryParseJson<T>(text: string): { parsed: T | null; isJson: boolean } {
  const trimmed = text.trim();
  // Intentar parsear directo
  try {
    return { parsed: JSON.parse(trimmed) as T, isJson: true };
  } catch {}
  // Intentar extraer bloque ```json ... ```
  const match = trimmed.match(/```json\s*([\s\S]*?)\s*```/i) || trimmed.match(/```\s*([\s\S]*?)\s*```/);
  if (match) {
    try {
      return { parsed: JSON.parse(match[1]!) as T, isJson: true };
    } catch {}
  }
  // Intentar encontrar primer { ... } balanceado
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return { parsed: JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T, isJson: true };
    } catch {}
  }
  return { parsed: null, isJson: false };
}

export async function consultArchitect(objective: string, opts?: QwenChatOptions): Promise<string> {
  return consultArchitectChat(objective, opts);
}

export async function consultArchitectJson<T>(objective: string, opts?: QwenChatOptions): Promise<T> {
  const text = await consultArchitectChat(objective, opts);
  const { parsed } = tryParseJson<T>(text);
  if (!parsed) throw new Error(`QWEN_JSON_PARSE_FAILED: no se pudo parsear JSON de respuesta Qwen. Texto: ${text.slice(0, 500)}`);
  return parsed;
}

export function createQwenAdapter(opts: QwenBridgeOptions = {}): Adapter & {
  consultArchitect: typeof consultArchitect;
  consultArchitectJson: typeof consultArchitectJson;
  close: typeof closeQwenContext;
} {
  const chatOpts: QwenChatOptions = {
    modelLabel: opts.modelLabel ?? "QwenMax-3.8",
  };
  if (opts.userDataDir) chatOpts.userDataDir = opts.userDataDir;
  if (opts.headless !== undefined) chatOpts.headless = opts.headless;
  if (opts.timeoutMs !== undefined) chatOpts.timeoutMs = opts.timeoutMs;

  return {
    id: "qwen",

    async healthCheck() {
      return healthCheckChat(chatOpts);
    },

    async execute(mission: Mission): Promise<MissionReport> {
      const start = Date.now();
      const prompt = buildPrompt(mission);

      try {
        const execOpts: QwenChatOptions = { ...chatOpts };
        const t = mission.timeoutMs ?? opts.timeoutMs;
        if (t !== undefined) execOpts.timeoutMs = t;
        const text = await consultArchitectChat(prompt, execOpts);

        // Qwen Chat es para plan/review/unblock — no genera archivos, solo texto
        // Detectar si la respuesta contiene JSON con decisiones
        const { parsed } = tryParseJson<{ summary?: string; decisions?: { decision: string; rationale: string }[] }>(text);
        const summary = parsed?.summary || text.slice(0, 4000);
        const decisions = parsed?.decisions?.map((d) => ({ ...d, at: Date.now() }));

        return {
          missionId: mission.missionId,
          status: "success",
          adapter: "qwen",
          summary,
          artifacts: [],
          decisions,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const msg = String(err);
        const isLogin = msg.includes("QWEN_LOGIN_REQUIRED");
        const isCaptcha = msg.includes("QWEN_CAPTCHA");

        return {
          missionId: mission.missionId,
          status: isLogin || isCaptcha ? "needs_review" : "failed",
          adapter: "qwen",
          summary: `Qwen Chat falló: ${msg.slice(0, 800)}`,
          artifacts: [],
          durationMs: Date.now() - start,
          error: { message: msg.slice(0, 2000), stack: (err as Error).stack?.slice(0, 2000) },
        };
      }
    },

    consultArchitect,
    consultArchitectJson,
    close: closeQwenContext,
  };
}

export const qwenAdapter = createQwenAdapter();
export default qwenAdapter;

// Helper para cerrar contexto al apagar orquestador
export async function closeQwen(): Promise<void> {
  await closeQwenContext();
}

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Mission, MissionReport } from "@cerebro/shared/protocols";
import type { Adapter } from "./types.ts";
import { ensureWorktree, getWorktreePath } from "./worktree.ts";
import { buildPrompt, buildAgentsMd } from "./prompt.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = process.env.OPENCODE_MODEL || "ollama-local/qwen2.5-coder:7b";
const FALLBACK_MODEL = "ollama-local/MFDoom/deepseek-coder-v2-tool-calling:16b";

// Permite inyectar spawn para tests
export type SpawnFn = (
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export const defaultSpawn: SpawnFn = async (command, args, opts) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal: opts.signal,
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 2000);
    }, opts.timeoutMs);

    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        resolve({ stdout, stderr: stderr + "\n[TIMEOUT]", exitCode: 124 });
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });

    opts.signal?.addEventListener("abort", () => {
      proc.kill("SIGTERM");
    });
  });

// ---------------------------------------------------------------------------
// AGENTS.md
// ---------------------------------------------------------------------------

function resolveTemplatePath(): string {
  // Desde src/adapters/opencode.ts → ../../templates/AGENTS.md
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, "../../templates/AGENTS.md");
}

export function ensureAgentsMd(worktreePath: string, mission: Mission): string {
  const agentsPath = path.join(worktreePath, "AGENTS.md");
  const templatePath = resolveTemplatePath();

  let template = "";
  if (existsSync(templatePath)) {
    template = readFileSync(templatePath, "utf-8");
  } else if (existsSync(agentsPath)) {
    return agentsPath; // ya existe y no hay template
  } else {
    template = `# AGENTS.md\n\nInstrucciones para agente en worktree ${worktreePath}\n`;
  }

  const content = buildAgentsMd(template, mission);
  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(agentsPath, content, "utf-8");
  return agentsPath;
}

// ---------------------------------------------------------------------------
// Parsing opencode --format json
// ---------------------------------------------------------------------------

/**
 * opencode --format json emite líneas JSON (una por evento).
 * Intentamos extraer el resumen final. Si no es JSON, tratamos todo como texto.
 */
export function parseOpencodeOutput(stdout: string, stderr: string): { summary: string; isJson: boolean } {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let lastText = "";
  let isJson = false;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      isJson = true;
      // opencode json events tienen shape variado; buscamos campos de texto
      if (typeof obj.text === "string") lastText = obj.text;
      else if (typeof obj.content === "string") lastText = obj.content;
      else if (typeof obj.message === "string") lastText = obj.message;
      else if (obj.type === "text" && typeof obj.text === "string") lastText = obj.text;
      else if (obj.delta?.text) lastText += obj.delta.text;
      // Si es evento final con summary, úsalo
      if (obj.summary) lastText = obj.summary;
    } catch {
      // No es JSON, acumular como texto
      lastText += (lastText ? "\n" : "") + line;
    }
  }

  // Si no se parseó JSON, usar stdout completo
  if (!isJson) {
    const trimmed = stdout.trim();
    if (trimmed) lastText = trimmed;
    else if (stderr.trim()) lastText = stderr.trim();
  }

  // Fallback: si lastText vacío, usar stderr o stdout raw
  if (!lastText) {
    lastText = stdout.trim() || stderr.trim() || "(sin salida)";
  }

  // Truncar a 4000 (límite MissionReport.summary)
  if (lastText.length > 4000) lastText = lastText.slice(0, 3997) + "...";

  return { summary: lastText, isJson };
}

/**
 * Detecta artefactos generados listando archivos nuevos/modificados en el worktree.
 * FASE 2 simple: lista archivos que existen y no son AGENTS.md/.git
 */
export function detectArtifacts(worktreePath: string): { path: string; kind: "file"; bytes?: number }[] {
  const artifacts: { path: string; kind: "file"; bytes?: number }[] = [];
  try {
    // Usar git status para detectar cambios si es repo; si no, listar archivos
    try {
      const out = execSync("git status --porcelain", { cwd: worktreePath, encoding: "utf-8", stdio: "pipe" });
      for (const line of out.split("\n").filter(Boolean)) {
        const file = line.slice(3).trim();
        if (!file || file === "AGENTS.md") continue;
        try {
          const stat = statSync(path.join(worktreePath, file));
          if (stat.isFile()) artifacts.push({ path: file, kind: "file", bytes: stat.size });
        } catch {}
      }
      if (artifacts.length > 0) return artifacts;
    } catch {}
    // Fallback: listar archivos en worktree (no recursivo profundo para no incluir node_modules)
    const entries = readdirSync(worktreePath, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === ".git" || e.name === "AGENTS.md" || e.name === "node_modules") continue;
      if (e.isFile()) {
        const p = path.join(worktreePath, e.name);
        const stat = statSync(p);
        artifacts.push({ path: e.name, kind: "file", bytes: stat.size });
      }
    }
  } catch {}
  return artifacts;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkOpencodeHealth(spawnFn: SpawnFn = defaultSpawn): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    const result = await spawnFn("opencode", ["--version"], { cwd: process.cwd(), timeoutMs: 5000 });
    if (result.exitCode === 0) {
      return { ok: true, latencyMs: Date.now() - start };
    }
    return { ok: false, error: result.stderr || `exit ${result.exitCode}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function checkOllamaHealth(): Promise<{ ok: boolean; error?: string }> {
  const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface OpencodeAdapterOptions {
  spawnFn?: SpawnFn;
  worktreesDir?: string;
  model?: string;
  /** Si true, no crea worktree real (para tests con tmp dir) */
  skipWorktree?: boolean;
}

export function createOpencodeAdapter(opts: OpencodeAdapterOptions = {}): Adapter {
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    id: "opencode",

    async healthCheck() {
      return checkOpencodeHealth(spawnFn);
    },

    async execute(mission: Mission, execOpts?: { signal?: AbortSignal }): Promise<MissionReport> {
      const start = Date.now();
      const timeoutMs = mission.timeoutMs ?? 300_000;

      // 1. Worktree
      let worktreePath: string;
      if (opts.skipWorktree) {
        worktreePath = getWorktreePath(mission.missionId);
        mkdirSync(worktreePath, { recursive: true });
      } else {
        worktreePath = await ensureWorktree(mission.missionId, {
          baseDir: opts.worktreesDir ? path.resolve(opts.worktreesDir, "..") : process.cwd(),
        });
        // Si worktreesDir custom, usar getWorktreePath directamente
        if (opts.worktreesDir) {
          worktreePath = path.join(path.resolve(opts.worktreesDir), mission.missionId);
          mkdirSync(worktreePath, { recursive: true });
        }
      }

      // 2. AGENTS.md
      ensureAgentsMd(worktreePath, mission);

      // 3. Prompt
      const prompt = buildPrompt(mission);

      // 4. Spawn opencode
      const args = ["run", prompt, "--format", "json", "--dir", worktreePath, "--model", model];

      let result: { stdout: string; stderr: string; exitCode: number };
      try {
        const spawnOpts: { cwd: string; timeoutMs: number; signal?: AbortSignal } = {
          cwd: worktreePath,
          timeoutMs,
        };
        if (execOpts?.signal) spawnOpts.signal = execOpts.signal;
        result = await spawnFn("opencode", args, spawnOpts);
      } catch (err) {
        const durationMs = Date.now() - start;
        return {
          missionId: mission.missionId,
          status: "failed",
          adapter: "opencode",
          summary: `Opencode spawn falló: ${String(err)}`,
          artifacts: [],
          durationMs,
          error: { message: String(err), stack: (err as Error).stack },
        };
      }

      const durationMs = Date.now() - start;
      const { summary } = parseOpencodeOutput(result.stdout, result.stderr);

      // 5. Detectar artefactos
      const artifacts = detectArtifacts(worktreePath);

      // 6. Determinar status
      const isSuccess = result.exitCode === 0;
      const status = isSuccess ? "success" : "failed";

      // 7. Si falla, intentar fallback de modelo una vez
      if (!isSuccess && model !== FALLBACK_MODEL && result.stderr.includes("model")) {
        // No auto-retry aquí; el Supervisor lo hará con otro adapter
      }

      return {
        missionId: mission.missionId,
        status,
        adapter: "opencode",
        summary,
        artifacts,
        durationMs,
        ...(isSuccess
          ? {}
          : { error: { message: result.stderr || `exit ${result.exitCode}`, stack: result.stdout.slice(0, 2000) } }),
      };
    },
  };
}

// Instancia por defecto (singleton)
export const opencodeAdapter: Adapter = createOpencodeAdapter();
export default opencodeAdapter;

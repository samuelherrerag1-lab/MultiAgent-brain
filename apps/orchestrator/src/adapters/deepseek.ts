import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Mission, MissionReport } from "@cerebro/shared/protocols";
import type { Adapter, SpawnFn } from "./types.ts";
import { ensureWorktree, getWorktreePath } from "./worktree.ts";
import { buildPrompt, buildAgentsMd } from "./prompt.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DSH_PROFILE = process.env.DSH_PROFILE || "headless";
const DSH_BIN = process.env.DSH_BIN || "dsh"; // o "pnpm" con args
const DSH_API_URL = process.env.DSH_API_URL || ""; // ej: http://127.0.0.1:3080
const DEFAULT_TIMEOUT = 600_000; // DSH tareas build pueden ser largas (10m)

// Permite inyectar fetch para tests
export type FetchFn = typeof fetch;

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

    opts.signal?.addEventListener("abort", () => proc.kill("SIGTERM"));
  });

// ---------------------------------------------------------------------------
// AGENTS.md
// ---------------------------------------------------------------------------

function resolveTemplatePath(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, "../../templates/AGENTS.md");
}

export function ensureAgentsMdForDsh(worktreePath: string, mission: Mission): string {
  const agentsPath = path.join(worktreePath, "AGENTS.md");
  const templatePath = resolveTemplatePath();

  let template = "";
  if (existsSync(templatePath)) {
    template = readFileSync(templatePath, "utf-8");
  } else if (existsSync(agentsPath)) {
    return agentsPath;
  } else {
    template = `# AGENTS.md\n\nInstrucciones para DSH en worktree ${worktreePath}\n`;
  }

  const content = buildAgentsMd(template, mission);
  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(agentsPath, content, "utf-8");
  return agentsPath;
}

// ---------------------------------------------------------------------------
// Prompt DSH
// ---------------------------------------------------------------------------

export function buildDshPrompt(mission: Mission): string {
  // DSH prefiere prompt estructurado con frontmatter + acceptanceCriteria
  const base = buildPrompt(mission);
  return `${base}

## DSH — Instrucciones adicionales
- Usa subagentes si la tarea es compleja (build/execute)
- Aísla cambios en esta worktree, no toques main
- Ejecuta tests si existen y verifica acceptanceCriteria
- Al finalizar, deja un resumen en stdout que será parseado como MissionReport.summary
`;
}

// ---------------------------------------------------------------------------
// Parsing DSH output
// ---------------------------------------------------------------------------

export function parseDshOutput(stdout: string, stderr: string): { summary: string; isJson: boolean } {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  let lastText = "";
  let isJson = false;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      isJson = true;
      if (typeof obj.text === "string") lastText = obj.text;
      else if (typeof obj.content === "string") lastText = obj.content;
      else if (typeof obj.message === "string") lastText = obj.message;
      else if (typeof obj.summary === "string") lastText = obj.summary;
      else if (obj.result?.summary) lastText = obj.result.summary;
    } catch {
      lastText += (lastText ? "\n" : "") + line;
    }
  }

  if (!isJson) {
    const trimmed = stdout.trim();
    if (trimmed) lastText = trimmed;
    else if (stderr.trim()) lastText = stderr.trim();
  }

  if (!lastText) lastText = stdout.trim() || stderr.trim() || "(sin salida DSH)";

  if (lastText.length > 4000) lastText = lastText.slice(0, 3997) + "...";

  return { summary: lastText, isJson };
}

export function detectDshArtifacts(worktreePath: string): { path: string; kind: "file"; bytes?: number }[] {
  const artifacts: { path: string; kind: "file"; bytes?: number }[] = [];
  try {
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
// HTTP Gateway (futuro dsh-mission-gateway)
// ---------------------------------------------------------------------------

export async function tryHttpGateway(
  mission: Mission,
  fetchFn: FetchFn = fetch,
  apiUrl: string = process.env.DSH_API_URL || DSH_API_URL,
): Promise<MissionReport | null> {
  if (!apiUrl) return null;

  const url = `${apiUrl.replace(/\/$/, "")}/missions`;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mission),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { id?: string; missionId?: string };
    const remoteId = data.id || data.missionId || mission.missionId;

    // Poll GET /missions/:id hasta done o timeout
    const pollUrl = `${apiUrl.replace(/\/$/, "")}/missions/${remoteId}`;
    const start = Date.now();
    const timeout = mission.timeoutMs ?? DEFAULT_TIMEOUT;

    while (Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const pollRes = await fetchFn(pollUrl, { signal: AbortSignal.timeout(5000) });
        if (!pollRes.ok) continue;
        const pollData = (await pollRes.json()) as any;
        // Si el gateway ya retorna MissionReport, úsalo
        if (pollData.status && pollData.adapter) {
          return pollData as MissionReport;
        }
        // Si retorna mission + report
        if (pollData.report) return pollData.report as MissionReport;
        if (pollData.mission?.status && ["success", "failed", "aborted"].includes(pollData.mission.status)) {
          // Construir reporte sintético si solo hay mission status
          return {
            missionId: mission.missionId,
            status: pollData.mission.status,
            adapter: "dsh",
            summary: pollData.mission.summary || `DSH gateway: ${pollData.mission.status}`,
            artifacts: pollData.report?.artifacts || [],
            durationMs: Date.now() - start,
          };
        }
      } catch {}
    }

    return {
      missionId: mission.missionId,
      status: "failed",
      adapter: "dsh",
      summary: `DSH gateway timeout tras ${timeout}ms`,
      artifacts: [],
      durationMs: Date.now() - start,
      error: { message: "Gateway timeout" },
    };
  } catch {
    return null; // fallback a CLI
  }
}

// ---------------------------------------------------------------------------
// CLI spawn helpers
// ---------------------------------------------------------------------------

export function getDshCommand(): { command: string; argsPrefix: string[] } {
  // DSH_BIN puede ser "dsh", "pnpm", "node"
  if (DSH_BIN === "pnpm") {
    return { command: "pnpm", argsPrefix: ["dsh", "--profile", DSH_PROFILE] };
  }
  if (DSH_BIN.endsWith("bin.ts") || DSH_BIN.includes("apps/cli/src/bin.ts")) {
    return { command: "node", argsPrefix: ["--import", "tsx/esm", DSH_BIN, "--profile", DSH_PROFILE] };
  }
  // default: dsh binary en PATH
  return { command: DSH_BIN, argsPrefix: ["--profile", DSH_PROFILE] };
}

export async function checkDshHealth(
  spawnFn: SpawnFn = defaultSpawn,
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    const { command, argsPrefix } = getDshCommand();
    // dsh --version no es estándar, probamos --help
    const result = await spawnFn(command, [...argsPrefix, "--help"], { cwd: process.cwd(), timeoutMs: 8000 });
    // Si el proceso existe y no es ENOENT, consideramos ok incluso si exit !=0 (help puede retornar 0 o 1)
    if (result.exitCode === 0 || result.stdout.includes("dsh") || result.stderr.includes("dsh")) {
      return { ok: true, latencyMs: Date.now() - start };
    }
    // Si el binario no existe, stderr contendrá ENOENT ya capturado como throw
    return { ok: false, error: result.stderr || `exit ${result.exitCode}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface DeepSeekAdapterOptions {
  spawnFn?: SpawnFn;
  fetchFn?: FetchFn;
  worktreesDir?: string;
  profile?: string;
  useHttpGateway?: boolean; // default: true si DSH_API_URL set
}

export function createDeepSeekAdapter(opts: DeepSeekAdapterOptions = {}): Adapter {
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const fetchFn = opts.fetchFn ?? fetch;
  const useHttp = opts.useHttpGateway ?? !!(process.env.DSH_API_URL || DSH_API_URL);

  return {
    id: "dsh",

    async healthCheck() {
      return checkDshHealth(spawnFn);
    },

    async execute(mission: Mission, execOpts?: { signal?: AbortSignal }): Promise<MissionReport> {
      const start = Date.now();
      const timeoutMs = mission.timeoutMs ?? DEFAULT_TIMEOUT;

      // 1. Worktree
      let worktreePath: string;
      if (opts.worktreesDir) {
        worktreePath = path.join(path.resolve(opts.worktreesDir), mission.missionId);
        mkdirSync(worktreePath, { recursive: true });
      } else {
        worktreePath = await ensureWorktree(mission.missionId, {
          baseDir: process.cwd(),
        });
      }

      // 2. AGENTS.md
      ensureAgentsMdForDsh(worktreePath, mission);

      // 3. Intentar HTTP gateway primero (si habilitado)
      const currentApiUrl = process.env.DSH_API_URL || DSH_API_URL;
      if (useHttp && currentApiUrl) {
        const httpReport = await tryHttpGateway(mission, fetchFn, currentApiUrl);
        if (httpReport) {
          // Detectar artefactos locales por si el gateway no los reportó
          if (httpReport.artifacts.length === 0) {
            httpReport.artifacts = detectDshArtifacts(worktreePath);
          }
          return httpReport;
        }
        // Si gateway falló, cae a CLI
      }

      // 4. CLI DSH
      const prompt = buildDshPrompt(mission);
      const { command, argsPrefix } = getDshCommand();
      const args = [...argsPrefix, prompt];

      let result: { stdout: string; stderr: string; exitCode: number };
      try {
        const spawnOpts: { cwd: string; timeoutMs: number; signal?: AbortSignal } = {
          cwd: worktreePath,
          timeoutMs,
        };
        if (execOpts?.signal) spawnOpts.signal = execOpts.signal;
        result = await spawnFn(command, args, spawnOpts);
      } catch (err) {
        const durationMs = Date.now() - start;
        return {
          missionId: mission.missionId,
          status: "failed",
          adapter: "dsh",
          summary: `DSH spawn falló: ${String(err)}`,
          artifacts: [],
          durationMs,
          error: { message: String(err), stack: (err as Error).stack },
        };
      }

      const durationMs = Date.now() - start;
      const { summary } = parseDshOutput(result.stdout, result.stderr);
      const artifacts = detectDshArtifacts(worktreePath);
      const isSuccess = result.exitCode === 0;
      const status = isSuccess ? "success" : "failed";

      return {
        missionId: mission.missionId,
        status,
        adapter: "dsh",
        summary,
        artifacts,
        durationMs,
        ...(isSuccess
          ? {}
          : { error: { message: result.stderr || `DSH exit ${result.exitCode}`, stack: result.stdout.slice(0, 2000) } }),
      };
    },
  };
}

export const deepSeekAdapter: Adapter = createDeepSeekAdapter();
export default deepSeekAdapter;

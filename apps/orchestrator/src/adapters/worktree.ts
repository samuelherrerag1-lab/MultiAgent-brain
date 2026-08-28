import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Gestión de git worktrees aislados por misión.
 * Cada misión corre en su propia rama `mission/<id>` y directorio `.cerebro-worktrees/<id>`.
 */

export function getWorktreesDir(baseDir = process.cwd()): string {
  return path.join(baseDir, ".cerebro-worktrees");
}

export function getWorktreePath(missionId: string, baseDir = process.cwd()): string {
  return path.join(getWorktreesDir(baseDir), missionId);
}

export function getMissionBranch(missionId: string): string {
  return `mission/${missionId}`;
}

/**
 * Verifica si estamos dentro de un repo git.
 */
export function isGitRepo(cwd = process.cwd()): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Asegura que el worktree existe. Si no, lo crea.
 * Retorna el path absoluto del worktree.
 *
 * Flujo:
 * 1. Si worktreePath ya existe en FS → retorna (ya creado)
 * 2. Si estamos en git repo → `git worktree add -b mission/<id> <path> HEAD`
 * 3. Si no hay git → crea directorio vacío (fallback para tests)
 */
export async function ensureWorktree(
  missionId: string,
  opts: { baseDir?: string; baseBranch?: string } = {},
): Promise<string> {
  const baseDir = opts.baseDir ?? process.cwd();
  const branch = getMissionBranch(missionId);
  const worktreePath = getWorktreePath(missionId, baseDir);

  if (existsSync(worktreePath)) {
    return worktreePath;
  }

  mkdirSync(getWorktreesDir(baseDir), { recursive: true });

  if (isGitRepo(baseDir)) {
    const baseBranch = opts.baseBranch ?? "HEAD";
    // Usar spawnSync para evitar shell injection
    const result = spawnSync("git", ["worktree", "add", "-b", branch, worktreePath, baseBranch], {
      cwd: baseDir,
      stdio: "pipe",
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      // Si la rama ya existe (reintento), intentar sin -b
      if (result.stderr?.includes("already exists")) {
        const retry = spawnSync("git", ["worktree", "add", worktreePath, branch], {
          cwd: baseDir,
          stdio: "pipe",
          encoding: "utf-8",
        });
        if (retry.status !== 0) {
          throw new Error(`git worktree add failed: ${retry.stderr}`);
        }
      } else if (result.stderr?.includes("not a git repository")) {
        mkdirSync(worktreePath, { recursive: true });
      } else {
        throw new Error(`git worktree add failed: ${result.stderr || result.stdout}`);
      }
    }
  } else {
    mkdirSync(worktreePath, { recursive: true });
  }

  return worktreePath;
}

/**
 * Elimina el worktree (para GC). No falla si no existe.
 */
export async function removeWorktree(missionId: string, baseDir = process.cwd()): Promise<void> {
  const worktreePath = getWorktreePath(missionId, baseDir);
  const branch = getMissionBranch(missionId);

  if (isGitRepo(baseDir)) {
    spawnSync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: baseDir,
      stdio: "ignore",
    });
    // Intentar borrar rama local (si no tiene commits únicos, falla silencioso)
    spawnSync("git", ["branch", "-D", branch], { cwd: baseDir, stdio: "ignore" });
  }

  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }
}

/**
 * Lista worktrees existentes (para GC)
 */
export function listWorktrees(baseDir = process.cwd()): string[] {
  const dir = getWorktreesDir(baseDir);
  if (!existsSync(dir)) return [];
  try {
    const result = execSync("git worktree list --porcelain", { cwd: baseDir, encoding: "utf-8" });
    return result
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.replace("worktree ", "").trim());
  } catch {
    return [];
  }
}

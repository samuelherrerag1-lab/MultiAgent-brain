import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import * as schema from "./schema.ts";

export type DbType = "pg" | "pglite";
export type DbInstance = ReturnType<typeof drizzlePg<typeof schema>> | ReturnType<typeof drizzlePglite<typeof schema>>;

let dbInstance: DbInstance | null = null;
let dbType: DbType | null = null;
let pgPool: pg.Pool | null = null;
let pgliteInstance: PGlite | null = null;

/**
 * Crea o retorna singleton de DB.
 * - Si DATABASE_URL empieza con "memory://" o DB_DRIVER=pglite → PGlite en memoria/archivo
 * - Si no, usa pg Pool (Neon, local PG)
 * - Si DATABASE_URL no existe → PGlite memory por defecto (dev sin config)
 */
export async function getDb(): Promise<{ db: DbInstance; type: DbType }> {
  if (dbInstance && dbType) return { db: dbInstance, type: dbType };

  const url = process.env.DATABASE_URL || "";
  const driver = process.env.DB_DRIVER || "";

  const usePglite =
    driver === "pglite" ||
    url.startsWith("memory://") ||
    url.startsWith("file:") ||
    url === "" ||
    process.env.NODE_ENV === "test";

  if (usePglite) {
    const dataDir = url.startsWith("file:") ? url.replace("file:", "") : undefined;
    // PGlite: si dataDir, persiste en archivo; si no, memoria
    pgliteInstance = dataDir ? new PGlite(dataDir) : new PGlite();
    // Intentar crear extensión vector si está disponible (pglite vector extension)
    try {
      await pgliteInstance.exec("CREATE EXTENSION IF NOT EXISTS vector;");
    } catch {
      // vector no disponible en pglite sin compilar — se usa jsonb fallback
      // No es crítico para FASE 1
    }
    // Crear tablas si no existen (para dev y tests sin drizzle-kit)
    await pgliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id VARCHAR(36) PRIMARY KEY,
        type VARCHAR(30) NOT NULL,
        complexity VARCHAR(10) NOT NULL,
        title VARCHAR(80) NOT NULL,
        prompt TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        workspace_repo TEXT NOT NULL,
        workspace_branch VARCHAR(100),
        worktree_path TEXT,
        base_commit VARCHAR(40),
        context_files JSONB,
        acceptance_criteria JSONB NOT NULL,
        tools_allowed JSONB,
        priority VARCHAR(10) NOT NULL DEFAULT 'normal',
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        trace_id VARCHAR(64),
        attempt INTEGER NOT NULL DEFAULT 1,
        adapter VARCHAR(20),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS mission_reports (
        id VARCHAR(36) PRIMARY KEY,
        mission_id VARCHAR(36) NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL,
        adapter VARCHAR(20) NOT NULL,
        summary TEXT NOT NULL,
        artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
        test_results JSONB,
        decisions JSONB,
        trace_id VARCHAR(64),
        duration_ms INTEGER NOT NULL,
        error JSONB,
        next_actions JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id VARCHAR(36) PRIMARY KEY,
        mission_id VARCHAR(36) NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS worktrees (
        mission_id VARCHAR(36) PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        branch VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        gc_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS embeddings (
        id VARCHAR(36) PRIMARY KEY,
        mission_id VARCHAR(36) REFERENCES missions(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    dbInstance = drizzlePglite(pgliteInstance, { schema });
    dbType = "pglite";
    return { db: dbInstance, type: dbType };
  }

  // PG real (Neon, local)
  pgPool = new pg.Pool({
    connectionString: url,
    ssl: url.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
  });
  // Test connection
  try {
    await pgPool.query("SELECT 1");
  } catch (err) {
    console.warn("[db] PG connection failed, falling back to pglite:", (err as Error).message);
    pgPool.end().catch(() => {});
    pgliteInstance = new PGlite();
    await pgliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id VARCHAR(36) PRIMARY KEY,
        type VARCHAR(30) NOT NULL,
        complexity VARCHAR(10) NOT NULL,
        title VARCHAR(80) NOT NULL,
        prompt TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        workspace_repo TEXT NOT NULL,
        workspace_branch VARCHAR(100),
        worktree_path TEXT,
        base_commit VARCHAR(40),
        context_files JSONB,
        acceptance_criteria JSONB NOT NULL,
        tools_allowed JSONB,
        priority VARCHAR(10) NOT NULL DEFAULT 'normal',
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        trace_id VARCHAR(64),
        attempt INTEGER NOT NULL DEFAULT 1,
        adapter VARCHAR(20),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS mission_reports (
        id VARCHAR(36) PRIMARY KEY,
        mission_id VARCHAR(36) NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL,
        adapter VARCHAR(20) NOT NULL,
        summary TEXT NOT NULL,
        artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
        test_results JSONB,
        decisions JSONB,
        trace_id VARCHAR(64),
        duration_ms INTEGER NOT NULL,
        error JSONB,
        next_actions JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id VARCHAR(36) PRIMARY KEY,
        mission_id VARCHAR(36) NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS worktrees (
        mission_id VARCHAR(36) PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        branch VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        gc_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS embeddings (
        id VARCHAR(36) PRIMARY KEY,
        mission_id VARCHAR(36) REFERENCES missions(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    dbInstance = drizzlePglite(pgliteInstance, { schema });
    dbType = "pglite";
    return { db: dbInstance, type: dbType };
  }

  try {
    await pgPool.query("CREATE EXTENSION IF NOT EXISTS vector;");
  } catch {
    console.warn("[db] pgvector extension not available — embeddings search will be disabled");
  }

  dbInstance = drizzlePg(pgPool, { schema });
  dbType = "pg";
  return { db: dbInstance, type: dbType };
}

/**
 * Para tests: crea DB aislada en memoria (siempre pglite)
 */
export async function createTestDb(): Promise<{ db: DbInstance; pglite: PGlite }> {
  const pglite = new PGlite();
  // Crear tablas manualmente para tests sin migraciones
  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id VARCHAR(36) PRIMARY KEY,
      type VARCHAR(30) NOT NULL,
      complexity VARCHAR(10) NOT NULL,
      title VARCHAR(80) NOT NULL,
      prompt TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      workspace_repo TEXT NOT NULL,
      workspace_branch VARCHAR(100),
      worktree_path TEXT,
      base_commit VARCHAR(40),
      context_files JSONB,
      acceptance_criteria JSONB NOT NULL,
      tools_allowed JSONB,
      priority VARCHAR(10) NOT NULL DEFAULT 'normal',
      timeout_ms INTEGER NOT NULL DEFAULT 300000,
      trace_id VARCHAR(64),
      attempt INTEGER NOT NULL DEFAULT 1,
      adapter VARCHAR(20),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS mission_reports (
      id VARCHAR(36) PRIMARY KEY,
      mission_id VARCHAR(36) NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL,
      adapter VARCHAR(20) NOT NULL,
      summary TEXT NOT NULL,
      artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
      test_results JSONB,
      decisions JSONB,
      trace_id VARCHAR(64),
      duration_ms INTEGER NOT NULL,
      error JSONB,
      next_actions JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id VARCHAR(36) PRIMARY KEY,
      mission_id VARCHAR(36) NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      rationale TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS worktrees (
      mission_id VARCHAR(36) PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      branch VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      gc_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      id VARCHAR(36) PRIMARY KEY,
      mission_id VARCHAR(36) REFERENCES missions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const db = drizzlePglite(pglite, { schema });
  return { db, pglite };
}

export async function closeDb(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  if (pgliteInstance) {
    await pgliteInstance.close();
    pgliteInstance = null;
  }
  dbInstance = null;
  dbType = null;
}

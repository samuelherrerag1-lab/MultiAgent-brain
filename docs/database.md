# 6. Esquema de Base de Datos (Drizzle ORM)

> Reemplaza placeholder `123456...24`. Motor: **PostgreSQL 16 + pgvector 0.8**. ORM: Drizzle. Sin Docker usa `Neon` remoto + `pglite` para tests.

## 6.1 Conexión

```typescript
// apps/orchestrator/src/db/client.ts
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "drizzle-orm/pg-core"; // custom

export function createDb(url: string) {
  if (url.includes("memory:") || process.env.DB_DRIVER === "pglite") {
    const client = new PGlite(url);
    return drizzlePglite(client);
  }
  return drizzlePg(url); // pg Pool
}
```

`drizzle.config.ts` en `apps/orchestrator`:

```typescript
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Migración pgvector requiere SQL manual (drizzle-kit no genera `CREATE EXTENSION`):

```sql
-- drizzle/0000_init.sql (generado + editado)
CREATE EXTENSION IF NOT EXISTS vector;
```

## 6.2 Tablas

```typescript
// apps/orchestrator/src/db/schema.ts
import { pgTable, text, timestamp, integer, jsonb, varchar, index, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// pgvector: Drizzle no tiene vector nativo, se define custom
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector(1536)"; },
  toDriver(value) { return JSON.stringify(value); },
  fromDriver(value) { return JSON.parse(value as string); },
});

export const missions = pgTable("missions", {
  id: varchar("id", { length: 36 }).primaryKey(), // missionId uuid
  type: varchar("type", { length: 30 }).notNull(),
  complexity: varchar("complexity", { length: 10 }).notNull(),
  title: varchar("title", { length: 80 }).notNull(),
  prompt: text("prompt").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  workspaceRepo: text("workspace_repo").notNull(),
  workspaceBranch: varchar("workspace_branch", { length: 100 }),
  worktreePath: text("worktree_path"),
  baseCommit: varchar("base_commit", { length: 40 }),
  contextFiles: jsonb("context_files").$type<string[]>(),
  acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull(),
  toolsAllowed: jsonb("tools_allowed").$type<string[]>(),
  priority: varchar("priority", { length: 10 }).notNull().default("normal"),
  timeoutMs: integer("timeout_ms").notNull().default(300000),
  traceId: varchar("trace_id", { length: 64 }),
  attempt: integer("attempt").notNull().default(1),
  adapter: varchar("adapter", { length: 20 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("missions_status_idx").on(t.status),
  index("missions_type_idx").on(t.type),
]);

export const missionReports = pgTable("mission_reports", {
  id: varchar("id", { length: 36 }).primaryKey(), // mismo que missionId
  missionId: varchar("mission_id", { length: 36 }).notNull().references(() => missions.id),
  status: varchar("status", { length: 20 }).notNull(),
  adapter: varchar("adapter", { length: 20 }).notNull(),
  summary: text("summary").notNull(),
  artifacts: jsonb("artifacts").$type<{ path: string; kind: string; bytes?: number }[]>().notNull().default([]),
  testResults: jsonb("test_results").$type<{ passed: number; failed: number; coverage?: number; output?: string }>(),
  decisions: jsonb("decisions").$type<{ decision: string; rationale: string; at: number }[]>(),
  traceId: varchar("trace_id", { length: 64 }),
  durationMs: integer("duration_ms").notNull(),
  error: jsonb("error").$type<{ message: string; stack?: string; code?: string }>(),
  nextActions: jsonb("next_actions").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const decisions = pgTable("decisions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  missionId: varchar("mission_id", { length: 36 }).notNull().references(() => missions.id),
  decision: text("decision").notNull(),
  rationale: text("rationale").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("decisions_mission_idx").on(t.missionId),
]);

export const worktrees = pgTable("worktrees", {
  missionId: varchar("mission_id", { length: 36 }).primaryKey().references(() => missions.id),
  path: text("path").notNull(),
  branch: varchar("branch", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  gcAt: timestamp("gc_at"),
});

export const embeddings = pgTable("embeddings", {
  id: varchar("id", { length: 36 }).primaryKey(),
  missionId: varchar("mission_id", { length: 36 }).references(() => missions.id),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // HNSW para búsqueda RAG de decisions (pgvector 0.8)
  index("embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
]);
```

## 6.3 Índices y pgvector

* `vector(1536)` — dimensión `text-embedding-3-small` o `qwen-embedding`. Cambiar `dimensions` si usas otro modelo, requiere migración.
* `hnsw` con `vector_cosine_ops` — recomendado sobre `ivfflat` para datasets <1M sin `VACUUM`.
* Crear extensión antes de migrar:

```ps
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
pnpm --filter orchestrator db:migrate
```

## 6.4 Flujo Drizzle

```ps
pnpm --filter orchestrator db:generate  # genera drizzle/0000_*.sql
# editar 0000 para añadir CREATE EXTENSION vector;
pnpm --filter orchestrator db:migrate   # aplica
pnpm --filter orchestrator db:studio    # Drizzle Studio http://local.drizzle.studio
```

## 6.5 Alternativas sin PG

| Caso | Driver | URL |
|---|---|---|
| Dev local sin Docker | `pglite` (`@electric-sql/pglite`) | `memory://` o `file:./.pglite` |
| CI/tests | `pglite` memory | `memory://` |
| Prod/Dev remoto | `pg` (`node-postgres`) | `postgresql://...neon.tech` |

El código `createDb()` abstrae el driver; schemas son idénticos.

## 6.6 Queries típicas

```typescript
// Kanban: misiones por status
await db.select().from(missions).where(eq(missions.status, "running"));

// Memoria RAG: buscar decisions similares a un error
await db.execute(sql`SELECT decision, rationale FROM decisions ORDER BY embedding <=> ${queryVector} LIMIT 5`);

// GC worktrees huérfanos
await db.delete(worktrees).where(lt(worktrees.gcAt, new Date()));
```

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  varchar,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * pgvector — Drizzle no tiene tipo vector nativo.
 * Se define como customType. En PG real requiere `CREATE EXTENSION vector`.
 * En pglite se usa como TEXT fallback (ver client.ts).
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value) {
    return JSON.stringify(value);
  },
  fromDriver(value) {
    return JSON.parse(value as string);
  },
});

// ---------------------------------------------------------------------------
// missions — tabla principal
// ---------------------------------------------------------------------------
export const missions = pgTable(
  "missions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
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
    timeoutMs: integer("timeout_ms").notNull().default(300_000),
    traceId: varchar("trace_id", { length: 64 }),
    attempt: integer("attempt").notNull().default(1),
    adapter: varchar("adapter", { length: 20 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("missions_status_idx").on(t.status),
    index("missions_type_idx").on(t.type),
    index("missions_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// mission_reports — 1:1 con missions
// ---------------------------------------------------------------------------
export const missionReports = pgTable("mission_reports", {
  id: varchar("id", { length: 36 }).primaryKey(),
  missionId: varchar("mission_id", { length: 36 })
    .notNull()
    .references(() => missions.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull(),
  adapter: varchar("adapter", { length: 20 }).notNull(),
  summary: text("summary").notNull(),
  artifacts: jsonb("artifacts")
    .$type<{ path: string; kind: string; bytes?: number }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  testResults: jsonb("test_results").$type<{
    passed: number;
    failed: number;
    coverage?: number;
    output?: string;
  }>(),
  decisions: jsonb("decisions").$type<{ decision: string; rationale: string; at: number }[]>(),
  traceId: varchar("trace_id", { length: 64 }),
  durationMs: integer("duration_ms").notNull(),
  error: jsonb("error").$type<{ message: string; stack?: string; code?: string }>(),
  nextActions: jsonb("next_actions").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// decisions — memoria RAG
// ---------------------------------------------------------------------------
export const decisions = pgTable(
  "decisions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    missionId: varchar("mission_id", { length: 36 })
      .notNull()
      .references(() => missions.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("decisions_mission_idx").on(t.missionId)],
);

// ---------------------------------------------------------------------------
// worktrees — tracking de git worktrees
// ---------------------------------------------------------------------------
export const worktrees = pgTable("worktrees", {
  missionId: varchar("mission_id", { length: 36 })
    .primaryKey()
    .references(() => missions.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  branch: varchar("branch", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  gcAt: timestamp("gc_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// embeddings — RAG para decisions (pgvector)
// En pglite se almacena como jsonb fallback si no hay extensión vector.
// ---------------------------------------------------------------------------
export const embeddings = pgTable(
  "embeddings",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    missionId: varchar("mission_id", { length: 36 }).references(() => missions.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    // En PG: vector(1536). En pglite fallback: jsonb text (ver migraciones condicionales)
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // HNSW solo en PG real; pglite lo ignora (ver drizzle/0000_init.sql comentario)
    // index("embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// Tipos inferidos
export type MissionRow = typeof missions.$inferSelect;
export type NewMissionRow = typeof missions.$inferInsert;
export type MissionReportRow = typeof missionReports.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type WorktreeRow = typeof worktrees.$inferSelect;
export type EmbeddingRow = typeof embeddings.$inferSelect;

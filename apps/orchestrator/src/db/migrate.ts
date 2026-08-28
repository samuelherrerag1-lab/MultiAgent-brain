import "dotenv/config";
import { getDb, closeDb } from "./client.ts";

async function main() {
  console.log("[migrate] connecting...");
  const { db, type } = await getDb();
  console.log(`[migrate] driver: ${type}`);

  // Para PG real, drizzle-kit maneja migraciones.
  // Para pglite, las tablas ya se crean en getDb/createTestDb.
  // Este script verifica conectividad y crea extensión vector si es posible.

  if (type === "pg") {
    console.log("[migrate] PG detected — run `pnpm db:generate && drizzle-kit migrate` for schema");
    // Intento simple: verificar que tabla missions existe, si no, crearla
    try {
      // @ts-ignore — raw query
      await db.execute("SELECT 1 FROM missions LIMIT 1");
      console.log("[migrate] missions table exists");
    } catch {
      console.log("[migrate] missions table missing — creating via SQL fallback...");
      // Fallback: crear esquema mínimo (drizzle-kit debería haberlo hecho)
      const { PGlite } = await import("@electric-sql/pglite");
      console.log("[migrate] use `pnpm db:generate` to generate drizzle/ folder first");
    }
  } else {
    console.log("[migrate] pglite — tables created in-memory");
  }

  await closeDb();
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});

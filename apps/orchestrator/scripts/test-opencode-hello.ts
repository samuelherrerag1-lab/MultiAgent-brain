/**
 * Script de prueba FASE 2 — OpencodeAdapter hello_world.py
 * Uso:
 *   pnpm --filter @cerebro/orchestrator exec tsx scripts/test-opencode-hello.ts
 *   # o con mock (sin opencode real):
 *   MOCK=1 pnpm --filter @cerebro/orchestrator exec tsx scripts/test-opencode-hello.ts
 *
 * Valida que el adapter:
 * - Crea worktree y AGENTS.md
 * - Ejecuta `opencode run --format json --dir <worktree>` (o mock)
 * - Retorna MissionReport con artifact hello_world.py
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createOpencodeAdapter, type SpawnFn } from "../src/adapters/opencode.ts";
import type { Mission } from "@cerebro/shared/protocols";

const isMock = process.env.MOCK === "1";

const mission: Mission = {
  missionId: crypto.randomUUID(),
  type: "execute",
  complexity: "low",
  title: "Crea hello_world.py",
  prompt: "Crea un archivo hello_world.py que al ejecutarse imprima 'hello world'. Usa Python.",
  workspace: { repo: "." },
  acceptanceCriteria: ["hello_world.py existe", "python hello_world.py imprime hello world"],
  createdAt: Date.now(),
  priority: "normal",
  timeoutMs: 120_000,
  attempt: 1,
} as Mission;

async function main() {
  console.log(`[test-opencode] missionId=${mission.missionId} mock=${isMock}`);

  let spawnFn: SpawnFn | undefined;
  let tmpDir = path.join(os.tmpdir(), `cerebro-hello-${Date.now()}`);

  if (isMock) {
    spawnFn = async (_cmd, _args, opts) => {
      const dir = opts.cwd;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "hello_world.py"), "print('hello world')\n", "utf-8");
      return { stdout: JSON.stringify({ text: "Creado hello_world.py" }), stderr: "", exitCode: 0 };
    };
    console.log("[test-opencode] usando MOCK spawn");
  } else {
    console.log("[test-opencode] usando opencode real (requiere ollama + opencode 1.18+)");
    console.log(`[test-opencode] worktreesDir=${tmpDir}`);
  }

  const adapter = createOpencodeAdapter({ spawnFn, worktreesDir: tmpDir });

  console.log("[test-opencode] healthCheck...");
  const health = await adapter.healthCheck();
  console.log("[test-opencode] health:", health);
  if (!health.ok && !isMock) {
    console.warn("[test-opencode] opencode health failed — prueba con MOCK=1");
  }

  console.log("[test-opencode] execute...");
  const report = await adapter.execute(mission);
  console.log("[test-opencode] report:", JSON.stringify(report, null, 2));

  const hasHello = report.artifacts.some((a) => a.path.includes("hello_world.py"));
  console.log(`[test-opencode] artifacts has hello_world.py: ${hasHello}`);
  console.log(`[test-opencode] status: ${report.status}`);

  if (report.status === "success" && hasHello) {
    console.log("✅ TEST PASÓ — hello_world.py creado");
    process.exit(0);
  } else {
    console.error("❌ TEST FALLÓ");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

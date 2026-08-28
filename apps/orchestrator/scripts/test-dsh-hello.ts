/**
 * Script de prueba FASE 3 — DeepSeekAdapter hello_dsh.py
 * Uso:
 *   pnpm --filter @cerebro/orchestrator exec tsx scripts/test-dsh-hello.ts
 *   MOCK=1 pnpm --filter @cerebro/orchestrator exec tsx scripts/test-dsh-hello.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createDeepSeekAdapter, type FetchFn } from "../src/adapters/deepseek.ts";
import type { SpawnFn } from "../src/adapters/types.ts";
import type { Mission } from "@cerebro/shared/protocols";

const isMock = process.env.MOCK === "1";

const mission: Mission = {
  missionId: crypto.randomUUID(),
  type: "build",
  complexity: "low",
  title: "Crea hello_dsh.py",
  prompt: "Crea un archivo hello_dsh.py que al ejecutarse imprima 'hello from DSH'.",
  workspace: { repo: "." },
  acceptanceCriteria: ["hello_dsh.py existe", "ejecuta imprime hello"],
  createdAt: Date.now(),
  priority: "normal",
  timeoutMs: 120_000,
  attempt: 1,
} as Mission;

async function main() {
  console.log(`[test-dsh] missionId=${mission.missionId} mock=${isMock}`);
  let spawnFn: SpawnFn | undefined;
  let fetchFn: FetchFn | undefined;
  const tmpDir = path.join(os.tmpdir(), `cerebro-dsh-hello-${Date.now()}`);

  if (isMock) {
    spawnFn = async (_cmd, _args, opts) => {
      const dir = opts.cwd;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "hello_dsh.py"), "print('hello from DSH')\n", "utf-8");
      return { stdout: JSON.stringify({ text: "DSH: hello_dsh.py creado" }), stderr: "", exitCode: 0 };
    };
    console.log("[test-dsh] usando MOCK spawn");
  } else {
    console.log("[test-dsh] usando DSH real (requiere dsh + profile headless)");
  }

  const adapter = createDeepSeekAdapter({ spawnFn, fetchFn, worktreesDir: tmpDir, useHttpGateway: false });

  console.log("[test-dsh] healthCheck...");
  const health = await adapter.healthCheck();
  console.log("[test-dsh] health:", health);

  console.log("[test-dsh] execute...");
  const report = await adapter.execute(mission);
  console.log("[test-dsh] report:", JSON.stringify(report, null, 2));

  const hasHello = report.artifacts.some((a) => a.path.includes("hello_dsh.py"));
  console.log(`[test-dsh] artifacts has hello_dsh.py: ${hasHello}`);

  if (report.status === "success" && hasHello) {
    console.log("✅ TEST PASÓ — hello_dsh.py creado via DSH");
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

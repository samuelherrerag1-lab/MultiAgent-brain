/**
 * setup-qwen-profile.ts — Abre Chromium persistente para login manual en chat.qwen.ai
 * Uso:
 *   pnpm --filter @cerebro/orchestrator exec tsx scripts/setup-qwen-profile.ts -- --headful
 *   # se abre ventana Chromium, loguéate con GitHub, selecciona QwenMax-3.8, luego cierra
 */

import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";

const isHeadful = process.argv.includes("--headful");
const headless = !isHeadful;

const defaultDir = path.join(os.homedir(), "AppData", "Local", "CerebroQwen", "user-data");
if (process.platform !== "win32") {
  // fallback para no-Windows (no usado pero por completitud)
}

const userDataDir = process.env.QWEN_USER_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CerebroQwen", "user-data");

console.log(`[setup-qwen] userDataDir=${userDataDir}`);
console.log(`[setup-qwen] headless=${headless} (usa --headful para login manual)`);
console.log(`[setup-qwen] Abriendo https://chat.qwen.ai ...`);

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless,
  args: ["--disable-blink-features=AutomationControlled"],
  viewport: { width: 1280, height: 900 },
});

const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://chat.qwen.ai", { waitUntil: "domcontentloaded", timeout: 30_000 });

console.log("[setup-qwen] Página cargada. Título:", await page.title());

if (isHeadful) {
  console.log("\n[setup-qwen] >>> VENTANA ABIERTA — Acciones manuales requeridas:");
  console.log("  1. Si no estás logueado, inicia sesión con GitHub");
  console.log("  2. Selecciona modelo QwenMax-3.8 en el selector superior");
  console.log("  3. Envía un mensaje de prueba (ej: 'hola')");
  console.log("  4. Verifica que responde correctamente");
  console.log("  5. Cierra la ventana cuando termines (Ctrl+C aquí también funciona)\n");
  console.log("[setup-qwen] Esperando cierre manual... (Ctrl+C para salir)");

  // Mantener vivo hasta que el usuario cierre el browser
  await new Promise<void>((resolve) => {
    ctx.on("close", () => {
      console.log("[setup-qwen] Contexto cerrado");
      resolve();
    });
    // También esperar Ctrl+C
    process.on("SIGINT", async () => {
      console.log("\n[setup-qwen] SIGINT recibido, cerrando...");
      await ctx.close();
      resolve();
    });
  });
} else {
  // Headless check rápido
  try {
    await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 15_000 });
    console.log("[setup-qwen] ✓ textarea detectado — sesión parece válida (headless)");
  } catch {
    console.warn("[setup-qwen] ✗ textarea no detectado en 15s — probablemente requiere login manual. Ejecuta con --headful");
  }
  await ctx.close();
  console.log("[setup-qwen] Cerrado (headless).");
}

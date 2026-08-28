import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import os from "node:os";
import { QWEN_SELECTORS, joinSelectors } from "./qwen.selector.ts";

export type QwenChatOptions = {
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
  modelLabel?: string;
};

const DEFAULT_TIMEOUT = 90_000;
const DEFAULT_MODEL_LABEL = "QwenMax-3.8";

let ctxSingleton: BrowserContext | null = null;
let pageSingleton: Page | null = null;

function getUserDataDir(opts?: QwenChatOptions): string {
  if (opts?.userDataDir) return path.resolve(opts.userDataDir);
  if (process.env.QWEN_USER_DATA_DIR) return path.resolve(process.env.QWEN_USER_DATA_DIR);
  // Windows default confirmado por usuario
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "CerebroQwen", "user-data");
}

export async function getQwenContext(opts: QwenChatOptions = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const userDataDir = getUserDataDir(opts);
  const headless = opts.headless ?? process.env.QWEN_HEADLESS !== "false";

  if (ctxSingleton && pageSingleton) {
    try {
      // Verificar que no esté cerrado
      if (!ctxSingleton.pages().includes(pageSingleton) && ctxSingleton.pages().length > 0) {
        pageSingleton = ctxSingleton.pages()[0]!;
      } else if (pageSingleton.isClosed()) {
        pageSingleton = await ctxSingleton.newPage();
      }
      return { ctx: ctxSingleton, page: pageSingleton };
    } catch {
      // recrear
      ctxSingleton = null;
      pageSingleton = null;
    }
  }

  ctxSingleton = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
    viewport: { width: 1280, height: 900 },
    locale: "es-ES",
  });

  pageSingleton = ctxSingleton.pages()[0] || (await ctxSingleton.newPage());
  return { ctx: ctxSingleton, page: pageSingleton };
}

export async function closeQwenContext(): Promise<void> {
  if (ctxSingleton) {
    try {
      await ctxSingleton.close();
    } catch {}
    ctxSingleton = null;
    pageSingleton = null;
  }
}

async function trySelectModel(page: Page, modelLabel: string, timeoutMs: number): Promise<boolean> {
  try {
    const selector = page.locator(joinSelectors("modelSelector")).first();
    const count = await selector.count();
    if (count === 0) {
      console.warn("[qwen] modelSelector no encontrado — asumiendo QwenMax-3.8 por defecto");
      return true;
    }
    await selector.click({ timeout: 5_000 });
    await page.waitForTimeout(800);

    // Intentar click en la opción QwenMax-3.8
    for (const sel of QWEN_SELECTORS.modelOptionMax38) {
      const opt = page.locator(sel).first();
      try {
        if ((await opt.count()) > 0) {
          await opt.click({ timeout: 3_000 });
          await page.waitForTimeout(600);
          console.log(`[qwen] modelo seleccionado via selector: ${sel}`);
          return true;
        }
      } catch {}
    }
    // Fallback: buscar por texto que contenga modelLabel
    const byText = page.getByText(modelLabel, { exact: false }).first();
    try {
      if ((await byText.count()) > 0) {
        await byText.click({ timeout: 3_000 });
        return true;
      }
    } catch {}

    // Si no se encontró opción, cerrar dropdown con Escape y asumir default
    await page.keyboard.press("Escape");
    console.warn(`[qwen] opción ${modelLabel} no encontrada — usando modelo por defecto`);
    return true;
  } catch (err) {
    console.warn("[qwen] trySelectModel error:", String(err).slice(0, 200));
    return false;
  }
}

async function findTextarea(page: Page): Promise<ReturnType<Page["locator"]> | null> {
  for (const sel of QWEN_SELECTORS.textarea) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) > 0) {
        const visible = await loc.isVisible().catch(() => false);
        if (visible) return loc;
      }
    } catch {}
  }
  return null;
}

async function waitForStreamingEnd(page: Page, timeoutMs: number): Promise<void> {
  const start = Date.now();

  // Estrategia 1: esperar que botón Stop desaparezca y Regenerate aparezca
  try {
    // Esperar a que Stop desaparezca (streaming terminó)
    const stopLocator = page.locator(joinSelectors("stop"));
    // Poll hasta que stop no esté visible o timeout
    while (Date.now() - start < timeoutMs) {
      const stopCount = await stopLocator.count().catch(() => 0);
      let stopVisible = false;
      if (stopCount > 0) {
        try {
          stopVisible = await stopLocator.first().isVisible({ timeout: 500 }).catch(() => false);
        } catch {
          stopVisible = false;
        }
      }

      if (!stopVisible) {
        // Verificar que Regenerate apareció o que el último mensaje no crece
        const regen = page.locator(joinSelectors("regenerate")).first();
        const regenVisible = await regen.isVisible().catch(() => false).then((v) => v).catch(() => false);
        if (regenVisible) return;

        // Fallback: esperar 2s y verificar que el contenido del asistente no cambia
        const assistant = page.locator(joinSelectors("assistant")).last();
        try {
          const before = await assistant.innerText().catch(() => "");
          await page.waitForTimeout(1500);
          const after = await assistant.innerText().catch(() => "");
          if (before === after && before.length > 0) return;
        } catch {}

        // Si no hay Regenerate pero tampoco Stop, asumir fin tras 2s sin cambios
        await page.waitForTimeout(1000);
        return;
      }

      await page.waitForTimeout(800);
    }
  } catch (err) {
    console.warn("[qwen] waitForStreamingEnd error:", String(err).slice(0, 200));
  }

  // Fallback: esperar timeout restante y verificar que haya contenido
  await page.waitForTimeout(Math.min(2000, Math.max(0, timeoutMs - (Date.now() - start))));
}

/**
 * Consulta a Qwen Chat y retorna el texto del último mensaje del asistente.
 * Usa PersistentContext con sesión ya iniciada (GitHub) en userDataDir.
 */
export async function consultArchitectChat(
  objective: string,
  opts: QwenChatOptions = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const modelLabel = opts.modelLabel ?? DEFAULT_MODEL_LABEL;
  const { page } = await getQwenContext(opts);

  // Navegar a chat.qwen.ai si no estamos allí
  const url = page.url();
  if (!url.includes("chat.qwen.ai")) {
    await page.goto("https://chat.qwen.ai", { waitUntil: "domcontentloaded", timeout: 30_000 });
  } else {
    // Si ya estamos, asegurar que la página esté lista
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  // Detectar login requerido / captcha
  const loginLocator = page.locator(joinSelectors("login")).first();
  try {
    if ((await loginLocator.count()) > 0 && (await loginLocator.isVisible({ timeout: 2000 }).catch(() => false))) {
      throw new Error("QWEN_LOGIN_REQUIRED: Inicia sesión con GitHub en chat.qwen.ai (ejecuta setup-qwen-profile con --headful)");
    }
  } catch (err) {
    if (String(err).includes("QWEN_LOGIN_REQUIRED")) throw err;
  }

  const captchaLocator = page.locator(joinSelectors("captcha")).first();
  try {
    if ((await captchaLocator.count()) > 0 && (await captchaLocator.isVisible({ timeout: 2000 }).catch(() => false))) {
      throw new Error("QWEN_CAPTCHA: Cloudflare/captcha detectado — espera y reintenta");
    }
  } catch (err) {
    if (String(err).includes("QWEN_CAPTCHA")) throw err;
  }

  // Seleccionar modelo QwenMax-3.8
  await trySelectModel(page, modelLabel, 10_000);

  // Encontrar textarea
  const textarea = await findTextarea(page);
  if (!textarea) {
    // Debug: guardar screenshot y html para diagnosticar
    try {
      await page.screenshot({ path: path.join(process.cwd(), "qwen-debug.png"), fullPage: true }).catch(() => {});
      const html = await page.content().catch(() => "");
      console.error("[qwen] textarea no encontrada. HTML head:", html.slice(0, 2000));
    } catch {}
    throw new Error("QWEN_TEXTAREA_NOT_FOUND: No se encontró textarea en chat.qwen.ai — selectores desactualizados");
  }

  // Contar mensajes asistente antes de enviar (para identificar el nuevo)
  const prevCount = await page.locator(joinSelectors("assistant")).count().catch(() => 0);

  // Inyectar prompt
  await textarea.click({ timeout: 5_000 }).catch(() => {});
  await textarea.fill(objective, { timeout: 10_000 }).catch(async () => {
    // Fallback: contenteditable
    await textarea.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(objective, { delay: 10 });
  });

  // Enviar con Enter
  await page.keyboard.press("Enter");
  // Algunos UIs requieren click en botón enviar si Enter no funciona
  await page.waitForTimeout(800);

  // Esperar fin de streaming
  await waitForStreamingEnd(page, timeoutMs);

  // Extraer último mensaje asistente
  const assistantLoc = page.locator(joinSelectors("assistant"));
  const count = await assistantLoc.count().catch(() => 0);
  if (count === 0) {
    throw new Error("QWEN_NO_RESPONSE: No se encontró mensaje del asistente tras esperar streaming");
  }

  // Si hay mensajes nuevos, tomar el último; si no, tomar el último existente
  const targetIdx = count - 1;
  const last = assistantLoc.nth(targetIdx);
  let text = "";
  try {
    text = await last.innerText({ timeout: 10_000 });
  } catch {
    text = await last.textContent().then((t) => t || "").catch(() => "");
  }

  text = text.trim();
  if (!text) {
    throw new Error("QWEN_EMPTY_RESPONSE: Mensaje del asistente vacío");
  }

  // Verificar que no es el mismo mensaje anterior (si había)
  if (prevCount > 0 && count === prevCount) {
    console.warn("[qwen] count no aumentó tras prompt — puede ser respuesta cacheada o error");
  }

  if (text.length > 4000) text = text.slice(0, 3997) + "...";

  return text;
}

/**
 * Health check rápido: verifica que la sesión existe y textarea está visible.
 */
export async function healthCheckChat(opts: QwenChatOptions = {}): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    const { page } = await getQwenContext({ ...opts, headless: opts.headless ?? true });
    const url = page.url();
    if (!url.includes("chat.qwen.ai")) {
      await page.goto("https://chat.qwen.ai", { waitUntil: "domcontentloaded", timeout: 15_000 });
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});

    const loginLocator = page.locator(joinSelectors("login")).first();
    if ((await loginLocator.count()) > 0) {
      const visible = await loginLocator.isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) return { ok: false, error: "QWEN_LOGIN_REQUIRED" };
    }

    const textarea = await findTextarea(page);
    if (!textarea) return { ok: false, error: "QWEN_TEXTAREA_NOT_FOUND" };

    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

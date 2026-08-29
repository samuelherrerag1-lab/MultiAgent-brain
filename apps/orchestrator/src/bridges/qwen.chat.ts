import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import os from "node:os";
import { QWEN_SELECTORS, joinSelectors } from "./qwen.selector.ts";

export type QwenChatOptions = {
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
  modelLabel?: string;
  maxChars?: number;
};

const DEFAULT_TIMEOUT = 90_000;
const DEFAULT_MODEL_LABEL = "QwenMax-3.8";

let ctxSingleton: BrowserContext | null = null;
let pageSingleton: Page | null = null;

/**
 * Mutex FIFO simple para serializar llamadas concurrentes a la sesión Playwright
 */
class SimpleMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

export const qwenMutex = new SimpleMutex();

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

/**
 * Lanza ventana headful para login interactivo
 */
export async function startQwenHeadfulLogin(opts: QwenChatOptions = {}): Promise<void> {
  await closeQwenContext();
  const userDataDir = getUserDataDir(opts);
  ctxSingleton = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1280, height: 900 },
  });
  pageSingleton = ctxSingleton.pages()[0] || (await ctxSingleton.newPage());
  await pageSingleton.goto("https://chat.qwen.ai", { waitUntil: "domcontentloaded", timeout: 30_000 });
}

async function trySelectModel(page: Page, modelLabel: string, timeoutMs: number): Promise<boolean> {
  try {
    const selector = page.locator(joinSelectors("modelSelector")).first();
    const count = await selector.count();
    if (count === 0) {
      return true;
    }
    await selector.click({ timeout: 5_000 });
    await page.waitForTimeout(600);

    // Mapear selector según modelLabel
    let optionSelectors: readonly string[] = QWEN_SELECTORS.modelOptionMax38;
    const lower = modelLabel.toLowerCase();
    if (lower.includes("turbo")) optionSelectors = QWEN_SELECTORS.modelOptionTurbo;
    else if (lower.includes("plus")) optionSelectors = QWEN_SELECTORS.modelOptionPlus;
    else if (lower.includes("max") && !lower.includes("3.8")) optionSelectors = QWEN_SELECTORS.modelOptionMax;

    // Intentar click en la opción específica
    for (const sel of optionSelectors) {
      const opt = page.locator(sel).first();
      try {
        if ((await opt.count()) > 0) {
          await opt.click({ timeout: 3_000 });
          await page.waitForTimeout(500);
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

/**
 * Consulta a Qwen Chat con streaming incremental mediante chunks.
 * Protegido por Mutex FIFO.
 */
export async function consultArchitectChatStream(
  objective: string,
  onChunk: (chunk: string) => void = () => {},
  opts: QwenChatOptions = {},
): Promise<string> {
  return qwenMutex.runExclusive(async () => {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
    const modelLabel = opts.modelLabel ?? DEFAULT_MODEL_LABEL;
    const maxChars = opts.maxChars ?? 32_000;
    const { page } = await getQwenContext(opts);

    // Navegar a chat.qwen.ai si no estamos allí
    const url = page.url();
    if (!url.includes("chat.qwen.ai")) {
      await page.goto("https://chat.qwen.ai", { waitUntil: "domcontentloaded", timeout: 30_000 });
    } else {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }

    // Detectar login requerido / captcha
    const loginLocator = page.locator(joinSelectors("login")).first();
    try {
      if ((await loginLocator.count()) > 0 && (await loginLocator.isVisible({ timeout: 2000 }).catch(() => false))) {
        throw new Error("QWEN_LOGIN_REQUIRED: Inicia sesión con GitHub en chat.qwen.ai (ejecuta setup-qwen-profile con --headful o usa el botón de login)");
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

    // Seleccionar modelo
    await trySelectModel(page, modelLabel, 10_000);

    // Encontrar textarea
    const textarea = await findTextarea(page);
    if (!textarea) {
      try {
        await page.screenshot({ path: path.join(process.cwd(), "qwen-debug.png"), fullPage: true }).catch(() => {});
      } catch {}
      throw new Error("QWEN_TEXTAREA_NOT_FOUND: No se encontró textarea en chat.qwen.ai — selectores desactualizados");
    }

    // Inyectar prompt
    await textarea.click({ timeout: 5_000 }).catch(() => {});
    await textarea.fill(objective, { timeout: 10_000 }).catch(async () => {
      await textarea.focus();
      await page.keyboard.press("Control+A");
      await page.keyboard.type(objective, { delay: 10 });
    });

    // Enviar con Enter
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);

    // Loop de polling de streaming
    const start = Date.now();
    let prevText = "";
    const assistantLoc = page.locator(joinSelectors("assistant"));
    const stopLocator = page.locator(joinSelectors("stop"));
    const regenLocator = page.locator(joinSelectors("regenerate"));

    let stableCount = 0;

    while (Date.now() - start < timeoutMs) {
      await page.waitForTimeout(350);

      const count = await assistantLoc.count().catch(() => 0);
      let currentText = "";
      if (count > 0) {
        const lastMsg = assistantLoc.last();
        try {
          currentText = (await lastMsg.innerText({ timeout: 1000 })).trim();
        } catch {
          currentText = (await lastMsg.textContent().catch(() => ""))?.trim() || "";
        }
      }

      if (currentText.length > prevText.length) {
        const delta = currentText.slice(prevText.length);
        onChunk(delta);
        prevText = currentText;
        stableCount = 0;
      } else if (currentText.length > 0 && currentText === prevText) {
        stableCount++;
      }

      // Comprobar estado de finalización
      const stopVisible = (await stopLocator.count().catch(() => 0)) > 0
        ? await stopLocator.first().isVisible({ timeout: 300 }).catch(() => false)
        : false;

      if (!stopVisible && prevText.length > 0) {
        const regenVisible = (await regenLocator.count().catch(() => 0)) > 0
          ? await regenLocator.first().isVisible({ timeout: 300 }).catch(() => false)
          : false;

        if (regenVisible || stableCount >= 4) {
          break;
        }
      }
    }

    if (!prevText) {
      throw new Error("QWEN_NO_RESPONSE: No se recibió respuesta de Qwen tras esperar streaming");
    }

    if (prevText.length > maxChars) {
      prevText = prevText.slice(0, maxChars - 3) + "...";
    }

    return prevText;
  });
}

/**
 * Consulta síncrona a Qwen Chat (compatibilidad).
 */
export async function consultArchitectChat(
  objective: string,
  opts: QwenChatOptions = {},
): Promise<string> {
  return consultArchitectChatStream(objective, () => {}, opts);
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

import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
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

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const CHROME_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-infobars",
  "--password-store=basic",
];

function cleanStaleLocks(userDataDir: string) {
  try {
    const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"];
    for (const f of lockFiles) {
      const p = path.join(userDataDir, f);
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  } catch {}
}

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

  cleanStaleLocks(userDataDir);

  ctxSingleton = await chromium.launchPersistentContext(userDataDir, {
    headless,
    userAgent: USER_AGENT,
    ignoreDefaultArgs: ["--enable-automation"],
    args: CHROME_ARGS,
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
  cleanStaleLocks(userDataDir);

  ctxSingleton = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    userAgent: USER_AGENT,
    ignoreDefaultArgs: ["--enable-automation"],
    args: CHROME_ARGS,
    viewport: { width: 1280, height: 900 },
    locale: "es-ES",
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

export type ChunkMeta = {
  type: "thought" | "response";
  thought: string;
  response: string;
  isThinking: boolean;
};

/**
 * Consulta a Qwen Chat con streaming incremental mediante chunks.
 * Protegido por Mutex FIFO.
 */
export async function consultArchitectChatStream(
  objective: string,
  onChunk: (chunk: string, meta?: ChunkMeta) => void = () => {},
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

    // Loop de polling de streaming con separación de razonamiento y respuesta
    const start = Date.now();
    let prevThought = "";
    let prevResponse = "";
    let prevFull = "";
    let lastExtracted = { thought: "", response: "", full: "", isThinking: false };
    const stopLocator = page.locator(joinSelectors("stop"));
    const regenLocator = page.locator(joinSelectors("regenerate"));

    let stableCount = 0;
    let emptyPollCount = 0;
    const MAX_EMPTY_POLLS = 30; // 30 * 300ms = 9s sin contenido nuevo

    while (Date.now() - start < timeoutMs) {
      await page.waitForTimeout(300);

      const extracted = await page.evaluate((assistantSelectors) => {
        const doc = (globalThis as any).document;
        const findLastElement = (selectors: string[]) => {
          for (const sel of selectors) {
            try {
              const list = doc?.querySelectorAll(sel);
              if (list && list.length > 0) return list[list.length - 1];
            } catch {}
          }
          return null;
        };

        const lastMsg = findLastElement(assistantSelectors);
        if (!lastMsg) {
          return { thought: "", response: "", full: "", isThinking: false };
        }

        const thoughtSelectors = [
          "details",
          '[data-role="thought"]',
          '[data-testid="thought-content"]',
          ".thought-content",
          ".reasoning-content",
          'div[class*="thought"]',
          'div[class*="reason"]',
          'div[class*="think"]',
        ];

        let thoughtText = "";
        let thoughtEl: any = null;
        for (const tSel of thoughtSelectors) {
          try {
            const found = lastMsg.querySelector(tSel);
            if (found) {
              thoughtEl = found;
              thoughtText = (found.textContent || "").trim();
              break;
            }
          } catch {}
        }

        let responseText = "";
        const fullText = (lastMsg.textContent || "").trim();

        if (thoughtEl) {
          try {
            const clone = lastMsg.cloneNode(true) as any;
            for (const tSel of thoughtSelectors) {
              clone.querySelectorAll(tSel).forEach((el: any) => el.remove());
            }
            responseText = (clone.textContent || "").trim();
          } catch {
            responseText = fullText.replace(thoughtText, "").trim();
          }
        } else if (fullText.includes("🤔")) {
          const thinkEnd = fullText.indexOf("🤔");
          if (thinkEnd !== -1) {
            thoughtText = fullText.slice(fullText.indexOf("🤔") + 7, thinkEnd).trim();
            responseText = fullText.slice(thinkEnd + 8).trim();
          } else {
            thoughtText = fullText.slice(fullText.indexOf("🤔") + 7).trim();
            responseText = "";
          }
        } else {
          responseText = fullText;
        }

        const isThinking = thoughtText.length > 0 && responseText.length === 0;

        return {
          thought: thoughtText,
          response: responseText,
          full: fullText,
          isThinking,
        };
      }, [...QWEN_SELECTORS.assistant]).catch(() => ({ thought: "", response: "", full: "", isThinking: false }));

      lastExtracted = extracted;

      if (!extracted.full || extracted.full.length === 0) {
        emptyPollCount++;
        if (emptyPollCount > MAX_EMPTY_POLLS) {
          console.warn("[qwen] No contenido del asistente tras", MAX_EMPTY_POLLS * 300, "ms. Deteniendo streaming.");
          break;
        }
      } else {
        emptyPollCount = 0;
      }

      if (extracted.isThinking) {
        if (extracted.thought.length > prevThought.length) {
          const delta = extracted.thought.slice(prevThought.length);
          onChunk(delta, { type: "thought", thought: extracted.thought, response: extracted.response, isThinking: true });
          prevThought = extracted.thought;
          stableCount = 0;
        } else if (extracted.thought.length > 0 && extracted.thought === prevThought) {
          stableCount++;
        }
      } else {
        if (extracted.response.length > prevResponse.length) {
          const delta = extracted.response.slice(prevResponse.length);
          onChunk(delta, { type: "response", thought: extracted.thought, response: extracted.response, isThinking: false });
          prevResponse = extracted.response;
          stableCount = 0;
        } else if (extracted.full.length > prevFull.length) {
          const delta = extracted.full.slice(prevFull.length);
          onChunk(delta, { type: "response", thought: extracted.thought, response: extracted.full, isThinking: false });
          prevResponse = extracted.full;
          stableCount = 0;
        } else if (prevResponse.length > 0 && (extracted.response === prevResponse || extracted.full === prevFull)) {
          stableCount++;
        }
      }
      prevFull = extracted.full;

      // Comprobar estado de finalización
      const stopVisible = (await stopLocator.count().catch(() => 0)) > 0
        ? await stopLocator.first().isVisible({ timeout: 250 }).catch(() => false)
        : false;

      if (!extracted.isThinking && (prevResponse.length > 0 || prevFull.length > 0)) {
        if (!stopVisible) {
          const regenVisible = (await regenLocator.count().catch(() => 0)) > 0
            ? await regenLocator.first().isVisible({ timeout: 250 }).catch(() => false)
            : false;

          if (regenVisible || stableCount >= 25) {
            console.log("[qwen] Streaming terminado: regenVisible=", regenVisible, "stableCount=", stableCount);
            break;
          }
        }
      } else if (extracted.isThinking) {
        // Mientras esté pensando, no abortar salvo que el botón de regenerar esté visible y estable por mucho tiempo
        if (!stopVisible) {
          const regenVisible = (await regenLocator.count().catch(() => 0)) > 0
            ? await regenLocator.first().isVisible({ timeout: 250 }).catch(() => false)
            : false;
          if (regenVisible && stableCount >= 20) {
            console.log("[qwen] Streaming terminado (thinking): regenVisible=", regenVisible, "stableCount=", stableCount);
            break;
          }
        }
      }
    }

    console.log("[qwen] Resultado final: thoughtLen=", lastExtracted.thought?.length, "responseLen=", lastExtracted.response?.length, "fullLen=", lastExtracted.full?.length, "prevResponseLen=", prevResponse?.length, "prevFullLen=", prevFull?.length);

    let finalResult = "";
    if (lastExtracted.response && lastExtracted.response.length > 0) {
      if (lastExtracted.thought && lastExtracted.thought.length > 0) {
        finalResult = `<details><summary>🧠 Razonamiento / Pensamiento</summary>\n\n${lastExtracted.thought}\n\n</details>\n\n${lastExtracted.response}`;
      } else {
        finalResult = lastExtracted.response;
      }
    } else if (lastExtracted.thought && lastExtracted.thought.length > 0) {
      finalResult = lastExtracted.thought;
    } else if (lastExtracted.full && lastExtracted.full.length > 0) {
      finalResult = lastExtracted.full;
    } else if (prevResponse || prevFull) {
      finalResult = prevResponse || prevFull;
    }

    if (!finalResult) {
      throw new Error("QWEN_NO_RESPONSE: No se recibió respuesta de Qwen tras esperar streaming");
    }

    if (finalResult.length > maxChars) {
      finalResult = finalResult.slice(0, maxChars - 3) + "...";
    }

    return finalResult;
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
 * Health check rápido y no bloqueante: verifica que el perfil de usuario existe o la sesión está viva.
 */
export async function healthCheckChat(opts: QwenChatOptions = {}): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    const userDataDir = getUserDataDir(opts);

    if (ctxSingleton && pageSingleton && !pageSingleton.isClosed()) {
      return { ok: true, latencyMs: Date.now() - start };
    }

    if (fs.existsSync(userDataDir)) {
      return { ok: true, latencyMs: Date.now() - start };
    }

    return { ok: false, error: "Perfil de Qwen no inicializado" };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}


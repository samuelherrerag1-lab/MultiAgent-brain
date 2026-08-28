/**
 * Selectores robustos para chat.qwen.ai — centralizados y versionados.
 * Cada entrada es un array de selectores en orden de preferencia (fallback).
 * El bridge intenta cada uno hasta que uno matchee.
 */

export const QWEN_SELECTORS = {
  /** Textarea o contenteditable donde se escribe el prompt */
  textarea: [
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="Enviar"]',
    'textarea[data-testid*="input"]',
    'textarea',
    '[contenteditable="true"][data-lexical-editor]',
    '[contenteditable="true"]',
    'div[role="textbox"]',
  ],

  /** Botón Stop que aparece mientras streaminea — su desaparición indica fin */
  stop: [
    '[data-testid="stop"]',
    'button:has-text("Stop")',
    'button:has-text("Detener")',
    'button[aria-label*="Stop"]',
    'button[aria-label*="Detener"]',
    '[data-testid="stop-generating"]',
  ],

  /** Botón Regenerate que aparece al terminar — señal alternativa de fin */
  regenerate: [
    '[data-testid="regenerate"]',
    'button:has-text("Regenerate")',
    'button:has-text("Regenerar")',
    'button:has-text("Retry")',
    '[aria-label*="Regenerate"]',
  ],

  /** Mensajes del asistente */
  assistant: [
    '.assistant-message',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '.markdown-body',
    '[role="article"]',
    '.message-assistant',
    'div[class*="assistant"]',
  ],

  /** Selector de modelo (para elegir QwenMax-3.8) */
  modelSelector: [
    '[data-testid="model-selector"]',
    'button:has-text("Qwen")',
    '[aria-label*="Model"]',
    '[data-testid="model-switcher"]',
    'div:has-text("QwenMax")',
  ],

  /** Opción específica QwenMax-3.8 dentro del dropdown */
  modelOptionMax38: [
    'text="QwenMax-3.8"',
    'text="Qwen Max 3.8"',
    'text="QwenMax 3.8"',
    '[data-value*="max"]',
    'li:has-text("QwenMax-3.8")',
  ],

  /** Indicadores de login requerido */
  login: [
    'button:has-text("Log in")',
    'button:has-text("Iniciar sesión")',
    'a:has-text("Sign in")',
    '[data-testid="login"]',
  ],

  /** Overlay de Cloudflare / captcha */
  captcha: [
    'iframe[src*="cloudflare"]',
    'iframe[src*="captcha"]',
    '[class*="captcha"]',
  ],
} as const;

export type QwenSelectorKey = keyof typeof QWEN_SELECTORS;

/**
 * Une selectores con coma para locator conjunto.
 */
export function joinSelectors(key: QwenSelectorKey): string {
  return QWEN_SELECTORS[key].join(", ");
}

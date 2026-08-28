#!/usr/bin/env bash
# Setup Playwright persistent profile para Qwen Bridge (experimental)
# Uso: bash scripts/setup-qwen-profile.sh
# Requiere: pnpm add -D playwright && pnpm exec playwright install --with-deps chromium
# Solo si QWEN_BRIDGE_MODE=playwright (ver docs/adapters.md:5.1)

set -euo pipefail

PROFILE_DIR="${QWEN_USER_DATA_DIR:-$HOME/.cerebro-qwen/user-data}"
echo "Qwen Playwright profile dir: $PROFILE_DIR"
mkdir -p "$PROFILE_DIR"

if ! command -v npx &> /dev/null; then
  echo "npx no encontrado. Instala Node 22 + pnpm."
  exit 1
fi

echo "Instalando Playwright chromium (si falta)..."
npx playwright install --with-deps chromium || npx playwright install chromium

echo "Perfil listo en: $PROFILE_DIR"
echo "Siguiente: inicia sesión manual una vez con:"
echo "  npx playwright codegen --save-storage=auth.json https://chat.qwen.ai"
echo "O lanza el bridge con headless:false la primera vez para login."

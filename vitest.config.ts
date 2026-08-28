import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: false,
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
    // Asegura que include se resuelva desde la raíz del monorepo
    // incluso cuando vitest se invoca desde un workspace (turbo)
    root: path.resolve(import.meta.dirname, "."),
  },
});

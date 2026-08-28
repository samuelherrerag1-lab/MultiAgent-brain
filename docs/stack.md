# 2. Stack Tecnológico

> Reemplaza placeholder del plan original. Runtime **Node 22 LTS + pnpm** como primario. Bun opcional en WSL2.

## 2.1 Tabla de stack

| Capa | Elección | Versión | Por qué | Alternativa |
|---|---|---|---|---|
| **Runtime** | Node.js | `^22.19` LTS | Alineado con DSH (`packageManager: pnpm@11.7`, `node-pty`, `koffi`), estable Windows | Bun 1.3+ solo WSL2 (experimental Win) |
| **Lenguaje** | TypeScript | `6.0.3` strict | DSH ya valida con 6.0.3, no 5.7. `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` | — |
| **Monorepo** | pnpm workspaces + Turborepo | `pnpm 11.24`, `turbo 2.5` | pnpm ya en máquina, Turborepo orquesta builds sin reemplazar pnpm. Evita capturar `C:\Samuel\pnpm-workspace.yaml` raíz | Bun workspaces (solo WSL) |
| **Backend** | Hono | `^4.7` + `@hono/node-server` | Ultra-ligero, Zod `hono/validator`, multi-runtime (Node/Bun/Workers) | Express, Fastify |
| **Validación** | Zod | `^3.24` | Compartido Frontend/Backend/Agentes, `zValidator` en Hono | Typert (DSH interno), Valibot |
| **DB** | PostgreSQL 16 + pgvector | `pgvector 0.8` | RAG, concurrencia, `vector(1536)` hnsw | SQLite + sqlite-vec (solo si no hay PG) |
| **ORM** | Drizzle ORM + drizzle-kit | `^0.38` | Type-safe, `pg` + `pglite` drivers, migraciones SQL | Prisma |
| **Frontend** | Next.js 15 App Router + Tailwind + shadcn/ui | `15.x`, `tailwind 4`, `radix` | SSR, Server Actions, SSE, shadcn ya probado | Vite SPA |
| **Qwen** | `qwen-token-plan` API (Aliyun) | `qwen3.7-plus` | Ya credencial `QWEN_TOKEN_PLAN_API_KEY` en `~/.dsh/settings.yaml`, sin scraping | Playwright `chat.qwen.ai` (experimental) |
| **DSH** | deepseek-harness `0.1.1-rc.2` | perfil `web` | Subagentes, sandbox, session persistence. Requiere plugin `dsh-mission-gateway` custom | HTTP genérico |
| **Opencode** | opencode `1.18.23` + Ollama | `MFDoom/deepseek-coder-v2:16b` | Local, barato para refactor/tests. `opencode run --format json` | — |
| **Tests** | Vitest | `^3.0` | Alineado DSH | Jest |

## 2.2 Requisitos de máquina

```ps
node --version  # v22.20.0 OK
pnpm --version  # 11.24.0 OK (corepack enable pnpm)
git --version   # 2.55 OK
# Opcional:
docker --version  # si quieres PG local; si no, usa Neon remoto
psql --version    # si instalas PG nativo EDB
```

**Sin Docker:** usar `Neon` (https://neon.tech) — PG16 + `CREATE EXTENSION vector` preactivado, `DATABASE_URL` remoto. Para tests locales: `@electric-sql/pglite` (WASM, sin servicio).

## 2.3 Path con espacios — mitigación

Ruta `C:\Users\USUARIO\Documents\Samuel\Cerebro de Agentes` contiene espacio. Mitigaciones aplicadas:

* `pnpm-workspace.yaml` propio aísla workspace (no hereda `C:\Samuel\pnpm-workspace.yaml`).
* Todos los scripts usan `path.join` / `"` quoting en `turbo.json`.
* `qwen-profile` y `.cerebro-worktrees` con nombres sin espacios internos.
* Recomendación futura: si hay fricción, migrar a `C:\dev\cerebro-de-agentes` o WSL `~/cerebro`.

## 2.4 Variables de entorno

Ver `.env.example`. Requeridas: `DATABASE_URL`, `QWEN_API_KEY` (o `QWEN_TOKEN_PLAN_API_KEY`), `OPENCODE_API_KEY`/`OLLAMA_BASE_URL`.

## 2.5 Compatibilidad Windows

* `koffi` + `node-pty` solo validados en Node (DSH `allowBuilds`). No usar Bun para esos paths.
* `sharp` (Next image) requiere `allowBuilds: sharp:true` (ya en `pnpm-workspace.yaml`).
* `Playwright` si se activa: `pnpm exec playwright install --with-deps chromium` (requiere Admin para deps).

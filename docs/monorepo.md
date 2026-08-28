# 3. Estructura del Monorepo

> Reemplaza placeholder `123456...19` del plan original. Estructura **exacta** generada.

## 3.1 Árbol

```text
Cerebro de Agentes/                 # root (espacio en nombre, ver stack.md)
├── package.json                    # workspaces: apps/*, packages/*
├── pnpm-workspace.yaml             # aísla de C:\Samuel\pnpm-workspace.yaml
├── turbo.json                      # pipelines build/dev/lint/typecheck/test/db:*
├── tsconfig.json                   # referencia a tooling/tsconfig/base.json
├── .env.example
├── .gitignore
├── AGENTS.md
├── README.md
├── docs/                           # documentación del plan (este directorio)
│   ├── architecture.md             # 1. Arquitectura
│   ├── stack.md                    # 2. Stack
│   ├── monorepo.md                 # 3. Este archivo
│   ├── protocols.md                # 4. Contratos Zod
│   ├── adapters.md                 # 5. Adaptadores
│   ├── database.md                 # 6. Drizzle + pgvector
│   ├── roadmap.md                  # 7. Plan de ejecución
│   └── governance.md               # 8. Reglas hard constraints
├── packages/
│   └── shared/                     # @cerebro/shared — Zod schemas compartidos
│       ├── package.json
│       └── src/
│           ├── index.ts            # re-exports
│           └── protocols.ts        # MissionSchema, MissionReportSchema
├── apps/
│   ├── orchestrator/               # Hono Líder
│   │   ├── package.json
│   │   ├── drizzle.config.ts
│   │   ├── src/
│   │   │   ├── index.ts            # Hono app + routes
│   │   │   ├── bridges/
│   │   │   │   └── qwen.ts         # QwenApiAdapter (+ experimental Playwright)
│   │   │   ├── adapters/
│   │   │   │   ├── deepseek.ts     # DSH Gateway
│   │   │   │   └── opencode.ts     # Opencode CLI
│   │   │   ├── router/
│   │   │   │   ├── task-router.ts  # route(mission) → AdapterId
│   │   │   │   └── supervisor.ts   # retry, timeout, escalado
│   │   │   ├── governance/
│   │   │   │   └── guard.ts        # regex bloqueos, gate calidad
│   │   │   └── db/
│   │   │       ├── schema.ts       # Drizzle tables
│   │   │       └── client.ts       # pg / pglite client
│   │   └── scripts/
│   │       └── setup-qwen-profile.sh # (experimental) Playwright profile
│   └── web/                        # Next.js 15 Frontend
│       ├── package.json
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx            # Chat → Orquestador
│       │   └── dashboard/
│       │       └── page.tsx        # Kanban PG + SSE
│       └── components/
│           └── ui/                 # shadcn/ui
├── tooling/
│   └── tsconfig/
│       └── base.json               # TS 6.0 strict base
└── scripts/
    └── setup-qwen-profile.sh       # setup Playwright persistent profile (experimental)
```

## 3.2 Workspaces

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Cada workspace es `private: true` excepto `@cerebro/shared` que se importa como `@cerebro/shared` / `@cerebro/shared/protocols`.

## 3.3 Turbo pipelines

`turbo.json` define:

* `build` — depende `^build`, outputs `dist/**`, `.next/**`
* `dev` — `cache: false`, `persistent: true`
* `lint`, `typecheck` — dependen `^lint/^typecheck`
* `test` — depende `^build`
* `db:generate`, `db:migrate`, `db:studio` — solo `@cerebro/db` / orchestrator

Ejecución:

```ps
pnpm install
pnpm run build
pnpm run dev        # turbo corre orchestrator + web en paralelo
pnpm run typecheck
```

## 3.4 Convenciones

* **ESM everywhere** (`"type": "module"`), imports con `.ts` relativos, `paths` para `@cerebro/*`.
* **Zod schemas** en `packages/shared` — única fuente de verdad. Frontend y Backend los importan, no duplican.
* **Drizzle** en `apps/orchestrator/src/db` (o `packages/db` si se extrae luego). `drizzle.config.ts` en orchestrator.
* **shadcn/ui** en `apps/web/components/ui`, Tailwind 4.
* **Commits**: `feat:`, `fix:`, `docs:`, `chore:`.

## 3.5 Qué NO está en v0.1

* `packages/ui` extraído (shadcn vive en `apps/web` hasta necesitar compartir).
* `packages/db` separado (vive en orchestrator hasta que otro app necesite PG).
* `e2e/` Playwright tests (añadir en FASE 6).

## 3.6 Migración futura

Si `Bun` se adopta en WSL2: añadir `bunfig.toml`, cambiar `packageManager` a `bun`, mantener `pnpm-workspace.yaml` para compat Windows. No mezclar lockfiles en Windows nativo.

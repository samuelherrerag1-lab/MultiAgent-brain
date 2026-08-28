# AGENTS.md — Instrucciones para agentes Opencode/DSH/Qwen

Este archivo se copia automáticamente a cada worktree de misión (`ensureAgentsMd`). El agente lo lee como contexto.

## Contexto del proyecto

- **Cerebro de Agentes**: Orquestador multi-agente Hono + Next.js + PostgreSQL/pgvector
- **Monorepo**: `pnpm + Turborepo`, `Node 22`, `TypeScript 6 strict`, `ESM`
- **Contratos**: `packages/shared/src/protocols.ts` — `Mission`/`MissionReport` Zod
- **DB**: `apps/orchestrator/src/db/schema.ts` — Drizzle ORM

## Reglas para el agente

1. **Lee el prompt de la misión completo** — está inyectado abajo en `## Misión Actual`
2. **Cumple los `acceptanceCriteria`** — el Gate de Calidad los validará antes de marcar `done`
3. **Aislamiento**: trabajas dentro de este worktree (`mission/<id>`). No toques `main`
4. **Comandos prohibidos**: `rm -rf /`, `sudo`, `git push --force`, `DROP DATABASE` — serán bloqueados sin aprobación
5. **Tests**: genera/actualiza tests si la misión es `refactor`/`tests`/`build`
6. **Artefactos**: lista archivos creados/modificados — se reportarán como `artifacts` en `MissionReport`
7. **Decisiones**: documenta decisiones arquitectónicas — se guardarán en tabla `decisions`

## Misión Actual

<!-- INJECT_MISSION_JSON -->
<!-- El orquestador reemplaza este bloque con Mission JSON + prompt + criterios -->

## Checklist

- [ ] Leer `prompt` y `contextFiles` si existen
- [ ] Implementar cambios requeridos
- [ ] Verificar `acceptanceCriteria` uno por uno
- [ ] Ejecutar `pnpm test` si hay tests relevantes
- [ ] Preparar `summary` y `artifacts` para el reporte

## Output esperado

Al finalizar, el adaptador parseará tu salida. Asegúrate de:

- Dejar archivos en el worktree
- Si usas `opencode run --format json`, tu resumen final será el `summary` del `MissionReport`
- Menciona explícitamente si todos los `acceptanceCriteria` se cumplen

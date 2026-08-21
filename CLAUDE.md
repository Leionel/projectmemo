# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

忆程 ProjectMemo: a knowledge-asset + proactive-agent tool for university project-based learning, built for the 2026 中国高校计算机大赛-人工智能创意赛. The product UI is entirely in Simplified Chinese — all user-facing strings, error messages, and seed data are Chinese.

## Commands

Environment: Node.js 24. On Windows PowerShell use `npm.cmd` (execution policy may block `npm.ps1`).

```powershell
copy .env.example .env
npm.cmd install
npm.cmd run db:setup   # prisma generate + migrate deploy + seed (idempotent, keeps other projects)
npm.cmd run dev        # http://127.0.0.1:3000
```

Verification:

```powershell
npm.cmd test                         # vitest run (unit + integration)
npm.cmd test -- tests/linker.test.ts           # single test file
npm.cmd test -- -t "name fragment"             # single test by name
npm.cmd run lint                     # eslint .
npm.cmd exec tsc -- --noEmit         # typecheck
npm.cmd run build
npm.cmd run test:e2e                 # isolated production build + Playwright (see below)
```

Demo data: `npm.cmd run db:seed` re-imports the seed project only. `npm.cmd run db:demo-reset -- --confirm` **wipes all projects** and reseeds — never run without the explicit `--confirm` flag.

E2E (`npm.cmd run test:e2e`) builds a separate production bundle into `.next-e2e`, serves it on port **3321** against an isolated DB `prisma/projectmemo-e2e.db` (never the dev DB), then runs Playwright from `e2e/`. Extra args are forwarded to the Playwright CLI. It includes Windows-specific process-tree cleanup; keep it working if you touch `scripts/run-e2e.ts`.

## Architecture

Two clients share one backend: the Next.js 16 web app (root `app/`, `components/`, `lib/`, `prisma/`) is the source of truth, and `harmonyos/` contains an ArkTS HarmonyOS client that consumes the same REST API (`ApiClient.ets`, base URL `http://10.0.2.2:3000` = emulator→localhost). Changes to API shapes must consider the HarmonyOS models in `harmonyos/entry/src/main/ets/models/`.

### Domain loop

碎片捕获 → 知识卡片 → 卡片关联 → 主动介入 → 行动项 → 复盘卡片 → 成果生成. Concretely:

1. **Capture**: raw text → agent structures a `KnowledgeCard` draft (`lib/agent/`) → keyword-based linking creates `CardRelation`s (`lib/memory/linker.ts` behind the `KeywordVectorStore` interface in `lib/memory/vectorStore.ts`, which is the seam for future embeddings).
2. **Intervention**: a deterministic **rules engine** (`lib/services/agentContextService.ts` `evaluateProjectContext`) scans project state for the five trigger types (`DEADLINE_NEAR`, `RISK_UNHANDLED`, `PROJECT_STALE`, `EXPERIMENT_GAP`, `MATERIAL_GAP`) and upserts `AgentIntervention`s, deduped by the unique `(projectId, dedupeKey)`. It runs automatically on every project-detail page render, so the rules must stay cheap and idempotent. Demo scenarios (`deadline_48h`, `stale_72h`, `risk_cluster`) inject **simulated** interventions/actions tagged `isSimulated`; simulated data is excluded from real flows (e.g., completing a simulated action throws) and can be cleared via `clearSimulation`.
3. **Action**: completing an action (`lib/services/actionService.ts`) runs the result text back through the capture pipeline as a `reflection` card in one transaction, and resolves the source intervention. This closed loop is a core demo story — don't break the resultCard linkage.
4. **Artifact**: six artifact types (`lib/services/artifactService.ts` + `lib/generators/templates.ts`); requires ≥1 knowledge card; every save is a new version row.

### Agent dual mode (mock-first)

Every agent capability has a deterministic offline mock and an optional LLM path, selected by env: `LLM_MODE="openai-compatible"` + `LLM_API_KEY` tries the real LLM (`lib/agent/llmAgent.ts`) and **falls back to the mock** (`lib/agent/mockAgent.ts`) on any failure. Demos must work offline with no keys, so mocks must remain deterministic and complete. Every agent invocation records an `AgentRun` row (provider, trace JSON, status `SUCCESS`/`PARTIAL`/`FALLBACK`/`FAILED`) — keep this audit trail when adding agent paths. The copilot chat (`lib/services/copilotService.ts`) answers with mandatory card citations and can only *propose* actions/artifacts; all writes require explicit user confirmation. `app/api/settings` can switch LLM mode at runtime; the API key is held in-process only and the write endpoint is disabled in production.

### Layering

- `app/api/**/route.ts` — thin Route Handlers: parse with zod (`lib/validation/schemas.ts`), call a service, catch via `apiError()` (`lib/api.ts`). Use `AppError(code, message, status)` for domain errors. All routes set `runtime = "nodejs"` (better-sqlite3 is native; it's in `serverExternalPackages`).
- `lib/services/` — use-case orchestration (capture, agentContext, action, artifact, copilot).
- `lib/repositories/` — all Prisma data access.
- Pages are `force-dynamic` **server components** that call repositories/services directly; `components/` are client components that talk to Route Handlers via fetch. Shared API/UI types live in `lib/types.ts`.
- Integration tests (`tests/database.integration.test.ts`) build a throwaway SQLite DB by replaying `prisma/migrations/*.sql` in order, so after schema changes the migrations must stay replayable.

### Persistence

Prisma 7 + SQLite via `@prisma/adapter-better-sqlite3`. Generated client outputs to **`lib/generated/prisma`** (ESM; import from `@/lib/generated/prisma/client`, never `@prisma/client`). DB singleton: `lib/db.ts`; URL from `DATABASE_URL` (default `file:./prisma/dev.db`). Prisma config is in `prisma.config.ts` (loads dotenv).

## Conventions

- `@/*` path alias maps to the repo root.
- ESLint ignores `lib/generated/`, `.next*/`.
- E2E env overrides (`scripts/e2e-env.ts`) force `LLM_MODE=mock` — don't assume real LLMs in tests.
- The HARMONYOS_*.md and ProjectMemo_*.md planning docs at the root are competition/planning artifacts, not code documentation.

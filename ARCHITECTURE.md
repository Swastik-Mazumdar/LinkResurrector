# LinkResurrector — Architecture & Backend Development Plan

## Phase 1 — Repository Inspection (findings)

| # | Area | Finding |
|---|------|---------|
| 1 | Frontend framework | React 18 + Vite 5 (multi-page MV3 build: `popup.html`, `dashboard.html`, `background.js`), Tailwind CSS 3, Framer Motion 11 |
| 2 | Existing backend | **None.** The extension is fully client-side (`chrome.storage.local`). |
| 3 | URL submission | Popup "Save Current Tab" (via `chrome.tabs.query` + `activeTab`); Resurrector console input (added during backend integration). |
| 4 | Simulation engine | `src/services/linkService.js` — `simulateCheck()` + `checkAllLinks()` fake health checks with deterministic hashing; clearly labeled `TODO(backend)`. |
| 5 | Existing API integrations | None live; `syncWithBackend()` is an honest no-op without a configured endpoint. |
| 6 | Architecture | Extension (popup/options/service-worker) + storage adapter + pure UI components. |
| 7 | Dependencies | react, react-dom, framer-motion (runtime); vite, @vitejs/plugin-react, tailwindcss, postcss, autoprefixer (build). **Zero backend deps so far.** |
| 8 | Data models | Link: `{ id, title, url, status: active|checking|resurrected|dead, statusCode, archiveUrl?, successorUrl?, addedAt, lastChecked }`; Settings: `{ monitoring, backendEndpoint }`. |
| 9 | Frontend↔backend comm | None yet; `src/services/backend.js` speaks to `http://localhost:8787` (REST + SSE). |
| 10 | Styling/UI | Obsidian/Crimson design system, `components/` primitives (Logo, StatusBadge, StatCard, Toast…). |
| 11 | Env config | None previously; backend uses env vars (`PORT`, `LR_*`, provider keys). See `server/.env.example`. |
| 12 | Testing infrastructure | None previously; backend uses Node's built-in `node --test` runner with deterministic mocks. |

**Note:** the frontend source was accidentally wiped from the working tree (git reset to LICENSE-only) and was restored verbatim from session history before backend work began. `dist/` was never touched.

## Phase 2 — Implementation Plan

1. **Backend (`server/`, Node ≥ 18, zero new runtime dependencies):**
   - `util/` — URL validation/normalization, IP classification, safe HTML metadata extraction, text similarity, errors.
   - `security/ssrf.js` — SSRF-guarded HTTP client: DNS validation of every resolved IP (IPv4 + IPv6, incl. IPv4-mapped/6to4/NAT64), agent-level DNS re-validation at connect time (anti-rebinding), manual redirect handling with per-hop re-validation, timeouts, response-size caps, redirect-loop detection.
   - `core/` — health checker (status classification incl. parked/error-page inspection), evidence extractor (Wayback HTML → migration candidates with source classification), candidate verifier (independent accessibility + identity + relevance checks), confidence engine (explainable, de-duplicated evidence weights), recursive migration orchestrator (multi-generation BFS with depth/time/visited budgets).
   - `providers/` — Wayback CDX client (rate-limited, cached, duplicate collapse) and a search-provider abstraction (Bing v7 / Google CSE via env keys; honest "reduced coverage" when unconfigured).
   - `jobs/` — in-memory job store + TTL caches + per-job event log.
   - `api/` — dependency-free HTTP API: `POST /api/resurrect`, `GET /api/resurrect/:jobId`, `GET /api/resurrect/:jobId/events` (SSE), `POST /api/verify`, `GET /api/health`; CORS for extension origins, per-IP rate limiting, structured errors.
2. **Tests (`server/test/`, `node --test`)** — deterministic mock fetchers; security (SSRF), HTTP semantics, pipeline, orchestrator scenarios.
3. **Frontend integration** — Resurrector console tab (live SSE phases, migration chain, confidence, evidence, warnings), vault application of real results, honest backend-offline state. Existing UI preserved.
4. **Docs** — `.env.example`, README updates, limitation notes.

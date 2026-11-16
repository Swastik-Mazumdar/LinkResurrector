# LinkResurrector architecture

## Application

- Chrome/Brave Manifest V3 extension; React 18, Vite, Tailwind CSS, Framer Motion.
- `src/popup/` saves the current tab and starts an immediate recovery check.
- `src/dashboard/` presents the vault, categories, save dates, evidence, migration chain, and recovery status.
- `src/services/linkService.js` is the vault/storage boundary. Link records persist in `chrome.storage.local`; browser profiles do not sync to one another.
- `src/background.js` schedules bounded sequential checks every 30 minutes while monitoring is enabled.
- `src/services/backend.js` communicates with `com.linkresurrector.native` over Chrome Native Messaging. The extension does not call an HTTP backend.

## On-device recovery helper

`server/native-host.js` is a Node.js 18+ Native Messaging process. The platform installers copy it and `server/src/` into the current user’s application-support folder, register the native host for Chrome/Brave, and restrict its allowed origin to the extension ID passed to the installer. The helper reads and writes framed JSON on stdio; logs go to stderr. It does not listen on localhost or another network port. A separate per-user lock bounds simultaneous recovery work across helper processes.

The shared engine is created by `server/src/engine.js` and contains:

- Intake and URL validation (`util/url.js`).
- DNS/IP validation and bounded HTTP requests (`security/ssrf.js`, `util/ip.js`).
- URL health checks, redirect chains, and parked/error-page detection (`core/healthChecker.js`).
- Internet Archive CDX and archived HTML retrieval (`providers/wayback.js`).
- Metadata, content, and migration announcement extraction (`util/html.js`, `core/evidenceExtractor.js`).
- Optional official Bing and Google CSE search API adapters (`providers/search.js`).
- Independent destination verification and heuristic evidence ranking (`core/candidateVerifier.js`, `core/confidence.js`).
- Bounded recursive investigation and alternative candidate branch checks (`core/orchestrator.js`).

The optional development HTTP API (`server/index.js`, `server/src/api/routes.js`) uses the same engine and binds to `127.0.0.1` by default. It is not part of the extension runtime.

## Result handling

Results keep the original URL, HTTP status, Wayback fallback, discovered candidates, migration generations, evidence, confidence, verification timestamp, warnings, and final destination separate. Only verified destinations become `successorUrl` in the saved vault. A website successor does not imply the exact original page was recovered; exact page mapping remains best effort and is reported conservatively.

## Limits and remaining caveats

- Search coverage is reduced until an official search-provider API key is configured for the helper process.
- Confidence scores are explainable heuristics, not statistical probabilities.
- Alternative candidate investigations are bounded by `LR_MAX_ALTERNATIVE_BRANCHES`, depth, candidate count, and the total time budget.
- Saved links are local to the browser profile; there is no cloud account or cross-computer sync.
- The test suite uses deterministic mocks and loopback fixtures. Passing it does not prove security in every browser/OS installation context.

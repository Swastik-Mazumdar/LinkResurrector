import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Icon from '../components/Icon.jsx';
import {
  checkBackendHealth,
  DEFAULT_BACKEND_ENDPOINT,
  getBackendEndpoint,
  resurrectUrl,
} from '../services/backend.js';
import { shortenUrl } from '../lib/format.js';

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } },
};

const CHAIN_STYLES = {
  dead: 'border-white/10 bg-white/[0.03] text-zinc-500',
  alive: 'border-emerald-400/30 bg-emerald-400/[0.06] text-white',
  redirected: 'border-white/25 bg-white/5 text-zinc-300',
  historical_candidate: 'border-crimson/30 bg-crimson/[0.05] text-zinc-300',
  plausible_successor: 'border-crimson/40 bg-crimson/[0.08] text-crimson',
  verified_successor: 'border-crimson/60 bg-crimson/10 text-crimson shadow-glow-xs',
};

function ConfidenceMeter({ score }) {
  const color = score >= 80 ? 'bg-crimson' : score >= 60 ? 'bg-zinc-300' : 'bg-zinc-600';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(0, score))}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
      <span className="text-xs font-bold tabular-nums text-white">{score}</span>
    </div>
  );
}

/**
 * Resurrector console — drives the real backend recovery engine and shows
 * honest, live results: the migration chain as actually discovered,
 * verification status, evidence, and warnings. Nothing is fabricated.
 */
export default function ResurrectorView({ links, onApplyResult }) {
  const [url, setUrl] = useState('');
  const [backend, setBackend] = useState(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(null);
  const [history, setHistory] = useState([]); // live phase log
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const endpoint = await getBackendEndpoint();
      const health = await checkBackendHealth(endpoint);
      if (!cancelled) setBackend({ endpoint, ...health });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResurrect = async () => {
    if (running || !url.trim()) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setHistory([]);
    setPhase({ phase: 'initializing', detail: 'Submitting URL to recovery engine' });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { result: recovery } = await resurrectUrl(url.trim(), {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type !== 'progress') return;
          setPhase({ phase: event.phase, detail: event.detail ?? '' });
          setHistory((prev) => [...prev.slice(-40), event]);
        },
      });
      setResult(recovery);
      setPhase(null);
      if (onApplyResult && recovery) onApplyResult(url.trim(), recovery);
    } catch (err) {
      setError(String(err?.message ?? err));
      setPhase(null);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Backend status */}
      <motion.div
        variants={rise}
        className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
          backend === null
            ? 'border-white/10 bg-panel/60 text-zinc-500'
            : backend.available
              ? 'border-emerald-400/25 bg-emerald-400/[0.04] text-zinc-300'
              : 'border-crimson/30 bg-crimson/[0.05] text-zinc-300'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            backend === null
              ? 'animate-pulse-dot bg-zinc-500'
              : backend.available
                ? 'animate-pulse-dot bg-emerald-400'
                : 'animate-pulse-dot bg-crimson'
          }`}
        />
        {backend === null ? (
          <span className="text-xs">Probing recovery engine…</span>
        ) : backend.available ? (
          <span className="text-xs">
            Engine online at <span className="font-medium text-white">{backend.endpoint}</span>
            {!backend.info?.providers?.search?.configured && (
              <span className="text-zinc-500"> · reduced discovery coverage (no search provider keys)</span>
            )}
          </span>
        ) : (
          <span className="text-xs">
            Engine offline ({backend.endpoint}) — start it with{' '}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white">npm run backend</code>
          </span>
        )}
      </motion.div>

      {/* Input */}
      <motion.div
        variants={rise}
        className="flex items-center gap-3 rounded-xl border border-white/10 bg-panel/80 px-3.5 py-2.5 focus-within:border-crimson/50 focus-within:shadow-glow-sm transition-shadow"
      >
        <Icon name="link" className="h-4 w-4 shrink-0 text-zinc-500" />
        <input
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && handleResurrect()}
          placeholder="Paste a dead, broken or outdated URL…"
          aria-label="URL to resurrect"
          disabled={running}
          className="w-full bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
        />
        {running ? (
          <motion.button
            type="button"
            onClick={handleCancel}
            whileTap={{ scale: 0.95 }}
            className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-crimson/40 hover:text-crimson"
          >
            Cancel
          </motion.button>
        ) : null}
        <motion.button
          type="button"
          onClick={handleResurrect}
          disabled={running || !url.trim()}
          whileHover={{ scale: running || !url.trim() ? 1 : 1.03 }}
          whileTap={{ scale: running || !url.trim() ? 1 : 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-crimson px-3 py-1.5 text-xs font-semibold text-white shadow-glow-sm hover:bg-crimson-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="bolt" className={`h-3.5 w-3.5 ${running ? 'animate-pulse' : ''}`} />
          {running ? 'Recovering…' : 'Resurrect'}
        </motion.button>
      </motion.div>

      {/* Live phase */}
      <AnimatePresence>
        {running && phase && (
          <motion.div
            key="phase"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 rounded-xl border border-crimson/30 bg-crimson/[0.05] px-4 py-3"
          >
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              className="h-3.5 w-3.5 rounded-full border-2 border-crimson border-t-transparent"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-crimson">
                {phase.phase.replaceAll('_', ' ')}
              </div>
              <div className="truncate text-[11px] text-zinc-400">{phase.detail}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-crimson/40 bg-crimson/[0.07] px-4 py-3 text-xs text-crimson"
          >
            {error}
          </motion.div>
        )}

        {result && <RecoveryResult result={result} links={links} />}
      </AnimatePresence>

      {/* Empty state */}
      {!result && !running && !error && (
        <motion.div
          variants={rise}
          className="rounded-xl border border-dashed border-white/10 bg-panel/40 px-6 py-12 text-center"
        >
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-crimson/30 bg-crimson/5 text-crimson shadow-glow-xs">
            <Icon name="bolt" className="h-5 w-5" />
          </span>
          <div className="mt-3 text-sm font-medium text-white">
            Follow a website across every migration
          </div>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
            The engine checks the original URL, mines Wayback snapshots for
            migration evidence, discovers successors, and keeps following each
            new generation — then independently verifies where the link leads
            today, with evidence and confidence scores.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Result presentation                                                 */
/* ------------------------------------------------------------------ */

function RecoveryResult({ result, links }) {
  const statusMeta = {
    completed: { label: 'Verified successor found', tone: 'text-crimson', icon: 'check' },
    partial: { label: 'Partially recovered', tone: 'text-zinc-200', icon: 'activity' },
    no_successor: { label: 'No verified successor', tone: 'text-zinc-400', icon: 'x-circle' },
    failed: { label: 'Recovery failed', tone: 'text-crimson', icon: 'x-circle' },
  };
  const meta = statusMeta[result.status] ?? statusMeta.partial;

  return (
    <motion.div
      key="result"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="space-y-3"
    >
      {/* Original + wayback summary */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-panel/70 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Original URL
          </div>
          <a
            href={result.originalUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate text-xs text-white hover:text-crimson"
          >
            {shortenUrl(result.originalUrl, 52)}
          </a>
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span
              className={`rounded-full border px-2 py-0.5 ${
                result.originalStatus?.reachable
                  ? 'border-emerald-400/30 text-emerald-400'
                  : 'border-white/10 text-zinc-500'
              }`}
            >
              {result.originalStatus?.reachable ? 'reachable' : 'unreachable'}
            </span>
            {result.originalStatus?.httpStatus ? (
              <span className="text-zinc-500">HTTP {result.originalStatus.httpStatus}</span>
            ) : null}
            {result.originalStatus?.reason ? (
              <span className="text-zinc-500">{result.originalStatus.reason}</span>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-panel/70 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Wayback fallback
          </div>
          {result.wayback?.fallbackUrl ? (
            <a
              href={result.wayback.fallbackUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex items-center gap-1.5 text-xs text-white hover:text-crimson"
            >
              <Icon name="archive" className="h-3 w-3 shrink-0 text-crimson" />
              <span className="truncate">{shortenUrl(result.wayback.fallbackUrl, 48)}</span>
            </a>
          ) : (
            <div className="mt-1 text-xs text-zinc-500">
              {result.wayback?.available
                ? 'no useful HTML snapshot'
                : 'archive unavailable for this URL'}
            </div>
          )}
          {result.wayback?.snapshotCount > 0 && (
            <div className="mt-2 text-[11px] text-zinc-500">
              {result.wayback.snapshotCount} historical snapshots analyzed
            </div>
          )}
        </div>
      </div>

      {/* Final result */}
      {result.finalResult && (
        <div
          className={`rounded-xl border p-4 ${
            result.finalResult.verified
              ? 'border-crimson/50 bg-crimson/[0.06] shadow-[0_0_24px_rgba(239,68,68,0.1)]'
              : 'border-white/10 bg-panel/70'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <Icon name={meta.icon} className={`h-4 w-4 ${meta.tone}`} />
              {meta.label}
            </span>
            {typeof result.finalResult.confidenceScore === 'number' && (
              <ConfidenceMeter score={result.finalResult.confidenceScore} />
            )}
          </div>
          <a
            href={result.finalResult.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block truncate text-sm font-medium text-white hover:text-crimson"
          >
            {result.finalResult.url}
          </a>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
            <span
              className={`rounded-full border px-2 py-0.5 ${
                result.finalResult.verified
                  ? 'border-crimson/50 text-crimson'
                  : 'border-white/15 text-zinc-400'
              }`}
            >
              {result.finalResult.verified ? 'independently verified' : 'unverified'}
            </span>
            {result.finalResult.pageRecovered ? (
              <span className="rounded-full border border-emerald-400/30 px-2 py-0.5 text-emerald-400">
                corresponding page recovered
              </span>
            ) : (
              <span className="rounded-full border border-white/15 px-2 py-0.5 text-zinc-400">
                website identified — page may differ
              </span>
            )}
          </div>
        </div>
      )}

      {/* Migration chain */}
      {result.migrationChain?.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-panel/70 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Migration chain — as actually discovered
          </div>
          <ol className="mt-3 space-y-2">
            {result.migrationChain.map((node) => (
              <li key={`${node.generation}-${node.url}`} className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-[10px] font-bold tabular-nums text-zinc-600">
                  G{node.generation}
                </span>
                <span
                  className={`flex-1 truncate rounded-lg border px-3 py-1.5 text-xs ${
                    CHAIN_STYLES[node.status] ?? CHAIN_STYLES.redirected
                  }`}
                >
                  {node.url}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
                  {node.status.replaceAll('_', ' ')}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Evidence */}
      {result.evidence?.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-panel/70 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Evidence
          </div>
          <ul className="mt-2 space-y-1.5">
            {result.evidence.slice(0, 12).map((item, index) => (
              <li key={index} className="flex items-start gap-2 text-xs text-zinc-400">
                <Icon name="check" className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                <span>
                  <span className="text-zinc-200">{item.type.replaceAll('_', ' ')}</span>
                  {item.detail ? ` — ${item.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {result.warnings?.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-panel/70 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Warnings & uncertainties
          </div>
          <ul className="mt-2 space-y-1.5">
            {result.warnings.map((warning, index) => (
              <li key={index} className="flex items-start gap-2 text-xs text-zinc-400">
                <Icon name="info" className="mt-0.5 h-3 w-3 shrink-0 text-crimson" />
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}

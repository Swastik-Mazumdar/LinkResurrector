import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from '../components/Icon.jsx';
import { getBackendHealth, resurrectUrl } from '../services/backend.js';
import { addLink, getLinks, LINK_CATEGORIES, resultToLinkPatch, updateLink } from '../services/linkService.js';

const PHASE_LABELS = {
  initializing: 'Initializing recovery',
  checking_original: 'Checking original URL',
  retrieving_snapshots: 'Retrieving Wayback snapshots',
  analyzing_history: 'Analyzing historical content',
  extracting_evidence: 'Extracting migration evidence',
  discovering_successors: 'Discovering successors',
  investigating_generation: 'Investigating next generation',
  verifying_candidates: 'Verifying candidates',
  completed: 'Completed',
  no_successor: 'No verified successor',
  partial: 'Partially recovered',
};

export default function ResurrectorView({ onSaved }) {
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('Uncategorized');
  const [health, setHealth] = useState(null);
  const [phase, setPhase] = useState(null);
  const [detail, setDetail] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    getBackendHealth().then(setHealth).catch((reason) => setError(reason.message));
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setResult(null);
    setDetail('');
    setPhase('initializing');
    setWorking(true);
    try {
      const recovery = await resurrectUrl(url.trim(), {
        onProgress: (event) => {
          setPhase(event.phase ?? 'investigating');
          setDetail(event.detail ?? '');
        },
      });
      setResult(recovery);

      const links = await getLinks();
      const existing = links.find((link) => link.url === recovery.originalUrl || link.url === url.trim());
      const link = existing ?? (await addLink({ url: recovery.originalUrl, title: recovery.originalUrl, category, status: 'checking' })).link;
      await updateLink(link.id, resultToLinkPatch(recovery));
      onSaved?.(await getLinks());
    } catch (reason) {
      setError(reason.message ?? 'Recovery could not be completed.');
    } finally {
      setWorking(false);
    }
  }

  const finalResult = result?.finalResult;
  const verified = Boolean(finalResult?.verified && finalResult?.url);
  const originalLive = Boolean(result?.status === 'completed' && result?.originalStatus?.reachable && !finalResult);

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="rounded-xl border border-white/10 bg-panel/70 p-5">
        <label htmlFor="recovery-url" className="block text-sm font-medium text-white">URL to investigate</label>
        <div className="mt-3 flex gap-2">
          <input
            id="recovery-url"
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://old-domain.example/article"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-obsidian px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-crimson/60"
          />
          <button
            type="submit"
            disabled={working}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-crimson px-4 py-2.5 text-sm font-semibold text-white hover:bg-crimson-deep disabled:cursor-wait disabled:opacity-60"
          >
            <Icon name={working ? 'refresh' : 'activity'} className={`h-4 w-4 ${working ? 'animate-spin' : ''}`} />
            {working ? 'Investigating…' : 'Resurrect URL'}
          </button>
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
          Save result under
          <select
            aria-label="Recovery result category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-md border border-white/10 bg-obsidian px-2 py-1.5 text-xs text-white outline-none focus:border-crimson/50"
          >
            {LINK_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500" role="status">
          <span className={`h-1.5 w-1.5 rounded-full ${health?.ok ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          {health?.ok
            ? `On-device helper connected · search coverage ${health.searchCoverage ?? 'reduced'}`
            : 'Native helper unavailable — install the helper on this computer to investigate URLs.'}
        </div>
      </form>

      {(working || error) && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-crimson/20 bg-crimson/[0.04] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            {working && <span className="h-3.5 w-3.5 animate-spin rounded-full border border-crimson border-t-transparent" />}
            {error ? 'Recovery could not run' : (PHASE_LABELS[phase] ?? phase ?? 'Initializing recovery')}
          </div>
          {detail && <p className="mt-1 break-words text-xs text-zinc-500">{detail}</p>}
          {error && <p className="mt-1 text-xs text-crimson">{error}</p>}
        </motion.div>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <section className="rounded-xl border border-white/10 bg-panel/70 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Icon name={verified ? 'check' : 'activity'} className={`h-4 w-4 ${verified ? 'text-emerald-400' : 'text-amber-400'}`} />
              {verified ? 'Latest verified successor' : originalLive ? 'Original URL is live' : result.status === 'partial' ? 'Partial recovery' : 'No verified successor'}
            </div>
            <a href={result.originalUrl} target="_blank" rel="noreferrer" className="mt-3 block break-all text-xs text-zinc-500 hover:text-zinc-300">Original: {result.originalUrl}</a>
            {verified ? (
              <div className="mt-3">
                <a href={finalResult.url} target="_blank" rel="noreferrer" className="break-all text-base font-medium text-crimson hover:text-white">{finalResult.url}</a>
                <div className="mt-2 text-xs text-zinc-400">
                  Heuristic confidence: {finalResult.confidenceScore}/100 · {finalResult.pageRecovered ? 'matching page recovered' : 'website identified; exact page not confirmed'}
                </div>
              </div>
            ) : result.finalResult?.url ? (
              <p className="mt-3 break-all text-sm text-amber-300">Unverified candidate: {result.finalResult.url} ({result.finalResult.confidenceScore}/100). It is not presented as the current successor.</p>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">{originalLive ? 'The submitted URL is responding; no resurrection was needed.' : 'The available evidence did not establish a current legitimate successor.'}</p>
            )}
            <div className="mt-3 text-xs text-zinc-500">Original status: {result.originalStatus?.reason ?? 'unknown'}{result.originalStatus?.httpStatus ? ` · HTTP ${result.originalStatus.httpStatus}` : ''}</div>
          </section>

          <section className="rounded-xl border border-white/10 bg-panel/70 p-5">
            <h2 className="text-sm font-semibold text-white">Migration chain</h2>
            {result.migrationChain?.length ? (
              <ol className="mt-3 space-y-2">
                {result.migrationChain.map((node, index) => (
                  <li key={`${node.generation}-${node.url}`} className="flex gap-3 text-xs">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-obsidian text-[10px] text-zinc-400">{index}</span>
                    <div className="min-w-0 flex-1">
                      <a href={node.url} target="_blank" rel="noreferrer" className="break-all text-zinc-200 hover:text-crimson">{node.url}</a>
                      <div className="mt-0.5 text-zinc-500">Generation {node.generation} · {node.status}{node.httpStatus ? ` · HTTP ${node.httpStatus}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-2 text-xs text-zinc-500">No migration relationship was established.</p>}
          </section>

          {result.wayback?.fallbackUrl && (
            <section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.03] p-4">
              <div className="text-xs font-semibold text-sky-200">Historical Wayback fallback · not a live successor</div>
              <a href={result.wayback.fallbackUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-sky-300 hover:text-white">{result.wayback.fallbackUrl}</a>
              <div className="mt-1 text-[11px] text-zinc-500">{result.wayback.snapshotCount} useful captures · {result.wayback.latestTimestamp ?? 'timestamp unavailable'}</div>
            </section>
          )}

          {result.candidates?.length > 0 && (
            <section className="rounded-xl border border-white/10 bg-panel/70 p-5">
              <h2 className="text-sm font-semibold text-white">Candidate verification</h2>
              <ul className="mt-3 space-y-2">
                {result.candidates.map((candidate, index) => (
                  <li key={`${candidate.url}-${index}`} className="rounded-lg border border-white/5 bg-obsidian/70 p-3">
                    <a href={candidate.url} target="_blank" rel="noreferrer" className="break-all text-xs text-zinc-200 hover:text-crimson">{candidate.url}</a>
                    <div className="mt-1 text-[11px] text-zinc-500">{candidate.status}{candidate.score != null ? ` · heuristic score ${candidate.score}/100` : ''}{candidate.reason ? ` · ${candidate.reason}` : ''}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.evidence?.length > 0 && (
            <section className="rounded-xl border border-white/10 bg-panel/70 p-5">
              <h2 className="text-sm font-semibold text-white">Evidence</h2>
              <ul className="mt-2 space-y-1.5 text-xs text-zinc-400">
                {result.evidence.map((item, index) => <li key={`${item.type}-${index}`}><span className="text-zinc-200">{item.type}</span>{item.generation != null ? ` · generation ${item.generation}` : ''}{item.detail ? ` · ${item.detail}` : ''}</li>)}
              </ul>
            </section>
          )}

          {result.warnings?.length > 0 && (
            <section className="rounded-xl border border-amber-400/20 bg-amber-400/[0.03] p-4">
              <h2 className="text-xs font-semibold text-amber-200">Warnings and uncertainty</h2>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-zinc-400">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </section>
          )}
          <p className="text-right text-[10px] text-zinc-600">Verified at {result.completedAt ? new Date(result.completedAt).toLocaleString() : 'unknown'}</p>
        </motion.div>
      )}
    </div>
  );
}

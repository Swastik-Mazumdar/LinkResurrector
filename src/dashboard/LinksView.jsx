import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import StatCard from '../components/StatCard.jsx';
import SearchBar from '../components/SearchBar.jsx';
import LinkTable from './LinkTable.jsx';
import Icon from '../components/Icon.jsx';
import { countByStatus, domainOf } from '../lib/format.js';

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

/**
 * Overview / Links view: summary stat cards (Overview only), live search,
 * and the shared data table — filtered by the active sidebar section.
 * Fully autonomous: rows never expose a manual resurrect action.
 */
export default function LinksView({ links, filter, showStats, onDelete }) {
  const [query, setQuery] = useState('');

  const counts = useMemo(() => countByStatus(links), [links]);
  const total = links.length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = links;

    if (filter === 'dead') result = result.filter((l) => l.status === 'dead');
    if (filter === 'resurrected') result = result.filter((l) => l.status === 'resurrected');

    if (q) {
      result = result.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.url.toLowerCase().includes(q) ||
          domainOf(l.url).includes(q) ||
          l.status.includes(q)
      );
    }

    // The newest active link is always on top: live/checking links first
    // (most recently checked first), then resurrected, then dead.
    const TIER = { active: 0, checking: 0, resurrected: 1, dead: 2 };
    return [...result].sort(
      (a, b) =>
        (TIER[a.status] ?? 3) - (TIER[b.status] ?? 3) ||
        (b.lastChecked ?? 0) - (a.lastChecked ?? 0)
    );
  }, [links, filter, query]);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {showStats && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Total Saved" value={total} icon="layers" sub="links in your vault" />
          <StatCard label="Active" value={counts.active} icon="shield" sub="live and responding" />
          <StatCard
            label="Resurrected"
            value={counts.resurrected}
            icon="archive"
            sub="archive snapshot attached"
          />
          <StatCard
            label="Dead Permanently"
            value={counts.dead}
            icon="x-circle"
            sub="no archive found"
            tone="danger"
          />
        </div>
      )}

      <SearchBar value={query} onChange={setQuery} resultCount={visible.length} />

      {visible.length > 0 ? (
        <LinkTable links={visible} onDelete={onDelete} />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/10 bg-panel/40 px-6 py-14 text-center"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-crimson/30 bg-crimson/5 text-crimson shadow-glow-xs">
            <Icon name={query ? 'search' : 'link'} className="h-5 w-5" />
          </span>
          <div className="text-sm font-medium text-white">
            {query ? 'No links match your search' : 'Nothing here yet'}
          </div>
          <div className="max-w-xs text-xs text-zinc-500">
            {query
              ? 'Try a different title, domain or status.'
              : 'Save tabs from the popup — the auto-checker verifies them on its own.'}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import StatCard from '../components/StatCard.jsx';
import SearchBar from '../components/SearchBar.jsx';
import LinkTable from './LinkTable.jsx';
import Icon from '../components/Icon.jsx';
import { countByStatus, domainOf } from '../lib/format.js';
import { LINK_CATEGORIES } from '../services/linkService.js';

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

/**
 * Overview / Links view: summary stat cards (Overview only), live search,
 * and the shared data table — filtered by the active sidebar section.
 * Fully autonomous: rows never expose a manual resurrect action.
 */
export default function LinksView({ links, filter, showStats, onDelete, onUpdateCategory }) {
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

    // The newest active link is always on top within each group.
    const TIER = { active: 0, checking: 0, resurrected: 1, dead: 2 };
    return [...result].sort(
      (a, b) =>
        (TIER[a.status] ?? 3) - (TIER[b.status] ?? 3) ||
        (b.lastChecked ?? 0) - (a.lastChecked ?? 0)
    );
  }, [links, filter, query]);

  const groups = useMemo(() => {
    if (filter !== 'links') return [{ category: null, links: visible }];
    return LINK_CATEGORIES
      .map((category) => ({
        category,
        links: visible.filter((link) => (link.category ?? 'Uncategorized') === category),
      }))
      .filter((group) => group.links.length > 0);
  }, [filter, visible]);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {showStats && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Total Saved" value={total} icon="layers" sub="links in your vault" />
          <StatCard label="Active" value={counts.active} icon="shield" sub="live and responding" />
          <StatCard
            label="Verified Successors"
            value={counts.resurrected}
            icon="archive"
            sub="live destination independently verified"
          />
          <StatCard
            label="No Verified Successor"
            value={counts.dead}
            icon="x-circle"
            sub="no current destination verified"
            tone="danger"
          />
        </div>
      )}

      <SearchBar value={query} onChange={setQuery} resultCount={visible.length} />

      {visible.length > 0 ? (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.category ?? 'all'} className="space-y-2">
              {group.category && (
                <h2 className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  <span>{group.category}</span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">{group.links.length}</span>
                </h2>
              )}
              <LinkTable links={group.links} onDelete={onDelete} onUpdateCategory={onUpdateCategory} />
            </section>
          ))}
        </div>
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

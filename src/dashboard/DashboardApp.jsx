import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './Sidebar.jsx';
import LinksView from './LinksView.jsx';
import ResurrectorView from './ResurrectorView.jsx';
import AboutView from './AboutView.jsx';
import Toast from '../components/Toast.jsx';
import Icon from '../components/Icon.jsx';
import {
  AUTO_SYNC_LABEL,
  checkAllLinks,
  deleteLink,
  getLinks,
  updateLink,
} from '../services/linkService.js';
import { countByStatus } from '../lib/format.js';

const VIEW_META = {
  overview: {
    title: 'Overview',
    subtitle: 'The health of your vault at a single glance.',
  },
  links: {
    title: 'All Links',
    subtitle: 'Everything you have saved, searchable and sortable.',
  },
  dead: {
    title: 'Dead Permanently',
    subtitle: 'Gone for good — the auto-checker found no archived snapshot.',
  },
  resurrected: {
    title: 'Resurrected',
    subtitle: 'Live URL died — an archived snapshot was attached automatically.',
  },
  resurrector: {
    title: 'Resurrector',
    subtitle: 'Follow a URL across every migration — verified with evidence.',
  },
  about: {
    title: 'About',
    subtitle: 'The story, the stack and the road ahead.',
  },
};

export default function DashboardApp() {
  const [view, setView] = useState('overview');
  const [links, setLinks] = useState([]);
  const [toast, setToast] = useState(null);
  const [sweeping, setSweeping] = useState(false);
  const sweepLock = useRef(false);

  useEffect(() => {
    getLinks()
      .then(setLinks)
      .catch(() => {});
  }, []);

  const flash = useCallback((message, tone = 'default') => {
    setToast({ id: Date.now(), message, tone });
    setTimeout(() => setToast(null), 2400);
  }, []);

  /**
   * Autonomous sweep: every broken/unresolved link passes through
   * `checking` and lands on Resurrected (archive found) or Dead
   * Permanently (no archive). Updates stream in live via onUpdate.
   */
  const handleCheckAll = useCallback(async () => {
    if (sweepLock.current) return;
    sweepLock.current = true;
    setSweeping(true);
    try {
      await checkAllLinks({
        onUpdate: (updated) => {
          setLinks((prev) =>
            prev.map((link) => (link.id === updated.id ? updated : link))
          );
        },
      });
      setLinks(await getLinks());
      flash('Auto-check complete — vault is up to date');
    } catch {
      flash('Auto-check failed — try again', 'danger');
    } finally {
      sweepLock.current = false;
      setSweeping(false);
    }
  }, [flash]);

  const handleDelete = async (id) => {
    await deleteLink(id);
    setLinks(await getLinks());
    flash('Link deleted from vault', 'danger');
  };

  /**
   * Applies a real backend recovery result to the vault.
   * Only real backend data is stored — nothing is fabricated. A verified
   * successor updates the link; otherwise the honest historical fallback
   * (Wayback snapshot) is attached when available.
   */
  const handleApplyResult = useCallback(
    async (originalUrl, result) => {
      try {
        const vault = await getLinks();
        const match = vault.find((link) => link.url === originalUrl);
        if (!match) return;

        const successor = result.finalResult?.verified ? result.finalResult.url : null;
        const fallback = result.wayback?.fallbackUrl ?? null;

        if (successor || fallback) {
          await updateLink(match.id, {
            status: 'resurrected',
            statusCode: 200,
            archiveUrl: fallback,
            successorUrl: successor,
            successorVerified: Boolean(successor),
            confidence: result.finalResult?.confidenceScore ?? null,
            lastChecked: Date.now(),
          });
          setLinks(await getLinks());
          flash(
            successor
              ? 'Verified successor attached to vault link'
              : 'Historical fallback attached to vault link'
          );
        }
      } catch {
        /* vault update is best-effort; the console result remains */
      }
    },
    [flash]
  );

  const counts = countByStatus(links);
  const deadCount = counts.dead;
  const meta = VIEW_META[view];
  const isAbout = view === 'about';

  return (
    <div className="flex h-screen overflow-hidden bg-obsidian text-frost">
      {/* Ambient crimson glow */}
      <div className="pointer-events-none fixed -top-40 right-0 h-96 w-[38rem] rounded-full bg-crimson/[0.06] blur-3xl" />

      <Sidebar view={view} onNavigate={setView} deadCount={deadCount} />

      <main className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">
          {/* View header */}
          <motion.header
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="mb-6 flex items-start justify-between"
          >
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                {meta.title}
              </h1>
              <p className="mt-0.5 text-sm text-zinc-500">{meta.subtitle}</p>
            </div>
            {!isAbout && (
              <div className="flex items-center gap-2">
                {/* Auto-sync cadence indicator */}
                <motion.span
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  title="The autonomous checker sweeps your vault in the background on this cadence"
                  className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-zinc-400 md:flex"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      sweeping
                        ? 'animate-pulse-dot bg-crimson shadow-glow-xs'
                        : 'animate-pulse-dot bg-emerald-400'
                    }`}
                  />
                  {AUTO_SYNC_LABEL}
                </motion.span>

                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-zinc-500">
                  v1.0.0-alpha
                </span>
                <motion.button
                  type="button"
                  onClick={handleCheckAll}
                  disabled={sweeping}
                  whileHover={{ scale: sweeping ? 1 : 1.03 }}
                  whileTap={{ scale: sweeping ? 1 : 0.96 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed ${
                    sweeping
                      ? 'border border-crimson/50 bg-crimson/10 text-crimson shadow-glow-xs'
                      : 'border border-crimson/40 bg-crimson/10 text-crimson hover:bg-crimson/20'
                  }`}
                >
                  <Icon
                    name={sweeping ? 'refresh' : 'bolt'}
                    className={`h-3.5 w-3.5 ${sweeping ? 'animate-spin' : ''}`}
                  />
                  {sweeping ? 'Auto-Checking…' : 'Check All Now'}
                </motion.button>
              </div>
            )}
          </motion.header>

          {/* Animated view transitions: fade + subtle vertical slide */}
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            >
              {isAbout ? (
                <AboutView />
              ) : view === 'resurrector' ? (
                <ResurrectorView links={links} onApplyResult={handleApplyResult} />
              ) : (
                <LinksView
                  links={links}
                  filter={view}
                  showStats={view === 'overview'}
                  onDelete={handleDelete}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <Toast toast={toast} />
    </div>
  );
}

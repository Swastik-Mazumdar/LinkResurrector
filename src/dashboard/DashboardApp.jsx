import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './Sidebar.jsx';
import LinksView from './LinksView.jsx';
import AboutView from './AboutView.jsx';
import ResurrectorView from './ResurrectorView.jsx';
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
    title: 'Permanently Dead',
    subtitle: 'No current successor could be verified for these URLs.',
  },
  resurrected: {
    title: 'Resurrected',
    subtitle: 'A current successor passed independent verification.',
  },
  about: {
    title: 'About',
    subtitle: '',
  },
  resurrector: {
    title: 'Link Resurrector',
    subtitle: 'Follow verified migrations across generations and review their evidence.',
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

  // The background sweep and the popup write recovery results to storage.
  // Without this listener an open dashboard kept showing pre-check statuses
  // until a manual reload.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return undefined;
    const onChanged = (changes, area) => {
      if (area === 'local' && Array.isArray(changes?.lr_links?.newValue)) {
        setLinks(changes.lr_links.newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
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
      const latest = await getLinks();
      setLinks(latest);
      const errored = latest.filter((link) => link.lastError);
      flash(
        errored.length
          ? `${errored.length} link${errored.length === 1 ? '' : 's'} could not complete — ${[...new Set(errored.map((link) => link.lastError.code))].join(', ')}`
          : 'Recovery checks complete — vault is up to date',
        errored.length ? 'danger' : 'default',
      );
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

  const handleCategoryUpdate = async (id, category) => {
    await updateLink(id, { category });
    setLinks(await getLinks());
  };

  const counts = countByStatus(links);
  const deadCount = counts.dead;
  const meta = VIEW_META[view];
  const isAbout = view === 'about';
  const isResurrector = view === 'resurrector';

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
              {meta.subtitle && <p className="mt-0.5 text-sm text-zinc-500">{meta.subtitle}</p>}
            </div>
            {!isAbout && !isResurrector && (
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
                  v1.0.0
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
              ) : isResurrector ? (
                <ResurrectorView onSaved={setLinks} />
              ) : (
                <LinksView
                  links={links}
                  filter={view}
                  showStats={view === 'overview'}
                  onDelete={handleDelete}
                  onUpdateCategory={handleCategoryUpdate}
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

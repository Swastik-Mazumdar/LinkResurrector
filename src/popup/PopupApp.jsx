import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Logo from '../components/Logo.jsx';
import Icon from '../components/Icon.jsx';
import Toggle from '../components/Toggle.jsx';
import AnimatedNumber from '../components/AnimatedNumber.jsx';
import Toast from '../components/Toast.jsx';
import { addLink, AUTO_SYNC_LABEL, getLinks, getSettings, LINK_CATEGORIES, setMonitoring } from '../services/linkService.js';
import { countByStatus, domainOf, timeAgo } from '../lib/format.js';

export default function PopupApp() {
  const [links, setLinks] = useState([]);
  const [monitoring, setMonitoringState] = useState(true);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState('Uncategorized');

  useEffect(() => {
    (async () => {
      setLinks(await getLinks());
      setMonitoringState((await getSettings()).monitoring);
    })().catch(() => {});
  }, []);

  const flash = useCallback((message, tone = 'default') => {
    setToast({ id: Date.now(), message, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const counts = countByStatus(links);
  const activeCount = counts.active;
  const deadCount = counts.dead;

  // The currently active link (outside the dashboard too): newest checked, live link.
  const currentlyActive = links
    .filter((link) => link.status === 'active')
    .sort((a, b) => (b.lastChecked ?? 0) - (a.lastChecked ?? 0))[0];

  const handleToggle = async (next) => {
    setMonitoringState(next);
    try {
      await setMonitoring(next);
    } catch {
      /* preview mode: state already updated */
    }
    flash(next ? 'Monitoring enabled' : 'Monitoring paused', next ? 'default' : 'danger');
  };

  const handleSaveTab = async () => {
    setSaving(true);
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
        flash('Open the extension in Chrome to save the current tab', 'danger');
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) throw new Error('The current tab does not have a website URL.');
      const title = tab.title ?? tab.url;
      const url = tab.url;

      const result = await addLink({ title, url, category });
      if (result.added) {
        setLinks(await getLinks());
        if (chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'LR_RECOVER_LINK', linkId: result.link.id }, () => void chrome.runtime.lastError);
        }
        flash('Tab saved — checking it now');
      } else {
        flash('Already in your vault', 'danger');
      }
    } catch {
      flash('Could not save this tab', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenDashboard = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('dashboard.html', '_blank');
    }
  };

  return (
    <div className="w-[340px] bg-obsidian p-4 text-frost">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Logo size="sm" />
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-400"
        >
          v1.0.0
        </motion.span>
      </div>

      {/* Monitoring toggle card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, type: 'spring', stiffness: 300, damping: 24 }}
        className="mt-3.5 flex items-center justify-between rounded-xl border border-white/10 bg-panel/80 px-3.5 py-3"
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
              monitoring
                ? 'border-crimson/40 text-crimson shadow-glow-xs'
                : 'border-white/10 text-zinc-500'
            }`}
          >
            <Icon name="power" className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-white">Link Monitoring</div>
            <div className="text-[11px] text-zinc-500">
              {monitoring ? 'Watchdog active — hunting 404s' : 'Paused — links unchecked'}
            </div>
          </div>
        </div>
        <Toggle on={monitoring} onChange={handleToggle} label="Toggle link monitoring" />
      </motion.div>

      {/* Live counters */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 24 }}
        className="mt-3 grid grid-cols-2 gap-2.5"
      >
        <div className="rounded-xl border border-white/10 bg-panel/80 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            <Icon name="shield" className="h-3 w-3" />
            Active Links
          </div>
          <div className="mt-1 text-2xl font-bold text-white">
            <AnimatedNumber value={activeCount} />
          </div>
        </div>
        <div className="rounded-xl border border-crimson/35 bg-crimson/[0.06] p-3 shadow-[0_0_18px_rgba(239,68,68,0.1)]">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-crimson/80">
            <Icon name="x-circle" className="h-3 w-3" />
            Unverified Links
          </div>
          <div className="mt-1 text-2xl font-bold text-crimson">
            <AnimatedNumber value={deadCount} />
          </div>
        </div>
      </motion.div>

      {/* Currently active link */}
      {currentlyActive && (
        <motion.a
          href={currentlyActive.url}
          target="_blank"
          rel="noreferrer"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, type: 'spring', stiffness: 300, damping: 24 }}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.98 }}
          title="Open the currently active link"
          className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] px-3.5 py-2.5 hover:border-emerald-400/40"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-400">
            <Icon name="shield" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-400/80">
              Currently Active
            </div>
            <div className="truncate text-xs font-medium text-white">
              {currentlyActive.title}
            </div>
            <div className="text-[10px] text-zinc-500">
              {domainOf(currentlyActive.url)} · checked {timeAgo(currentlyActive.lastChecked)}
            </div>
          </div>
          <Icon name="external" className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        </motion.a>
      )}

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 24 }}
        className="mt-3 space-y-2"
      >
        <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-panel/60 px-3 py-2 text-xs text-zinc-400">
          Save under
          <select
            aria-label="Link category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-md border border-white/10 bg-obsidian px-2 py-1.5 text-xs text-white outline-none focus:border-crimson/50"
          >
            {LINK_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <motion.button
          type="button"
          onClick={handleSaveTab}
          disabled={saving}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson px-3 py-2.5 text-sm font-semibold text-white shadow-glow-sm hover:bg-crimson-deep disabled:opacity-60"
        >
          <Icon name={saving ? 'refresh' : 'plus'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
          {saving ? 'Saving…' : 'Save Current Tab'}
        </motion.button>

        <motion.button
          type="button"
          onClick={handleOpenDashboard}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-medium text-frost hover:border-white/30 hover:bg-white/10"
        >
          <Icon name="external" className="h-4 w-4" />
          Open Full Dashboard
        </motion.button>
      </motion.div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-600">
        <span>{links.length} links in local vault</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-400" />
          {AUTO_SYNC_LABEL}
        </span>
      </div>

      <Toast toast={toast} />
    </div>
  );
}

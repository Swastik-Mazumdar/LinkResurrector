import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Logo from '../components/Logo.jsx';
import Icon from '../components/Icon.jsx';
import Toggle from '../components/Toggle.jsx';
import AnimatedNumber from '../components/AnimatedNumber.jsx';
import Toast from '../components/Toast.jsx';
import SiteIcon from '../components/SiteIcon.jsx';
import { addLink, AUTO_SYNC_LABEL, getLinks, getSettings, LINK_CATEGORIES, setMonitoring } from '../services/linkService.js';
import { countByStatus, domainOf, safeHref, shortenUrl, timeAgo } from '../lib/format.js';

export default function PopupApp() {
  const [links, setLinks] = useState([]);
  const [monitoring, setMonitoringState] = useState(true);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState('Uncategorized');
  const [listFilter, setListFilter] = useState('all');
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');

  useEffect(() => {
    (async () => {
      setLinks(await getLinks());
      setMonitoringState((await getSettings()).monitoring);

      // Auto-detect current active tab as a starting convenience
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
            setUrlInput(tab.url);
            const cleanedTitle = (tab.title || tab.url)
              .replace(/^\s*\(\d+\)\s*/, '')
              .replace(/^\s*\[\d+\]\s*/, '')
              .trim();
            setTitleInput(cleanedTitle);
          }
        } catch {
          /* ignore preview mode query */
        }
      }
    })().catch(() => { });
  }, []);

  const flash = useCallback((message, tone = 'default') => {
    setToast({ id: Date.now(), message, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const counts = countByStatus(links);
  const activeCount = counts.active;
  const resurrectedCount = counts.resurrected;
  const deadCount = counts.dead;

  const activeLinks = links.filter((link) => link.status === 'active');
  const resurrectedLinks = links.filter(
    (link) => link.status === 'resurrected' || (link.successorVerified && link.successorUrl)
  );
  const deadLinks = links.filter((link) => link.status === 'dead');

  const displayList = (
    listFilter === 'active'
      ? activeLinks
      : listFilter === 'resurrected'
        ? resurrectedLinks
        : listFilter === 'dead'
          ? deadLinks
          : [...resurrectedLinks, ...activeLinks, ...deadLinks]
  ).sort((a, b) => (b.lastChecked ?? b.addedAt ?? 0) - (a.lastChecked ?? a.addedAt ?? 0));

  const handleToggle = async (next) => {
    setMonitoringState(next);
    try {
      await setMonitoring(next);
    } catch {
      /* preview mode: state already updated */
    }
    flash(next ? 'Monitoring enabled' : 'Monitoring paused', next ? 'default' : 'danger');
  };

  const handleSaveLink = async (e) => {
    e?.preventDefault();
    const targetUrl = urlInput.trim();
    if (!targetUrl) {
      flash('Please enter a website link', 'danger');
      return;
    }

    setSaving(true);
    try {
      const cleanTitle = titleInput.trim() || targetUrl;
      const result = await addLink({ title: cleanTitle, url: targetUrl, category });
      if (result.added) {
        setLinks(await getLinks());
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'LR_RECOVER_LINK', linkId: result.link.id }, () => void chrome.runtime.lastError);
        }
        flash('Link saved to vault — checking now');
        setUrlInput('');
        setTitleInput('');
      } else {
        flash('Already in your vault', 'danger');
      }
    } catch (err) {
      flash(err.message || 'Could not save this link', 'danger');
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
    <div className="w-[360px] bg-obsidian p-4 text-frost">
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
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${monitoring
              ? 'border-crimson/40 text-crimson shadow-glow-xs'
              : 'border-white/10 text-zinc-500'
              }`}
          >
            <Icon name="power" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">Link Monitoring</div>
            <div className="truncate text-[11px] text-zinc-500">
              {monitoring ? 'Active — continuous 404 monitoring' : 'Paused — automatic checks suspended'}
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
        className="mt-3 grid grid-cols-3 gap-2"
      >
        <button
          type="button"
          onClick={() => setListFilter((prev) => (prev === 'active' ? 'all' : 'active'))}
          className={`rounded-xl border p-2.5 text-left transition-colors ${listFilter === 'active'
            ? 'border-emerald-400/50 bg-emerald-400/[0.1]'
            : 'border-white/10 bg-panel/80 hover:border-white/20'
            }`}
        >
          <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-emerald-400">
            <Icon name="shield" className="h-3 w-3" />
            Active
          </div>
          <div className="mt-1 text-xl font-bold text-white">
            <AnimatedNumber value={activeCount} />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setListFilter((prev) => (prev === 'resurrected' ? 'all' : 'resurrected'))}
          className={`rounded-xl border p-2.5 text-left transition-colors ${listFilter === 'resurrected'
            ? 'border-crimson/60 bg-crimson/[0.15]'
            : 'border-white/10 bg-panel/80 hover:border-white/20'
            }`}
        >
          <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-crimson">
            <Icon name="archive" className="h-3 w-3" />
            Successors
          </div>
          <div className="mt-1 text-xl font-bold text-crimson">
            <AnimatedNumber value={resurrectedCount} />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setListFilter((prev) => (prev === 'dead' ? 'all' : 'dead'))}
          className={`rounded-xl border p-2.5 text-left transition-colors ${listFilter === 'dead'
            ? 'border-rose-500/50 bg-rose-500/[0.1]'
            : 'border-white/10 bg-panel/80 hover:border-white/20'
            }`}
        >
          <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-zinc-400">
            <Icon name="x-circle" className="h-3 w-3" />
            Dead
          </div>
          <div className="mt-1 text-xl font-bold text-zinc-400">
            <AnimatedNumber value={deadCount} />
          </div>
        </button>
      </motion.div>

      {/* Scrollable list of links */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, type: 'spring', stiffness: 300, damping: 24 }}
        className="mt-3 rounded-xl border border-white/10 bg-panel/70 p-2.5"
      >
        <div className="flex items-center justify-between pb-2 border-b border-white/5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            <Icon name="link" className="h-3.5 w-3.5 text-crimson" />
            <span>
              {listFilter === 'dead'
                ? 'Permanently Dead'
                : listFilter === 'active'
                  ? 'Active Links'
                  : listFilter === 'resurrected'
                    ? 'Verified Successors'
                    : 'Saved Links'}
            </span>
            <span className="rounded-full bg-white/10 px-1.5 py-0.2 text-[9px] text-zinc-400">
              {displayList.length}
            </span>
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            <button
              type="button"
              onClick={() => setListFilter('all')}
              className={`rounded px-1.5 py-0.5 transition-colors ${listFilter === 'all'
                ? 'bg-white/15 font-medium text-white'
                : 'text-zinc-500 hover:text-zinc-300'
                }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setListFilter('active')}
              className={`rounded px-1.5 py-0.5 transition-colors ${listFilter === 'active'
                ? 'bg-emerald-400/20 font-medium text-emerald-300'
                : 'text-zinc-500 hover:text-zinc-300'
                }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setListFilter('resurrected')}
              className={`rounded px-1.5 py-0.5 transition-colors ${listFilter === 'resurrected'
                ? 'bg-crimson/20 font-medium text-crimson'
                : 'text-zinc-500 hover:text-zinc-300'
                }`}
            >
              Successors
            </button>
            <button
              type="button"
              onClick={() => setListFilter('dead')}
              className={`rounded px-1.5 py-0.5 transition-colors ${listFilter === 'dead'
                ? 'bg-rose-500/20 font-medium text-rose-300'
                : 'text-zinc-500 hover:text-zinc-300'
                }`}
            >
              Dead
            </button>
          </div>
        </div>

        <div className="mt-2 max-h-[180px] space-y-1.5 overflow-y-auto pr-1">
          {displayList.length === 0 ? (
            <div className="py-4 text-center text-xs text-zinc-500">
              {listFilter === 'dead'
                ? 'No permanently dead links found.'
                : listFilter === 'active'
                  ? 'No active links found.'
                  : listFilter === 'resurrected'
                    ? 'No verified successor links found.'
                    : 'No saved links found.'}
            </div>
          ) : (
            displayList.map((link) => {
              const isResurrected = Boolean(
                link.status === 'resurrected' || (link.successorVerified && link.successorUrl)
              );
              const isDead = link.status === 'dead';
              const targetUrl = isResurrected && link.successorUrl ? link.successorUrl : link.url;
              return (
                <motion.a
                  key={link.id}
                  href={safeHref(targetUrl)}
                  target="_blank"
                  rel="noreferrer"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  title={
                    isResurrected
                      ? `Open verified successor: ${link.successorUrl}`
                      : isDead
                        ? `Permanently Dead original: ${link.url}`
                        : `Open website: ${link.url}`
                  }
                  className={`group flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors ${isResurrected
                    ? 'border-crimson/25 bg-crimson/[0.04] hover:border-crimson/45 hover:bg-crimson/[0.08]'
                    : isDead
                      ? 'border-white/5 bg-white/[0.01] hover:border-rose-500/30 hover:bg-rose-500/[0.04]'
                      : 'border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]'
                    }`}
                >
                  <SiteIcon url={targetUrl} title={link.title} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`truncate text-xs font-medium ${isDead
                          ? 'text-zinc-400 line-through decoration-zinc-600'
                          : 'text-white group-hover:text-crimson'
                          }`}
                      >
                        {link.title}
                      </span>
                      {isResurrected && (
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.2 text-[9px] font-medium ${link.exactItemInactive
                            ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                            : 'border-crimson/40 bg-crimson/15 text-crimson'
                            }`}
                        >
                          {link.exactItemInactive ? 'Switched' : 'Successor'}
                        </span>
                      )}
                      {isDead && (
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.2 text-[9px] font-medium ${link.isLastKnownUrl ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' : 'border-rose-500/40 bg-rose-500/15 text-rose-400'}`}>
                          {link.isLastKnownUrl ? 'Tracked · Dead' : 'Dead'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                      <span className="truncate text-zinc-400">
                        {link.exactItemInactive
                          ? `Switched to ${domainOf(link.successorUrl)}`
                          : link.isLastKnownUrl && link.lastKnownUrl
                            ? `Last known: ${domainOf(link.lastKnownUrl)} (Shut down)`
                            : isResurrected
                              ? domainOf(link.successorUrl)
                              : domainOf(link.url)}
                      </span>
                      <span>·</span>
                      <span className="shrink-0 text-zinc-500">
                        {timeAgo(link.lastChecked ?? link.addedAt)}
                      </span>
                      {isResurrected && link.confidenceScore != null && (
                        <>
                          <span>·</span>
                          <span className="shrink-0 font-medium text-emerald-400">
                            {link.confidenceScore}/100
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <Icon
                    name="external"
                    className="h-3 w-3 shrink-0 text-zinc-500 opacity-50 group-hover:opacity-100"
                  />
                </motion.a>
              );
            })
          )}
        </div>
      </motion.div>

      {/* Save Website Link Form */}
      <motion.form
        onSubmit={handleSaveLink}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 24 }}
        className="mt-3 space-y-2 rounded-xl border border-white/10 bg-panel/80 p-2.5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            <Icon name="plus" className="h-3.5 w-3.5 text-crimson" />
            <span>Save Website Link</span>
          </div>
          <span className="text-[10px] text-zinc-500">Auto-filled from tab or enter URL</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-obsidian px-2.5 py-1.5 focus-within:border-crimson/50">
            <Icon name="link" className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              type="url"
              required
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com"
              className="w-full bg-transparent text-xs text-white placeholder:text-zinc-600 focus:outline-none"
            />
          </div>

          <div className="flex gap-1.5">
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Website name (optional)"
              className="flex-1 rounded-lg border border-white/10 bg-obsidian px-2 py-1 text-xs text-white placeholder:text-zinc-600 focus:border-crimson/50 focus:outline-none"
            />
            <select
              aria-label="Link category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-lg border border-white/10 bg-obsidian px-2 py-1 text-xs text-zinc-300 outline-none focus:border-crimson/50"
            >
              {LINK_CATEGORIES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>

        <motion.button
          type="submit"
          disabled={saving || !urlInput.trim()}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson px-3 py-2 text-xs font-semibold text-white shadow-glow-sm hover:bg-crimson-deep disabled:opacity-50"
        >
          <Icon name={saving ? 'refresh' : 'plus'} className={`h-3.5 w-3.5 ${saving ? 'animate-spin' : ''}`} />
          {saving ? 'Saving…' : 'Save & Check Website'}
        </motion.button>
      </motion.form>

      {/* Full Dashboard Link */}
      <motion.button
        type="button"
        onClick={handleOpenDashboard}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 20 }}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
      >
        <Icon name="external" className="h-3.5 w-3.5" />
        Open Full Dashboard
      </motion.button>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-600">
        <span>{links.length} saved links in vault</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-400" />
          {AUTO_SYNC_LABEL}
        </span>
      </div>

      <Toast toast={toast} />
    </div>
  );
}

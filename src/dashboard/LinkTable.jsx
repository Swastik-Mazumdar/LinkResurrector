import { AnimatePresence, motion } from 'framer-motion';
import Icon from '../components/Icon.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { shortenUrl, timeAgo } from '../lib/format.js';
import { LINK_CATEGORIES } from '../services/linkService.js';

/**
 * Sleek black/white/red data table.
 *
 * Rows are fully passive — resurrection happens autonomously via the
 * auto-check sweep. Row actions are utility-only:
 *   Open Original   (always, while not checking)
 *   Open Archive    (only when a snapshot was auto-attached)
 *   Delete
 *
 * Rows enter with a staggered spring cascade; deletions animate out via
 * AnimatePresence; hover/press states are tactile springs. All titles and
 * URLs are plain JSX bindings — no dangerouslySetInnerHTML anywhere.
 */
export default function LinkTable({ links, onDelete, onUpdateCategory }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-panel/60">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03] text-[11px] uppercase tracking-wider text-zinc-500">
            <th className="px-4 py-3 font-medium">Link</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Last Checked</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {links.map((link, index) => (
              <motion.tr
                key={link.id}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}
                transition={{
                  type: 'spring',
                  stiffness: 320,
                  damping: 26,
                  delay: Math.min(index * 0.04, 0.4),
                }}
                className={`group border-b border-white/5 last:border-b-0 transition-colors ${
                  link.status === 'checking' ? 'bg-crimson/[0.04]' : 'hover:bg-white/[0.03]'
                }`}
              >
                {/* Clicking the saved title follows a verified successor when one exists. */}
                <td className="max-w-[380px] px-4 py-3.5">
                  {(() => {
                    const isResurrected = Boolean(link.successorVerified && link.successorUrl);
                    const destinationUrl = isResurrected ? link.successorUrl : link.url;
                    const savedAt = link.id?.startsWith('lr_seed_') ? null : link.addedAt;
                    const savedDate = savedAt
                      ? new Date(savedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                      : 'date not recorded';
                    return (
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-obsidian text-xs font-bold text-crimson">
                          {link.title.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          {/* Title — follows only an independently verified successor */}
                          <a
                            href={destinationUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={isResurrected ? 'Open verified successor' : 'Open saved website'}
                            className="block truncate font-medium text-white hover:text-crimson"
                          >
                            {link.title}
                          </a>
                          {/* URL — struck through on resurrected rows (dead original) */}
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open original saved URL"
                            className={`block truncate text-xs hover:text-zinc-300 ${isResurrected ? 'text-zinc-600 line-through decoration-crimson/60 decoration-1' : 'text-zinc-500'}`}
                          >{shortenUrl(link.url)}</a>
                          {link.status === 'resurrected' && link.successorUrl && (
                            <a
                              href={link.successorUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-300 hover:text-white"
                            >
                              <Icon name="check" className="h-3 w-3 shrink-0" />
                              <span className="truncate">Verified successor · {shortenUrl(link.successorUrl, 42)}</span>
                              {link.confidenceScore != null && <span className="shrink-0">{link.confidenceScore}/100</span>}
                            </a>
                          )}
                          {link.recoveryResult?.finalResult?.url && !link.recoveryResult.finalResult.verified && (
                            <div className="mt-1 break-all text-[10px] text-amber-300">
                              Unverified candidate: {link.recoveryResult.finalResult.url}
                            </div>
                          )}
                          {link.status === 'resurrected' && link.successorUrl && !link.pageRecovered && (
                            <div className="mt-1 text-[10px] text-zinc-500">Website verified; exact page not confirmed.</div>
                          )}
                          <div className="mt-1 text-[10px] text-zinc-600">Saved {savedDate}</div>
                          <label className="mt-1 inline-flex items-center gap-1.5 text-[10px] text-zinc-600">
                            Group
                            <select
                              aria-label={`Category for ${link.title}`}
                              value={LINK_CATEGORIES.includes(link.category) ? link.category : 'Uncategorized'}
                              onChange={(event) => onUpdateCategory?.(link.id, event.target.value)}
                              className="rounded border border-white/10 bg-obsidian px-1.5 py-0.5 text-[10px] text-zinc-300 outline-none focus:border-crimson/50"
                            >
                              {LINK_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                          </label>
                          {link.archiveUrl && (
                            <a
                              href={link.archiveUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 flex items-center gap-1.5 text-xs text-white hover:text-crimson"
                            >
                              <Icon name="archive" className="h-3 w-3 shrink-0 text-crimson" />
                              <span className="truncate">Wayback fallback · {shortenUrl(link.archiveUrl, 40)}</span>
                            </a>
                          )}
                          {link.lastError && <div className="mt-1 text-[10px] text-crimson" title={link.lastError.message}>Backend error: {link.lastError.code}</div>}
                        </div>
                      </div>
                    );
                  })()}
                </td>

                {/* Status badge */}
                <td className="px-4 py-3.5">
                  <StatusBadge status={link.status} detail={link.checkingPhase} />
                </td>

                {/* Last checked */}
                <td className="whitespace-nowrap px-4 py-3.5">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <Icon name="clock" className="h-3.5 w-3.5 text-zinc-600" />
                    {timeAgo(link.lastChecked)}
                  </div>
                  {link.statusCode ? (
                    <div className="mt-0.5 pl-[22px] text-[10px] text-zinc-600">
                      HTTP {link.statusCode}
                    </div>
                  ) : null}
                </td>

                {/* Passive utility actions */}
                <td className="px-4 py-3.5">
                  <div className="flex items-center justify-end gap-2 opacity-60 transition-opacity group-hover:opacity-100">
                    {link.status !== 'checking' && (
                      <motion.a
                        href={link.successorVerified && link.successorUrl ? link.successorUrl : link.url}
                        target="_blank"
                        rel="noreferrer"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.92 }}
                        transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                        title={link.successorVerified ? 'Open verified successor' : 'Open saved website'}
                        aria-label={link.successorVerified ? `Open verified successor for ${link.title}` : `Open saved website: ${link.title}`}
                        className="rounded-md border border-white/10 p-1.5 text-zinc-400 hover:border-white/30 hover:text-white"
                      >
                        <Icon name="external" className="h-3.5 w-3.5" />
                      </motion.a>
                    )}
                    {link.status === 'resurrected' && link.successorUrl && (
                      <motion.a
                        href={link.successorUrl}
                        target="_blank"
                        rel="noreferrer"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.92 }}
                        transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                        title="Open verified successor"
                        aria-label={`Open verified successor for ${link.title}`}
                        className="rounded-md border border-emerald-400/30 bg-emerald-400/[0.06] p-1.5 text-emerald-300 hover:bg-emerald-400/10"
                      >
                        <Icon name="check" className="h-3.5 w-3.5" />
                      </motion.a>
                    )}
                    {link.archiveUrl && (
                      <motion.a
                        href={link.archiveUrl}
                        target="_blank"
                        rel="noreferrer"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.92 }}
                        transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                        title="Open historical Wayback fallback"
                        aria-label={`Open archived snapshot: ${link.title}`}
                        className="rounded-md border border-crimson/40 bg-crimson/10 p-1.5 text-crimson hover:bg-crimson/20 hover:shadow-glow-xs"
                      >
                        <Icon name="archive" className="h-3.5 w-3.5" />
                      </motion.a>
                    )}
                    <motion.button
                      type="button"
                      onClick={() => onDelete(link.id)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.92 }}
                      transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                      aria-label={`Delete ${link.title}`}
                      className="rounded-md border border-white/10 p-1.5 text-zinc-400 hover:border-crimson/50 hover:text-crimson"
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </motion.button>
                  </div>
                </td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

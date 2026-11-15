import { AnimatePresence, motion } from 'framer-motion';
import Icon from '../components/Icon.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { shortenUrl, timeAgo } from '../lib/format.js';

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
export default function LinkTable({ links, onDelete }) {
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
                {/* Link title + URL — resurrected rows strike the dead URL through */}
                <td className="max-w-[380px] px-4 py-3.5">
                  {(() => {
                    const isResurrected = link.status === 'resurrected' && link.archiveUrl;
                    return (
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-obsidian text-xs font-bold text-crimson">
                          {link.title.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          {/* Title — opens the original website in a new tab */}
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open website"
                            className="block truncate font-medium text-white hover:text-crimson"
                          >
                            {link.title}
                          </a>
                          {/* URL — struck through on resurrected rows (dead original) */}
                          <span
                            className={`truncate text-xs ${
                              isResurrected
                                ? 'text-zinc-600 line-through decoration-crimson/60 decoration-1'
                                : 'text-zinc-500'
                            }`}
                          >
                            {shortenUrl(link.url)}
                          </span>
                          {isResurrected && (
                            <a
                              href={link.archiveUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 flex items-center gap-1.5 text-xs text-white hover:text-crimson"
                            >
                              <Icon name="archive" className="h-3 w-3 shrink-0 text-crimson" />
                              <span className="truncate">{shortenUrl(link.archiveUrl, 44)}</span>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </td>

                {/* Status badge */}
                <td className="px-4 py-3.5">
                  <StatusBadge status={link.status} />
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
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.92 }}
                        transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                        title="Open Original"
                        aria-label={`Open original: ${link.title}`}
                        className="rounded-md border border-white/10 p-1.5 text-zinc-400 hover:border-white/30 hover:text-white"
                      >
                        <Icon name="external" className="h-3.5 w-3.5" />
                      </motion.a>
                    )}
                    {link.status === 'resurrected' && link.archiveUrl && (
                      <motion.a
                        href={link.archiveUrl}
                        target="_blank"
                        rel="noreferrer"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.92 }}
                        transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                        title="Open Archive"
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

import { motion } from 'framer-motion';
import Logo from '../components/Logo.jsx';
import Icon from '../components/Icon.jsx';
import { AUTO_SYNC_LABEL } from '../services/linkService.js';

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'resurrector', label: 'Resurrector', icon: 'activity' },
  { id: 'links', label: 'All Links', icon: 'link' },
  { id: 'dead', label: 'Permanently Dead', icon: 'x-circle' },
  { id: 'resurrected', label: 'Resurrected', icon: 'archive' },
  { id: 'about', label: 'About', icon: 'info' },
];

/**
 * Dashboard sidebar with the framer-motion `layoutId` sliding pill indicator
 * (plus a crimson edge glow that slides in lockstep) and the bottom auto-sync
 * cadence pill.
 */
export default function Sidebar({ view, onNavigate, deadCount }) {
  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-white/10 bg-panel">
      <div className="px-5 py-5">
        <Logo size="md" />
      </div>

      <nav className="flex-1 space-y-1 px-3" aria-label="Dashboard sections">
        {NAV_ITEMS.map((item) => {
          const active = view === item.id;
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 450, damping: 26 }}
              className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                active
                  ? 'text-white'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {active && (
                <>
                  {/* Sliding white pill */}
                  <motion.span
                    layoutId="lr-nav-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-lg border border-white/10 bg-white/[0.07]"
                  />
                  {/* Sliding crimson edge glow */}
                  <motion.span
                    layoutId="lr-nav-glow"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-crimson shadow-glow-sm"
                  />
                </>
              )}
              <Icon name={item.icon} className="relative h-4 w-4" />
              <span className="relative font-medium">{item.label}</span>
              {item.id === 'dead' && deadCount > 0 && (
                <motion.span
                  key={deadCount}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="relative ml-auto rounded-full bg-crimson/15 px-1.5 py-0.5 text-[10px] font-bold text-crimson"
                >
                  {deadCount}
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Bottom auto-sync status pill */}
      <div className="p-3">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-obsidian px-3 py-2.5"
        >
          <span className="h-2 w-2 animate-pulse-dot rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.55)]" />
          <span className="text-[11px] leading-tight text-zinc-400">
            {AUTO_SYNC_LABEL}
          </span>
        </motion.div>
      </div>
    </aside>
  );
}

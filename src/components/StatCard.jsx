import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import AnimatedNumber from './AnimatedNumber.jsx';

/**
 * Summary stat card. `tone: "danger"` swaps the accent to crimson with a
 * soft glow (used for Dead · 404s).
 */
export default function StatCard({ label, value, icon, sub, tone = 'default' }) {
  const danger = tone === 'danger';

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 14 },
        show: { opacity: 1, y: 0 },
      }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 350, damping: 24 }}
      className={`rounded-xl border bg-panel/80 p-4 ${
        danger
          ? 'border-crimson/35 shadow-[0_0_24px_rgba(239,68,68,0.12)]'
          : 'border-white/10'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
            danger
              ? 'border-crimson/40 text-crimson'
              : 'border-white/10 bg-white/5 text-zinc-300'
          }`}
        >
          <Icon name={icon} className="h-3.5 w-3.5" />
        </span>
      </div>
      <div
        className={`mt-2 text-3xl font-bold tracking-tight ${
          danger ? 'text-crimson' : 'text-white'
        }`}
      >
        <AnimatedNumber value={value} />
      </div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </motion.div>
  );
}

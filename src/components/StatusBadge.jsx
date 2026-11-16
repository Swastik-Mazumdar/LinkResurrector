import { motion } from 'framer-motion';
import Icon from './Icon.jsx';

/**
 * Autonomous lifecycle status badges:
 *   active       -> crisp white badge, green-accented dot
 *   checking     -> pulsing crimson/white spinner
 *   resurrected  -> crimson accent + archive icon
 *   dead         -> muted dark-gray with red strikethrough
 */
const STYLES = {
  active: {
    label: 'Active',
    wrap: 'border-emerald-400/30 bg-emerald-400/[0.06] text-white',
    dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.55)]',
  },
  checking: {
    label: 'Auto-Checking…',
    wrap: 'border-crimson/40 bg-crimson/[0.07] text-crimson animate-pulse-dot',
    spinner: true,
  },
  resurrected: {
    label: 'Verified successor',
    wrap: 'border-crimson/50 bg-crimson/10 text-crimson',
    dot: 'bg-crimson shadow-glow-xs',
    archive: true,
  },
  dead: {
    label: 'Permanently Dead',
    hint: 'No verified successor was found',
    wrap: 'border-white/10 bg-white/[0.03] text-zinc-500',
    dot: 'bg-zinc-700',
    strike: true,
  },
};

const PHASE_LABELS = {
  initializing: 'Initializing',
  checking_original: 'Checking original URL',
  retrieving_snapshots: 'Retrieving Wayback snapshots',
  analyzing_history: 'Analyzing history',
  extracting_evidence: 'Extracting migration evidence',
  discovering_successors: 'Discovering successors',
  investigating_generation: 'Investigating next generation',
  verifying_candidates: 'Verifying candidates',
};

export default function StatusBadge({ status, detail, exactItemInactive = false }) {
  if (exactItemInactive && status === 'resurrected') {
    return (
      <motion.span
        whileHover={{ scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        title="Exact item/chat is inactive on device — switched to main website"
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-amber-300 whitespace-nowrap"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.55)]" />
        <span>Exact Inactive · Website Live</span>
        <Icon name="archive" className="w-3 h-3 text-amber-300" />
      </motion.span>
    );
  }

  const style = STYLES[status] ?? STYLES.checking;

  return (
    <motion.span
      whileHover={{ scale: 1.05 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      title={detail ? (PHASE_LABELS[detail] ?? detail) : style.hint}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${style.wrap}`}
    >
      {style.spinner ? (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
          className="h-2.5 w-2.5 rounded-full border border-crimson border-t-transparent"
        />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      )}
      <span className={style.strike ? 'line-through decoration-crimson/70 decoration-1' : ''}>
        {status === 'checking' && detail ? (PHASE_LABELS[detail] ?? detail.replaceAll('_', ' ')) : style.label}
      </span>
      {style.archive && <Icon name="archive" className="w-3 h-3" />}
    </motion.span>
  );
}

import { motion } from 'framer-motion';

/**
 * Spring-animated power/monitoring toggle.
 * The knob travels with a tactile spring; the track shifts white → crimson.
 */
export default function Toggle({ on, onChange, label = 'Toggle monitoring' }) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300 ${
        on
          ? 'border-crimson/70 bg-crimson/20'
          : 'border-white/15 bg-white/5'
      }`}
    >
      <motion.span
        animate={{ x: on ? 21 : 3 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full ${
          on ? 'bg-crimson shadow-glow-sm' : 'bg-zinc-500'
        }`}
      />
    </motion.button>
  );
}

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
      className={`relative flex h-6 w-11 shrink-0 items-center rounded-full border px-[3px] transition-colors duration-300 ${
        on
          ? 'border-crimson/70 bg-crimson/20'
          : 'border-white/15 bg-white/5'
      }`}
    >
      {/* The knob is an in-flow flex child centered vertically by the track
          itself — no absolute positioning or transform-based centering, so
          it can never drift out of the pill in either state. */}
      <motion.span
        animate={{ x: on ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        className={`h-4 w-4 rounded-full ${
          on ? 'bg-crimson shadow-glow-sm' : 'bg-zinc-500'
        }`}
      />
    </motion.button>
  );
}

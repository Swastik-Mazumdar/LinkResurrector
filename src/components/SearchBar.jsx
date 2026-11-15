import { motion } from 'framer-motion';
import Icon from './Icon.jsx';

/** Live search / filter bar with a spring-pressed clear button. */
export default function SearchBar({ value, onChange, resultCount }) {
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      className="flex items-center gap-3 rounded-xl border border-white/10 bg-panel/80 px-3.5 py-2.5 focus-within:border-crimson/50 focus-within:shadow-glow-sm transition-shadow"
    >
      <Icon name="search" className="h-4 w-4 shrink-0 text-zinc-500" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search links, domains, statuses…"
        aria-label="Search saved links"
        className="w-full bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
      />
      {value ? (
        <motion.button
          type="button"
          onClick={() => onChange('')}
          whileTap={{ scale: 0.85 }}
          transition={{ type: 'spring', stiffness: 500, damping: 20 }}
          className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-crimson/40 hover:text-crimson"
        >
          Clear
        </motion.button>
      ) : null}
      <span className="shrink-0 text-[11px] tabular-nums text-zinc-600">
        {resultCount} result{resultCount === 1 ? '' : 's'}
      </span>
    </motion.div>
  );
}

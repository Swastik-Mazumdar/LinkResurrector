import { motion } from 'framer-motion';
import Logo from '../components/Logo.jsx';
import Icon from '../components/Icon.jsx';

export default function AboutView() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-panel/70 px-8 py-12 text-center"
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-96 -translate-x-1/2 rounded-full bg-crimson/15 blur-3xl" />
        <div className="relative flex flex-col items-center gap-4">
          <Logo size="xl" showWordmark={false} glow />
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Link<span className="font-light text-zinc-300">Resurrector</span>
          </h1>
          <div className="rounded-full border border-crimson/50 bg-crimson/10 px-3.5 py-1 text-xs font-semibold text-crimson shadow-glow-xs">
            Version 1.0.0
          </div>
          <p className="mt-2 max-w-md text-xs text-zinc-500">
            Automated bookmark watchdog and intelligent link recovery.
          </p>
        </div>
      </motion.section>
    </div>
  );
}

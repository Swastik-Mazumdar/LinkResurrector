import { motion } from 'framer-motion';
import Logo from '../components/Logo.jsx';
import Icon from '../components/Icon.jsx';

export default function AboutView() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-panel/70 px-8 py-10 text-center"
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-96 -translate-x-1/2 rounded-full bg-crimson/15 blur-3xl" />
        <div className="relative flex flex-col items-center gap-4">
          <Logo size="xl" showWordmark={false} glow />
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Link<span className="font-light text-zinc-300">Resurrector</span>
          </h1>
          <div className="rounded-full border border-crimson/50 bg-crimson/10 px-3 py-1 text-xs font-semibold text-crimson shadow-glow-xs">
            Version 1.0.0
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06 }}
        className="rounded-2xl border border-white/10 bg-panel/70 p-6"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon name="shield" className="h-4 w-4 text-crimson" />
          Security
        </h2>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-400">
          <li>Only HTTP and HTTPS recovery targets are accepted; local, private, loopback, link-local, and metadata addresses are blocked.</li>
          <li>DNS results are checked before connection and again at connection time. Every redirect is checked again.</li>
          <li>Network requests have time and response-size limits. Retrieved page scripts are never executed.</li>
          <li>Recovery runs in an on-device helper launched through Chrome Native Messaging; it does not open a localhost web server or listen on a network port.</li>
          <li>The helper accepts messages only from the installed extension ID and keeps network fetches behind URL, DNS, redirect, timeout, and size checks.</li>
        </ul>
      </motion.section>
    </div>
  );
}

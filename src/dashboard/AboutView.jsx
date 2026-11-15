import { motion } from 'framer-motion';
import Logo from '../components/Logo.jsx';
import Icon from '../components/Icon.jsx';

const TECH_STACK = [
  'React 18',
  'Vite 5',
  'Tailwind CSS 3',
  'Framer Motion 11',
  'Chrome Manifest V3',
  'Chrome Storage API',
  'Service Worker + Alarms',
];

const ROADMAP = [
  {
    version: 'v0.5.0',
    title: 'Design system & popup prototype',
    detail: 'Obsidian / Crimson palette, logo mark, spring-animated popup shell.',
    tag: 'Shipped',
    tagStyle: 'border-white/20 bg-white/5 text-zinc-300',
    dot: 'bg-zinc-400',
  },
  {
    version: 'v1.0.0-alpha',
    title: 'Dashboard, auto-resurrection engine & MV3 pipeline',
    detail:
      'Full-screen dashboard, autonomous check sweep (Active → Auto-Checking → Resurrected / Dead Permanently), linkService.js data layer, multi-page Vite build.',
    tag: 'Current release',
    tagStyle: 'border-crimson/50 bg-crimson/10 text-crimson shadow-glow-xs',
    dot: 'bg-crimson shadow-glow-xs',
    current: true,
  },
  {
    version: 'v1.0.0',
    title: 'Stable — production auto-checker',
    detail:
      'Real HTTP + archive availability checks replace the preview simulation, behind the same 30-minute chrome.alarms cadence.',
    tag: 'Next',
    tagStyle: 'border-white/10 bg-transparent text-zinc-500',
    dot: 'border-2 border-zinc-600 bg-obsidian',
  },
  {
    version: 'v1.1.0',
    title: 'Backend sync & accounts',
    detail: 'syncWithBackend() graduates from placeholder to a real sync API with cross-device vaults.',
    tag: 'Planned',
    tagStyle: 'border-white/10 bg-transparent text-zinc-500',
    dot: 'border-2 border-zinc-600 bg-obsidian',
  },
  {
    version: 'v1.2.0',
    title: 'Multi-archive fallback & per-link schedules',
    detail: 'Wayback, archive.today and custom mirrors, with per-link cadence tuning instead of one global interval.',
    tag: 'Planned',
    tagStyle: 'border-white/10 bg-transparent text-zinc-500',
    dot: 'border-2 border-zinc-600 bg-obsidian',
  },
];

const ARCHITECTURE = [
  {
    icon: 'monitor',
    title: 'Popup UI',
    detail: 'popup.html — compact AdGuard-style control card with monitoring toggle and live counters.',
  },
  {
    icon: 'grid',
    title: 'Dashboard',
    detail: 'dashboard.html — options page with stats, searchable link table and about view.',
  },
  {
    icon: 'power',
    title: 'Service Worker',
    detail: 'background.js — chrome.alarms sweep every 30m; checks live URLs and queries archives autonomously.',
  },
  {
    icon: 'layers',
    title: 'Data Layer',
    detail: 'src/services/linkService.js — chrome.storage.local today, backend API tomorrow.',
  },
];

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } },
};

export default function AboutView() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      {/* Brand hero */}
      <motion.section
        variants={rise}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-panel/70 px-8 py-10 text-center"
      >
        {/* Crimson ambient glow */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-96 -translate-x-1/2 rounded-full bg-crimson/15 blur-3xl" />
        <div className="relative flex flex-col items-center gap-4">
          <Logo size="xl" showWordmark={false} glow />
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Link<span className="font-light text-zinc-300">Resurrector</span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-zinc-400">
            Your links, kept alive. Save anything, detect the rot early, and
            resurrect what the web let die.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full border border-crimson/50 bg-crimson/10 px-3 py-1 text-xs font-semibold text-crimson shadow-glow-xs">
              v1.0.0-alpha
            </span>
          </div>
        </div>
      </motion.section>

      {/* Tech stack */}
      <motion.section variants={rise} className="rounded-2xl border border-white/10 bg-panel/70 p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon name="layers" className="h-4 w-4 text-crimson" />
          Built with
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {TECH_STACK.map((tech) => (
            <motion.span
              key={tech}
              whileHover={{ y: -2 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className="rounded-lg border border-white/10 bg-obsidian px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-crimson/40 hover:text-white"
            >
              {tech}
            </motion.span>
          ))}
        </div>
      </motion.section>

      {/* Changelog / roadmap timeline */}
      <motion.section variants={rise} className="rounded-2xl border border-white/10 bg-panel/70 p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon name="activity" className="h-4 w-4 text-crimson" />
          Changelog & Release Roadmap
        </h2>
        <ol className="mt-6 space-y-0">
          {ROADMAP.map((entry, index) => (
            <motion.li
              key={entry.version}
              variants={rise}
              className="relative flex gap-4 pb-7 last:pb-0"
            >
              {/* Rail */}
              {index < ROADMAP.length - 1 && (
                <span className="absolute left-[7px] top-5 h-full w-px bg-white/10" />
              )}
              {/* Node */}
              <span className={`relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full ${entry.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    className={`text-sm font-bold ${
                      entry.current ? 'text-crimson' : 'text-white'
                    }`}
                  >
                    {entry.version}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${entry.tagStyle}`}
                  >
                    {entry.tag}
                  </span>
                </div>
                <div className="mt-1 text-sm font-medium text-zinc-200">{entry.title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-zinc-500">{entry.detail}</div>
              </div>
            </motion.li>
          ))}
        </ol>
      </motion.section>

      {/* Architecture info */}
      <motion.section variants={rise} className="rounded-2xl border border-white/10 bg-panel/70 p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon name="monitor" className="h-4 w-4 text-crimson" />
          Extension Architecture
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {ARCHITECTURE.map((card) => (
            <motion.div
              key={card.title}
              variants={rise}
              whileHover={{ y: -2 }}
              transition={{ type: 'spring', stiffness: 350, damping: 22 }}
              className="rounded-xl border border-white/10 bg-obsidian p-4"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-crimson/30 bg-crimson/5 text-crimson">
                  <Icon name={card.icon} className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-white">{card.title}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">{card.detail}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      <motion.p variants={rise} className="pb-2 text-center text-[11px] text-zinc-600">
        Rendered entirely through React JSX bindings — zero dangerouslySetInnerHTML,
        zero remote code execution. LinkResurrector {new Date().getFullYear()}.
      </motion.p>
    </motion.div>
  );
}

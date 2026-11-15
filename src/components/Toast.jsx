import { AnimatePresence, motion } from 'framer-motion';
import Icon from './Icon.jsx';

/** Transient feedback pill (saved / deleted / synced …). */
export default function Toast({ toast }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          className={`fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium shadow-xl backdrop-blur ${
            toast.tone === 'danger'
              ? 'border-crimson/50 bg-crimson/15 text-crimson'
              : 'border-white/15 bg-panel/95 text-white'
          }`}
        >
          <Icon
            name={toast.tone === 'danger' ? 'x-circle' : 'check'}
            className="h-3.5 w-3.5"
          />
          {toast.message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

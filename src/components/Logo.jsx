import { motion } from 'framer-motion';

/**
 * LinkResurrector brand mark.
 *
 * A sharp black badge with a crisp white border, bold "LR" in Crimson Red,
 * optionally paired with the "LinkResurrector" wordmark in crisp white.
 */
const SIZES = {
  sm: { badge: 26, radius: 7, font: 27, text: 'text-[13px]' },
  md: { badge: 34, radius: 9, font: 27, text: 'text-[16px]' },
  lg: { badge: 46, radius: 12, font: 27, text: 'text-[22px]' },
  xl: { badge: 96, radius: 24, font: 27, text: 'text-[42px]' },
};

export default function Logo({ size = 'md', showWordmark = true, glow = false }) {
  const s = SIZES[size];

  return (
    <div className="flex items-center gap-2.5 select-none">
      <motion.div
        whileHover={{ scale: 1.06, rotate: -1.5 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        className="shrink-0"
        style={glow ? { filter: 'drop-shadow(0 0 22px rgba(239,68,68,0.4))' } : undefined}
      >
        <svg
          width={s.badge}
          height={s.badge}
          viewBox="0 0 64 64"
          role="img"
          aria-label="LinkResurrector logo"
        >
          {/* Sharp black badge with white border */}
          <rect
            x="2.5"
            y="2.5"
            width="59"
            height="59"
            rx={s.radius}
            fill="#09090B"
            stroke="#FFFFFF"
            strokeWidth="3"
          />
          {/* Crimson base accent */}
          <rect x="16" y="47" width="32" height="5" rx="2.5" fill="#EF4444" />
          {/* Bold crimson LR monogram */}
          <text
            x="32"
            y="31"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
            fontSize={s.font}
            fontWeight="800"
            letterSpacing="-2"
            fill="#EF4444"
          >
            LR
          </text>
        </svg>
      </motion.div>

      {showWordmark && (
        <span className={`tracking-tight leading-none ${s.text}`}>
          <span className="font-bold text-white">Link</span>
          <span className="font-light text-zinc-300">Resurrector</span>
        </span>
      )}
    </div>
  );
}

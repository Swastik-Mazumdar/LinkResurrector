/** @type {import('tailwindcss').Config} */
export default {
  content: ['./popup.html', './dashboard.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Pure Obsidian Black surfaces
        obsidian: '#09090B',
        panel: '#121215',
        // Crimson Red accent scale
        crimson: {
          DEFAULT: '#EF4444',
          deep: '#DC2626',
        },
        // Crisp White typography
        frost: '#F4F4F5',
      },
      boxShadow: {
        glow: '0 0 24px rgba(239, 68, 68, 0.35)',
        'glow-sm': '0 0 12px rgba(239, 68, 68, 0.28)',
        'glow-xs': '0 0 6px rgba(239, 68, 68, 0.45)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.82)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

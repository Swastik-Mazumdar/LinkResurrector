/**
 * Realistic seed data — used when `chrome.storage.local` is empty so the UI
 * looks alive immediately, and as a fallback when previewing the extension
 * in a plain browser (no `chrome` APIs available).
 *
 * Statuses mirror the autonomous lifecycle:
 *   active       — live URL responds
 *   checking     — transient state while the auto-checker runs
 *   resurrected  — live URL died but an archived snapshot was auto-attached
 *   dead         — live URL failed AND no archived snapshot exists
 *
 * Shapes match exactly what the future backend checker will persist:
 * { id, title, url, status, statusCode, archiveUrl?, addedAt, lastChecked }
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const now = Date.now();

export const MOCK_LINKS = [
  {
    id: 'lr_seed_01',
    title: 'React Documentation — Learn React',
    url: 'https://react.dev/learn',
    status: 'active',
    statusCode: 200,
    addedAt: now - 21 * DAY,
    lastChecked: now - 2 * HOUR,
  },
  {
    id: 'lr_seed_02',
    title: 'MDN Web Docs — HTTP Status Codes',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status',
    status: 'active',
    statusCode: 200,
    addedAt: now - 14 * DAY,
    lastChecked: now - 26 * MIN,
  },
  {
    id: 'lr_seed_03',
    title: 'Framer Motion — Animation Library',
    url: 'https://www.framer.com/motion/',
    status: 'active',
    statusCode: 200,
    addedAt: now - 9 * DAY,
    lastChecked: now - 5 * HOUR,
  },
  {
    id: 'lr_seed_04',
    title: 'Legacy REST Playground — v1 API',
    url: 'https://api.example-legacy.dev/v1/users',
    status: 'dead',
    statusCode: 404,
    addedAt: now - 63 * DAY,
    lastChecked: now - 12 * MIN,
  },
  {
    id: 'lr_seed_05',
    title: 'Old Blog — Deploying Free Tiers (Heroku)',
    url: 'https://oldblog.dev/posts/heroku-free-tier-is-gone',
    status: 'dead',
    statusCode: 404,
    addedAt: now - 120 * DAY,
    lastChecked: now - 3 * HOUR,
  },
  {
    id: 'lr_seed_06',
    title: 'Tailwind CSS — v3 Customization Docs',
    url: 'https://tailwindcss.com/docs/customization',
    status: 'resurrected',
    statusCode: 200,
    archiveUrl: 'https://web.archive.org/web/2024/https://tailwindcss.com/docs/customization',
    addedAt: now - 45 * DAY,
    lastChecked: now - 41 * MIN,
  },
  {
    id: 'lr_seed_07',
    title: 'Chrome Extensions — Manifest V3 Overview',
    url: 'https://developer.chrome.com/docs/extensions/develop/concepts/mv3-overview',
    status: 'active',
    statusCode: 200,
    addedAt: now - 6 * DAY,
    lastChecked: now - 22 * HOUR,
  },
  {
    id: 'lr_seed_08',
    title: 'GitHub Blog — Octoverse Report',
    url: 'https://github.blog/2024-10-29-octoverse-2024/',
    status: 'resurrected',
    statusCode: 200,
    archiveUrl: 'https://web.archive.org/web/2025/https://github.blog/2024-10-29-octoverse-2024/',
    addedAt: now - 30 * DAY,
    lastChecked: now - 8 * HOUR,
  },
  {
    id: 'lr_seed_09',
    title: 'Vite — Build Tool Guide',
    url: 'https://vite.dev/guide/',
    status: 'active',
    statusCode: 200,
    addedAt: now - 4 * DAY,
    lastChecked: now - 55 * MIN,
  },
  {
    id: 'lr_seed_10',
    title: 'Startup Pitch Deck — Static Mirror',
    url: 'https://mirror.notion-static.dev/deck-final-v2',
    status: 'dead',
    statusCode: 404,
    addedAt: now - 2 * DAY,
    lastChecked: now - 90 * MIN,
  },
];

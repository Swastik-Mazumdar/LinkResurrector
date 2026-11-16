import { useState } from 'react';
import { domainOf } from '../lib/format.js';

/**
 * Renders a website's favicon using Google's favicon service,
 * gracefully falling back to a clean initial letter badge.
 */
export default function SiteIcon({ url, title, className = '', size = 'md' }) {
  const [failed, setFailed] = useState(false);
  const domain = domainOf(url);
  const faviconUrl = domain
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
    : null;

  // Clean initial: take the first alphanumeric character, skipping notifications like '(' or '['
  const cleanChar = (title || domain || 'W')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .charAt(0)
    .toUpperCase() || 'W';

  const boxSize = size === 'sm' ? 'h-6 w-6 rounded-md text-[10px]' : 'h-8 w-8 rounded-lg text-xs';
  const imgSize = size === 'sm' ? 'h-4 w-4' : 'h-4 w-4';

  return (
    <span
      className={`flex shrink-0 items-center justify-center border border-white/10 bg-obsidian font-bold text-crimson overflow-hidden ${boxSize} ${className}`}
    >
      {!failed && faviconUrl ? (
        <img
          src={faviconUrl}
          alt=""
          loading="lazy"
          className={`${imgSize} object-contain rounded-xs`}
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{cleanChar}</span>
      )}
    </span>
  );
}

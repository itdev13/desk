import React from 'react';

/**
 * HelpDesk icon mark — the amber tile with a ticket stub carrying a check.
 * Inline SVG so it scales crisply at any size and needs no asset request. Mirrors public/icon.svg
 * (the vector of the icon uploaded to the GHL marketplace listing) so the in-app brand matches it.
 */
export function LogoMark({ size = 32 }) {
  const gid = `hd-amber-${React.useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 800 800" role="img" aria-label="HelpDesk" style={{ display: 'block', flex: 'none' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F0C27E" />
          <stop offset="1" stopColor="#CF8732" />
        </linearGradient>
      </defs>
      <rect width="800" height="800" rx="180" fill={`url(#${gid})`} />
      <g fill="none" stroke="#3A2408" strokeWidth="38" strokeLinecap="round" strokeLinejoin="round">
        <path d="M260 255H540A45 45 0 0 1 585 300V338A62 62 0 0 0 585 462V500A45 45 0 0 1 540 545H260A45 45 0 0 1 215 500V462A62 62 0 0 0 215 338V300A45 45 0 0 1 260 255Z" fill="#F3D3A0" fillOpacity="0.55" />
        <path d="M440 260V300M440 370V430M440 500V540" />
        <path d="M318 398L352 432L408 372" />
      </g>
    </svg>
  );
}

/** Icon + "HelpDesk" wordmark lockup (Desk in accent). `onDark` flips the word color to white. */
export function Logo({ size = 30, onDark = false, brandName }) {
  // When white-labeled, show the brand name as plain text next to the mark.
  if (brandName && brandName !== 'HelpDesk') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <LogoMark size={size} />
        <span style={{ fontWeight: 800, letterSpacing: '-0.01em', fontSize: size * 0.55, color: onDark ? '#fff' : 'var(--ink)' }}>
          {brandName}
        </span>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} />
      <span style={{ fontWeight: 800, letterSpacing: '-0.01em', fontSize: size * 0.55, color: onDark ? '#fff' : 'var(--ink)' }}>
        Help<span style={{ color: 'var(--accent)' }}>Desk</span>
      </span>
    </span>
  );
}

import React from 'react';

/**
 * HelmDesk icon mark — the amber tile with an "H" whose crossbar carries a helm hub.
 * Inline SVG so it scales crisply at any size and needs no asset request. Mirrors public/icon.svg
 * (the file uploaded to the GHL marketplace listing) so the in-app brand matches the listing exactly.
 */
export function LogoMark({ size = 32, hub = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 112 112" role="img" aria-label="HelmDesk" style={{ display: 'block', flex: 'none' }}>
      <defs>
        <linearGradient id="hd-amber" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ECB45F" />
          <stop offset="1" stopColor="#D4912F" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="104" height="104" rx="26" fill="url(#hd-amber)" />
      <g fill="#0F1729">
        <rect x="34" y="32" width="12" height="48" rx="3" />
        <rect x="66" y="32" width="12" height="48" rx="3" />
        <rect x="40" y="50" width="32" height="11" rx="3" />
      </g>
      {hub && (
        <>
          <circle cx="56" cy="55.5" r="5.2" fill="#0F1729" />
          <circle cx="56" cy="55.5" r="2.2" fill="#D4912F" />
        </>
      )}
    </svg>
  );
}

/** Icon + "HelmDesk" wordmark lockup (Desk in accent). `onDark` flips the word color to white. */
export function Logo({ size = 30, onDark = false, brandName }) {
  // When white-labeled, show the brand name as plain text next to the mark.
  if (brandName && brandName !== 'HelmDesk') {
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
        Helm<span style={{ color: 'var(--accent)' }}>Desk</span>
      </span>
    </span>
  );
}

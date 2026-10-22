import React, { useEffect } from 'react';
import { track } from '../lib/analytics.js';

/**
 * Upgrade/reconnect prompt — a modal OVERLAY on top of the working app (not a blind full-page block).
 *
 * Shown to admins when the install is on an older app version than the one we flagged forceReconnect
 * (e.g. a release that added the contact-creation flow). The user can:
 *   • Update now  → redirect to their CRM's app integration page to re-authorize / accept the update.
 *   • Not now     → dismiss for THIS session only. It reappears on the next page load (we don't persist
 *                   the dismissal), so they can keep working but are reminded until they update.
 *
 * `reconnectUrl` is computed server-side (agency white-label domain + /v2/location/{id}/integration/{appId}).
 */
export default function ReconnectModal({ brand, reason, reconnectUrl, onClose }) {
  const brandName = brand?.name || 'HelmDesk';
  const accent = brand?.primaryColor || '#E0A24A';

  useEffect(() => {
    track('reconnect_modal_view');
    // Close on Escape (same as "Not now").
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = () => {
    track('reconnect_update_click');
    if (reconnectUrl) {
      // Break out of the GHL iframe so the integration page opens at the top level, not nested.
      try { window.top.location.href = reconnectUrl; }
      catch { window.open(reconnectUrl, '_blank', 'noopener'); }
    }
  };

  return (
    <div className="rc-overlay" role="dialog" aria-modal="true" aria-labelledby="rc-title" onMouseDown={onClose}>
      {/* stopPropagation so clicks inside the card don't dismiss */}
      <div className="rc-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rc-glow" style={{ background: `radial-gradient(120px 120px at 50% 0%, ${accent}33, transparent 70%)` }} />

        <div className="rc-badge" style={{ background: `${accent}1A`, color: accent }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2v6m0 0l3-3m-3 3L9 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 12a8 8 0 1 0 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>

        <h2 id="rc-title" className="rc-title">A quick update to {brandName}</h2>
        <p className="rc-body">
          {reason || `We’ve added a new contact-creation flow in the latest version of ${brandName}. To switch it on, we just need you to approve the update — it only takes a moment.`}
        </p>

        <ul className="rc-points">
          <li><span className="rc-dot" style={{ background: accent }} /> Automatically create &amp; enrich contacts from new tickets</li>
          <li><span className="rc-dot" style={{ background: accent }} /> Your existing tickets, settings and team stay exactly as they are</li>
          <li><span className="rc-dot" style={{ background: accent }} /> Takes less than a minute — no reinstall needed</li>
        </ul>

        <div className="rc-actions">
          <button type="button" className="rc-later" onClick={onClose}>Not now</button>
          <button type="button" className="rc-update" onClick={update} style={{ background: accent }} disabled={!reconnectUrl}>
            Update now
          </button>
        </div>

        <p className="rc-foot">You can keep working in the meantime — we’ll remind you next time you open {brandName}.</p>
      </div>
    </div>
  );
}

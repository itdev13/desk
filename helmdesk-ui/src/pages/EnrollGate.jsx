import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../components/ui.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { track } from '../lib/analytics.js';

/**
 * Full-screen enrolment gate — shown when the workspace has no active subscription. Blocks the app
 * entirely and presents the available plans; "Enrol" deep-links to the GHL plan page for this
 * location. The user gets in only once they've subscribed (then a PLAN_CHANGE/INSTALL webhook
 * activates the sub, and a re-open / retry lets them through).
 */
export default function EnrollGate({ brand, notify, onRetry }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    track('enroll_gate_view');
    api.plans().then(setData).catch((e) => notify?.(e.message, true)).finally(() => setLoading(false));
  }, [notify]);

  const enroll = (plan) => {
    track('enroll_click', { plan: plan?.name });
    const url = data?.enrolUrl || data?.upgradeUrl;
    if (url) window.open(url, '_blank', 'noopener');
    else notify?.('Please subscribe from your marketplace account to activate HelmDesk.', false);
  };

  const plans = data?.plans || [];
  const brandName = brand?.name || 'HelmDesk';

  return (
    <div className="enroll-wrap">
      <div className="enroll-inner">
        <div className="enroll-head">
          <LogoMark size={44} />
          <h1>Choose a plan to get started</h1>
          <p>Your {brandName} workspace needs an active plan before you can manage tickets. Pick a plan below to enrol — it takes effect as soon as it’s confirmed.</p>
        </div>

        {loading ? (
          <div className="empty"><div className="spinner" style={{ margin: '32px auto' }} /></div>
        ) : (
          <div className="plan-grid enroll-grid">
            {plans.map((p, i) => (
              <div key={p.name} className={`plan-card ${i === 1 ? 'is-current' : ''}`}>
                {i === 1 && <span className="plan-badge">Popular</span>}
                <div className="plan-name">{p.name}</div>
                <div className="plan-price"><span className="amt">${p.priceUsd}</span><span className="per">/mo</span></div>
                <ul className="plan-features">
                  {p.features.map((f, fi) => <li key={fi}><Icon name="check" size={14} /> {f}</li>)}
                </ul>
                <button className="btn btn-accent" onClick={() => enroll(p)}>Enrol in {p.name}</button>
              </div>
            ))}
          </div>
        )}

        <div className="enroll-foot">
          <span>Already subscribed?</span>
          <button className="link-btn" onClick={onRetry}>Refresh</button>
        </div>
      </div>
    </div>
  );
}

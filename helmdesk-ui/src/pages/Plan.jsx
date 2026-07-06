import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../components/ui.jsx';
import { track } from '../lib/analytics.js';

/**
 * Pricing / plan page. Shows every tier as a card with the current plan flagged. Upgrades are a
 * GHL-marketplace billing action (the app can't move a customer to a paid tier itself), so the
 * "Upgrade" button deep-links to the marketplace billing page (MARKETPLACE_UPGRADE_URL).
 */
export default function Plan({ notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.plans()
      .then(setData)
      .catch((e) => notify?.(e.message, true))
      .finally(() => setLoading(false));
  }, [notify]);

  if (loading) return (<><div className="topbar"><h1>Plan &amp; billing</h1></div><div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div></>);

  const plans = data?.plans || [];
  const currentIdx = plans.findIndex((p) => p.isCurrent);
  const upgradeUrl = data?.upgradeUrl;

  const onUpgrade = (targetPlan) => {
    track('plan_upgrade_click', { to: targetPlan?.name, from: data?.current?.name, hadUrl: !!upgradeUrl });
    if (upgradeUrl) window.open(upgradeUrl, '_blank', 'noopener');
    else notify?.('Contact us to change your plan — upgrades are managed in your marketplace account.', false);
  };

  return (
    <>
      <div className="topbar">
        <h1>Plan &amp; billing</h1>
        <span className="sub">Your subscription and available tiers.</span>
      </div>

      <div className="page">
        {data?.current?.status === 'trialing' && (
          <div className="plan-trial-banner">
            <Icon name="clock" size={16} /> You’re on a free trial of <b>{data.current.name}</b>. Upgrade any time to keep access.
          </div>
        )}

        <div className="plan-grid">
          {plans.map((p, i) => {
            const isCurrent = p.isCurrent;
            const isUpgrade = currentIdx >= 0 && i > currentIdx;
            return (
              <div key={p.name} className={`plan-card ${isCurrent ? 'is-current' : ''}`}>
                {isCurrent && <span className="plan-badge">Current plan</span>}
                <div className="plan-name">{p.name}</div>
                <div className="plan-price">
                  <span className="amt">${p.priceUsd}</span><span className="per">/mo</span>
                </div>
                <ul className="plan-features">
                  {p.features.map((f, fi) => (
                    <li key={fi}><Icon name="check" size={14} /> {f}</li>
                  ))}
                </ul>
                {isCurrent ? (
                  <button className="btn plan-current-btn" disabled>
                    <Icon name="check" size={15} /> Current plan
                  </button>
                ) : isUpgrade ? (
                  <button className="btn btn-accent" onClick={() => onUpgrade(p)}>Upgrade to {p.name}</button>
                ) : (
                  <button className="btn btn-ghost" onClick={() => onUpgrade(p)}>Switch to {p.name}</button>
                )}
              </div>
            );
          })}
        </div>

        <p className="plan-foot">
          Plans are billed monthly through your marketplace account. Changing plans takes effect immediately;
          your access updates as soon as the change is confirmed.
        </p>
      </div>
    </>
  );
}

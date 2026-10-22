const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');
const SubscriptionTransaction = require('../models/SubscriptionTransaction');
const OnboardingCharge = require('../models/OnboardingCharge');

/**
 * VENDOR revenue summary — how much HelmDesk generates across ALL workspaces.
 *
 * This is YOUR (the app vendor's) number, not an agency's, so it is NOT behind the per-workspace
 * session auth. It's gated by a secret in the REVENUE_API_KEY env var, passed as ?key=… or an
 * x-revenue-key header. If the env var isn't set, the route is disabled (404) so it can't leak.
 *
 * NOTE: GoHighLevel collects the subscription fee and pays you out (minus their cut). These numbers
 * are HelmDesk's own mirror of who's subscribed to what — an estimate. GHL's marketplace dashboard
 * is the authoritative payout figure.
 */
function guard(req, res, next) {
  const key = process.env.REVENUE_API_KEY;
  if (!key) return res.status(404).json({ success: false, error: 'Not found' }); // disabled until configured
  const provided = req.query.key || req.headers['x-revenue-key'];
  if (provided !== key) return res.status(401).json({ success: false, error: 'Unauthorized' });
  next();
}

router.get('/', guard, async (req, res) => {
  try {
    // ── Active subscriptions → MRR (sum of active monthly prices). Trials count toward entitlement
    //    but aren't paying yet, so they're reported separately, not in MRR.
    const byPlan = await Subscription.aggregate([
      { $group: {
        _id: { planName: { $ifNull: ['$planName', 'Unknown'] }, status: '$status' },
        count: { $sum: 1 },
        price: { $avg: '$priceUsd' }
      } }
    ]);

    // Fold the plan/status rows into a readable shape.
    const plans = {}; // planName → { active, trialing, past_due, canceled, priceUsd }
    let mrr = 0, activeCount = 0, trialingCount = 0, pastDueCount = 0;
    for (const row of byPlan) {
      const name = String(row._id.planName).replace(/\s*\(Trial\)\s*$/i, '');
      const status = row._id.status;
      plans[name] = plans[name] || { plan: name, active: 0, trialing: 0, past_due: 0, canceled: 0, inactive: 0, priceUsd: 0 };
      plans[name][status] = (plans[name][status] || 0) + row.count;
      if (row.price) plans[name].priceUsd = Math.round(row.price);
      if (status === 'active') { mrr += (row.price || 0) * row.count; activeCount += row.count; }
      if (status === 'trialing') trialingCount += row.count;
      if (status === 'past_due') pastDueCount += row.count;
    }

    // ── Total collected to date (from invoice_paid transactions GHL reported).
    const invoiceAgg = await SubscriptionTransaction.aggregate([
      { $match: { event: 'invoice_paid' } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$amountPaid', 0] } }, count: { $sum: 1 } } }
    ]);
    const invoices = invoiceAgg[0] || { total: 0, count: 0 };

    // ── Paid onboarding calls (the one per-item charge) — extra revenue.
    const onboardingAgg = await OnboardingCharge.aggregate([
      { $match: { status: 'charged' } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$amountUsd', 0] } }, count: { $sum: 1 } } }
    ]);
    const onboarding = onboardingAgg[0] || { total: 0, count: 0 };

    res.json({
      success: true,
      currency: 'USD',
      note: 'Estimate from HelmDesk\'s own data. GoHighLevel collects the fee; its dashboard is the authoritative payout.',
      mrr: Math.round(mrr),                         // monthly recurring revenue (active subs)
      arr: Math.round(mrr * 12),                    // annualized
      subscribers: { active: activeCount, trialing: trialingCount, past_due: pastDueCount },
      byPlan: Object.values(plans).sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0)),
      collectedToDate: {
        subscriptionInvoices: Math.round(invoices.total), invoiceCount: invoices.count,
        onboardingCalls: Math.round(onboarding.total), onboardingCount: onboarding.count,
        total: Math.round(invoices.total + onboarding.total)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

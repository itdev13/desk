const logger = require('../utils/logger');
const database = require('../config/database');

/**
 * Monthly-only subscription mirror for HelmDesk.
 *
 * GHL collects the recurring fee (set as the app's subscription price in the marketplace
 * dashboard). This service mirrors entitlement so the app can gate access, and maps GHL planIds
 * to display tiers / seat limits. There is NO usage metering or overage — a ticket costs nothing
 * to store, so there is nothing to charge per use.
 */

function defaultPlan() {
  return {
    name: process.env.PLAN_NAME || 'Starter',
    priceUsd: Number(process.env.PLAN_PRICE_USD || 29),
    seatLimit: Number(process.env.PLAN_SEAT_LIMIT || 3)
  };
}

/**
 * Optional multi-tier catalog. GHL only sends a planId — we map it to a tier.
 *   PLANS_JSON='{"<starterId>":{"name":"Starter","priceUsd":29,"seatLimit":3},
 *                "<teamId>":{"name":"Team","priceUsd":79,"seatLimit":10},
 *                "<agencyId>":{"name":"Agency","priceUsd":99,"seatLimit":9999}}'
 */
function planCatalog() {
  try {
    return process.env.PLANS_JSON ? JSON.parse(process.env.PLANS_JSON) : {};
  } catch {
    logger.warn('PLANS_JSON is not valid JSON — ignoring; using default plan');
    return {};
  }
}

function planForId(planId) {
  const catalog = planCatalog();
  if (planId && catalog[planId]) return { ...catalog[planId] };
  return defaultPlan();
}

/**
 * White-label entitlement for a plan: the top tier (unlimited seats), or any catalog plan flagged
 * `whiteLabel:true`. Single source of truth for both getStatus() and planFeatures().
 */
function whiteLabelFor(plan) {
  const name = (plan?.name || '').replace(/\s*\(Trial\)\s*$/i, '');
  const catalog = planCatalog();
  const entry = Object.values(catalog).find((p) => p.name === name);
  return Number(plan?.seatLimit ?? 3) >= 9999 || entry?.whiteLabel === true;
}

/**
 * Auto-routing (round-robin) is a multi-agent feature — available once a plan has more than the
 * base 3 seats (Team & Agency). Starter is single-owner: it can assign to one agent or leave
 * unassigned, but not round-robin. A catalog plan can force it on with `routing:true`.
 */
function routingFor(plan) {
  const name = (plan?.name || '').replace(/\s*\(Trial\)\s*$/i, '');
  const catalog = planCatalog();
  const entry = Object.values(catalog).find((p) => p.name === name);
  return Number(plan?.seatLimit ?? 3) > 3 || entry?.routing === true;
}

/**
 * Sensible feature bullets when a catalog tier doesn't specify its own `features` array.
 * Reflects what the tier ACTUALLY grants — white-label only appears on white-label tiers so the
 * card doesn't advertise a feature the plan can't use.
 */
function defaultFeatures(p) {
  const seats = (p.seatLimit ?? 3) >= 9999 ? 'Unlimited agents' : `Up to ${p.seatLimit ?? 3} agents`;
  const bullets = [seats, 'Unlimited tickets', 'SLA tracking & overdue flags', 'Kanban board & dashboard'];
  // Show only what the tier actually grants, so cards never advertise a gated feature.
  if (routingFor(p)) bullets.push('Round-robin auto-assignment');
  if (whiteLabelFor(p)) bullets.push('White-label branding & client portal');
  return bullets;
}

/**
 * Build the plan/upgrade deep-link for a location:
 *   https://{domain}/v2/location/{locationId}/custom-page-link/{appId}
 *
 * The host is the agency's white-label domain (captured at INSTALL as whitelabelDetails.domain) so
 * the link opens on the agency's OWN domain — falling back to the standard GHL host otherwise.
 * A MARKETPLACE_UPGRADE_URL env value, if set, overrides everything (escape hatch).
 */
async function buildUpgradeUrl(locationId) {
  if (process.env.MARKETPLACE_UPGRADE_URL) return process.env.MARKETPLACE_UPGRADE_URL;
  try {
    const Installation = require('../models/Installation');
    const inst = await Installation.findOne({ locationId, status: 'active' }).sort({ updatedAt: -1 }).lean();
    const appId = inst?.appId || process.env.GHL_APP_ID;
    if (!appId || !locationId) return '';

    const versionId = process.env.GHL_APP_VERSION_ID || '';
    const rawDomain = inst?.whitelabelDetails?.domain || process.env.GHL_DEFAULT_APP_DOMAIN || 'app.gohighlevel.com';
    const host = String(rawDomain).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    // The SaaS plan/enrol page for this app in the sub-account:
    //   https://{host}/v2/location/{locationId}/integration/{appId}/versions/{versionId}
    const base = `https://${host}/v2/location/${locationId}/integration/${appId}`;
    return versionId ? `${base}/versions/${versionId}` : base;
  } catch {
    return '';
  }
}

function isRequired() {
  // Default ON. Set SUBSCRIPTION_REQUIRED=false for local testing without a real plan.
  return String(process.env.SUBSCRIPTION_REQUIRED ?? 'true').toLowerCase() !== 'false';
}

function addOneMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  return d;
}

class SubscriptionService {
  isRequired() {
    return isRequired();
  }

  planForId(planId) {
    return planForId(planId);
  }

  /** Activate / renew / change a subscription — called from INSTALL and PLAN_CHANGE webhooks. */
  async activate({ locationId, companyId, appId, planId, trial, status, raw } = {}) {
    if (!database.isConnected()) return null;
    const Subscription = require('../models/Subscription');
    const p = planForId(planId);
    const now = new Date();

    let resolvedStatus = status;
    let periodEnd;
    let isTrial = false;
    if (!resolvedStatus && trial?.onTrial) {
      resolvedStatus = 'trialing';
      isTrial = true;
      const start = trial.trialStartDate ? new Date(trial.trialStartDate) : now;
      periodEnd = new Date(start.getTime() + (Number(trial.trialDuration) || 0) * 24 * 60 * 60 * 1000);
    }
    if (!resolvedStatus) resolvedStatus = 'active';

    const existing = await Subscription.findOne(locationId ? { locationId } : { companyId });
    const periodStart = existing?.currentPeriodStart || now;
    if (!periodEnd) {
      periodEnd = existing?.currentPeriodEnd && existing.currentPeriodEnd > now ? existing.currentPeriodEnd : addOneMonth(now);
    }

    return Subscription.findOneAndUpdate(
      locationId ? { locationId } : { companyId },
      {
        locationId,
        companyId,
        appId,
        planId,
        planName: isTrial ? `${p.name} (Trial)` : p.name,
        priceUsd: p.priceUsd,
        seatLimit: p.seatLimit ?? 3,
        status: resolvedStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        ...(raw ? { rawWebhookData: raw } : {})
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async setStatus({ locationId, companyId }, status, raw) {
    if (!database.isConnected()) return null;
    const Subscription = require('../models/Subscription');
    const update = { status, ...(raw ? { rawWebhookData: raw } : {}) };
    if (status === 'canceled') update.canceledAt = new Date();
    return Subscription.findOneAndUpdate(locationId ? { locationId } : { companyId }, update, { new: true });
  }

  /** Current subscription for a location. */
  async getStatus(locationId) {
    if (!database.isConnected()) {
      return { entitled: !isRequired(), status: 'unknown', dbDisabled: true, plan: defaultPlan() };
    }
    const Subscription = require('../models/Subscription');
    const sub = await Subscription.findOne({ locationId });
    if (!sub) {
      const p = defaultPlan();
      return { entitled: !isRequired(), status: 'none', plan: { ...p, whiteLabel: whiteLabelFor(p), routing: routingFor(p) }, required: isRequired() };
    }

    const plan = { name: sub.planName, priceUsd: sub.priceUsd, seatLimit: sub.seatLimit };
    return {
      entitled: isRequired() ? sub.isEntitled() : true,
      required: isRequired(),
      status: sub.status,
      plan: { ...plan, whiteLabel: whiteLabelFor(plan), routing: routingFor(plan) },
      currentPeriodEnd: sub.currentPeriodEnd
    };
  }

  /**
   * All purchasable plans for the pricing page, ordered by price, with the caller's current plan
   * flagged. Sourced from PLANS_JSON (the catalog) with the single default plan as a fallback.
   * Upgrades happen in the GHL marketplace, so we also return the marketplace upgrade URL.
   */
  async listPlans(locationId) {
    const current = await this.getStatus(locationId);
    const currentName = (current.plan?.name || '').replace(/\s*\(Trial\)\s*$/i, '');
    const envCatalog = planCatalog(); // planId → { name, priceUsd, seatLimit, features }

    // Plans come from PLANS_JSON (the app's configured tiers); the single default plan is the fallback.
    let tiers = Object.entries(envCatalog).map(([planId, p]) => ({ planId, ...p }));
    if (tiers.length === 0) tiers = [{ planId: null, ...defaultPlan() }];
    tiers.sort((a, b) => (a.priceUsd || 0) - (b.priceUsd || 0));

    const plans = tiers.map((p) => ({
      planId: p.planId,
      name: p.name,
      priceUsd: p.priceUsd,
      seatLimit: p.seatLimit ?? 3,
      features: Array.isArray(p.features) ? p.features : defaultFeatures(p),
      isCurrent: p.name === currentName
    }));

    return {
      plans,
      current: { name: current.plan?.name, status: current.status, priceUsd: current.plan?.priceUsd },
      upgradeUrl: await buildUpgradeUrl(locationId)
    };
  }

  /** Throw 402 if a subscription is required but the location isn't entitled. */
  async ensureEntitled(locationId) {
    if (!isRequired()) return;
    const status = await this.getStatus(locationId);
    if (!status.entitled) {
      const err = new Error('An active subscription is required for this workspace.');
      err.status = 402;
      err.code = 'SUBSCRIPTION_REQUIRED';
      throw err;
    }
  }

  /**
   * Resolve the entitlements the current plan grants, for enforcement:
   *   - seatLimit: max active agents (9999 = unlimited)
   *   - whiteLabel: may set custom brand/color/portal (top tier, or whiteLabel:true in PLANS_JSON)
   * Falls back to generous values when a plan can't be resolved so we never wrongly lock a paying
   * customer out.
   */
  async planFeatures(locationId) {
    const status = await this.getStatus(locationId);
    const seatLimit = Number(status.plan?.seatLimit ?? 3);
    const name = (status.plan?.name || '').replace(/\s*\(Trial\)\s*$/i, '');
    return { seatLimit, whiteLabel: whiteLabelFor(status.plan), routing: routingFor(status.plan), planName: name };
  }
}

module.exports = new SubscriptionService();

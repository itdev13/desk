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
 *                "<agencyId>":{"name":"Agency","priceUsd":149,"seatLimit":9999}}'
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
 * Sensible feature bullets when a catalog tier doesn't specify its own `features` array.
 * Reflects what the tier ACTUALLY grants — white-label only appears on white-label tiers so the
 * card doesn't advertise a feature the plan can't use.
 */
function defaultFeatures(p) {
  const seats = (p.seatLimit ?? 3) >= 9999 ? 'Unlimited agents' : `Up to ${p.seatLimit ?? 3} agents`;
  const bullets = [seats, 'Unlimited tickets', 'SLA tracking & alerts', 'Kanban board & dashboard'];
  // White-label + client portal is the top-tier differentiator; other tiers show routing instead.
  bullets.push(whiteLabelFor(p) ? 'White-label branding & client portal' : 'Round-robin assignment');
  return bullets;
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
      return { entitled: !isRequired(), status: 'none', plan: { ...p, whiteLabel: whiteLabelFor(p) }, required: isRequired() };
    }

    const plan = { name: sub.planName, priceUsd: sub.priceUsd, seatLimit: sub.seatLimit };
    return {
      entitled: isRequired() ? sub.isEntitled() : true,
      required: isRequired(),
      status: sub.status,
      plan: { ...plan, whiteLabel: whiteLabelFor(plan) },
      currentPeriodEnd: sub.currentPeriodEnd
    };
  }

  /**
   * All purchasable plans for the pricing page, ordered by price, with the caller's current plan
   * flagged. Sourced from PLANS_JSON (the catalog) with the single default plan as a fallback.
   * Upgrades happen in the GHL marketplace, so we also return the marketplace upgrade URL.
   */
  async listPlans(locationId) {
    const catalog = planCatalog();
    const current = await this.getStatus(locationId);
    const currentName = (current.plan?.name || '').replace(/\s*\(Trial\)\s*$/i, '');

    // Build the tier list: from the catalog if configured, else the single default plan.
    let tiers = Object.entries(catalog).map(([planId, p]) => ({ planId, ...p }));
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
      // Where the "Upgrade" button sends the user (GHL marketplace app / billing page).
      upgradeUrl: process.env.MARKETPLACE_UPGRADE_URL || ''
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
    return { seatLimit, whiteLabel: whiteLabelFor(status.plan), planName: name };
  }
}

module.exports = new SubscriptionService();

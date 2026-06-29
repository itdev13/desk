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
 *                "<agencyId>":{"name":"Agency","priceUsd":199,"seatLimit":9999}}'
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
    if (!sub) return { entitled: !isRequired(), status: 'none', plan: defaultPlan(), required: isRequired() };

    return {
      entitled: isRequired() ? sub.isEntitled() : true,
      required: isRequired(),
      status: sub.status,
      plan: { name: sub.planName, priceUsd: sub.priceUsd, seatLimit: sub.seatLimit },
      currentPeriodEnd: sub.currentPeriodEnd
    };
  }

  /** Throw 402 if a subscription is required but the location isn't entitled. */
  async ensureEntitled(locationId) {
    if (!isRequired()) return;
    const status = await this.getStatus(locationId);
    if (!status.entitled) {
      const err = new Error('An active HelmDesk subscription is required for this workspace.');
      err.status = 402;
      err.code = 'SUBSCRIPTION_REQUIRED';
      throw err;
    }
  }
}

module.exports = new SubscriptionService();

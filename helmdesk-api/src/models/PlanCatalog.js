const mongoose = require('mongoose');

/**
 * SaaS plan definitions, synced from the GHL `SaasPlanCreate` webhook (which fires when a plan is
 * created/updated in the app's SaaS configurator). This is the DYNAMIC source of truth for the
 * pricing page and planId→tier mapping — it supersedes the static PLANS_JSON env (kept as a
 * fallback when the catalog is empty, e.g. before the first webhook lands).
 *
 * One document per plan (keyed by GHL planId).
 */
const planCatalogSchema = new mongoose.Schema(
  {
    planId: { type: String, required: true, unique: true, index: true },
    appId: { type: String, index: true },
    companyId: { type: String, index: true },
    versionId: { type: String, default: null }, // used to build the enrol/upgrade deep-link

    title: { type: String, default: 'Plan' },
    description: { type: String, default: '' },
    priceUsd: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    billingInterval: { type: String, default: 'monthly' }, // monthly | yearly | one-time
    planLevel: { type: Number, default: 1 }, // GHL tier level (1=basic … higher=bigger); orders the cards

    trialPeriodDays: { type: Number, default: 0 },
    saasProducts: { type: [String], default: [] }, // included features
    addOns: { type: [String], default: [] },

    active: { type: Boolean, default: true }, // set false if a plan is removed/deactivated
    raw: { type: mongoose.Schema.Types.Mixed } // full webhook payload, for audit
  },
  { timestamps: true }
);

planCatalogSchema.index({ appId: 1, planLevel: 1 });

module.exports = mongoose.model('PlanCatalog', planCatalogSchema);

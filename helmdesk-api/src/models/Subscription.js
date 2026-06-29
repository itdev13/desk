const mongoose = require('mongoose');

/**
 * One subscription per install (location-level; company-level for agency installs).
 *
 * HelmDesk is MONTHLY-ONLY: there is no usage metering or overage. A ticket costs us nothing
 * to store, so there is nothing to meter — the recurring fee is collected by GoHighLevel
 * (configured as the app's subscription price in the marketplace dashboard) and this record
 * mirrors entitlement status. PLAN_CHANGE moves a workspace between tiers (e.g. seat count).
 */
const subscriptionSchema = new mongoose.Schema(
  {
    locationId: { type: String, index: true },
    companyId: { type: String, index: true },
    appId: String,

    planId: { type: String, index: true }, // GHL marketplace plan id from install/plan-change
    planName: { type: String, default: 'Starter' },
    priceUsd: { type: Number, default: 0 },
    seatLimit: { type: Number, default: 3 }, // agents allowed on this tier (display/enforcement)

    // active/trialing => entitled. past_due/canceled/inactive => blocked.
    status: {
      type: String,
      enum: ['active', 'trialing', 'past_due', 'canceled', 'inactive'],
      default: 'inactive',
      index: true
    },

    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    canceledAt: Date,
    rawWebhookData: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

subscriptionSchema.index({ locationId: 1, status: 1 });

subscriptionSchema.methods.isEntitled = function isEntitled() {
  return this.status === 'active' || this.status === 'trialing';
};

module.exports = mongoose.model('Subscription', subscriptionSchema);

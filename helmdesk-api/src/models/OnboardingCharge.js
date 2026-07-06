const mongoose = require('mongoose');

/**
 * Ledger for one-time paid onboarding calls ($2 / 30 min). Each row is one attempt to charge the
 * agency's GHL wallet for a booked call. `_id` doubles as the GHL charge idempotency `eventId`,
 * so a retried request never double-charges. Unlike SubscriptionTransaction (subscription mirror),
 * this is the ONLY place HelmDesk collects a per-item charge — and it's revenue, not an API cost.
 */
const onboardingChargeSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    companyId: { type: String, index: true },
    userId: String,
    requestedByName: String,
    requestedByEmail: String,

    amountUsd: { type: Number, required: true },
    durationMins: { type: Number, default: 30 },

    status: {
      type: String,
      // 'tested' = internal-testing company; flow completed but no real charge was made.
      enum: ['pending', 'charged', 'failed', 'tested'],
      default: 'pending',
      index: true
    },
    ghlChargeId: String,
    failureReason: String,
    insufficientFunds: { type: Boolean, default: false },
    internalTesting: { type: Boolean, default: false },

    // Set once charged so the UI can reveal the scheduling link.
    schedulingUrl: String
  },
  { timestamps: true }
);

module.exports = mongoose.model('OnboardingCharge', onboardingChargeSchema);

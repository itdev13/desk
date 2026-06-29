const mongoose = require('mongoose');

/**
 * Subscription lifecycle + invoice ledger (analytics / audit). Not a charge engine —
 * HelmDesk does not charge per use. Records install, plan change, cancellation, and the
 * invoice-paid webhooks GHL sends for the monthly fee.
 */
const subscriptionTransactionSchema = new mongoose.Schema(
  {
    locationId: { type: String, index: true },
    companyId: { type: String, index: true },
    appId: String,

    event: {
      type: String,
      enum: [
        'new_subscription',
        'reactivation',
        'renewal',
        'upgrade',
        'downgrade',
        'cancellation',
        'invoice_paid',
        'invoice_partially_paid'
      ],
      required: true,
      index: true
    },

    planId: String,
    planName: String,
    priceUsd: Number,
    previousPlanId: String,
    previousPlanName: String,
    previousPriceUsd: Number,

    // Invoice fields (for invoice_paid events).
    invoiceId: { type: String, index: true },
    invoiceNumber: String,
    amountPaid: Number,
    amountDue: Number,
    currency: { type: String, default: 'USD' },
    invoiceStatus: String,
    liveMode: { type: Boolean, default: true },
    invoiceDate: Date,
    payerEmail: String,
    payerName: String,

    periodStart: Date,
    periodEnd: Date,
    webhookType: String,
    rawData: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

module.exports = mongoose.model('SubscriptionTransaction', subscriptionTransactionSchema);

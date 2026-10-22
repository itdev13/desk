const mongoose = require('mongoose');

/**
 * App install/uninstall lifecycle record (one per installed location or company).
 */
const installationSchema = new mongoose.Schema(
  {
    appId: { type: String, index: true },
    companyId: { type: String, index: true },
    locationId: { type: String, index: true },
    userId: String,
    companyName: String,
    // White-label details from the INSTALL webhook. `domain` is the agency's custom app host
    // (e.g. app.myagency.com); used to build plan/upgrade redirect links on the agency's own domain.
    isWhitelabelCompany: { type: Boolean, default: false },
    whitelabelDetails: {
      domain: { type: String, default: null },
      logoUrl: { type: String, default: null }
    },
    planId: String,
    // The marketplace app version this install is currently on. Set from the INSTALL webhook and
    // bumped on every UPDATE webhook. On app-load the reconnect check compares this against the
    // VersionConfig table: if a forceReconnect version exists that this install is NOT on, we prompt a
    // reconnect. (The same value also lives in rawWebhookData.versionId; this top-level field is the
    // one we query.)
    versionId: { type: String, default: null, index: true },
    trial: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['active', 'uninstalled'], default: 'active', index: true },
    installedAt: Date,
    uninstalledAt: Date,
    // Why the app was uninstalled — GHL sends a reason (e.g. 'PAYMENT_FAILURE') on payment-driven
    // uninstalls vs a manual one. Useful for churn analysis and to distinguish "they quit" from
    // "their card failed".
    uninstallReason: { type: String, default: null },
    rawWebhookData: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

module.exports = mongoose.model('Installation', installationSchema);

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
    trial: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['active', 'uninstalled'], default: 'active', index: true },
    installedAt: Date,
    uninstalledAt: Date,
    rawWebhookData: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

module.exports = mongoose.model('Installation', installationSchema);

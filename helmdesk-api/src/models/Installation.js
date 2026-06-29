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

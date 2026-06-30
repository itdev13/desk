const mongoose = require('mongoose');

/**
 * A conversation provider known for a workspace, fetched from GHL's conversation-channels API
 * (SMS/Email) at install and on demand. Stored so we can show friendly provider names on the
 * dashboard/tickets and list them in Settings without re-hitting GHL on every view.
 *
 * NOTE: pure custom providers are NOT returned by GHL's public list endpoint, so this captures
 * native + type-bound (Twilio/Mailgun/etc.) providers only. Custom-provider ids seen on inbound
 * messages simply won't have a row here (we fall back to the raw id).
 */
const providerSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    providerId: { type: String, required: true }, // GHL conversationProvider _id
    name: { type: String, default: null },
    type: { type: String, default: null }, // provider type string from GHL
    channel: { type: String, enum: ['SMS', 'Email'], required: true }, // which channel list it came from
    isDefault: { type: Boolean, default: false },
    // Soft-delete: when a provider disappears on re-sync (removed in the CRM) we keep the row so
    // ticket history still resolves its name, and badge it "Deleted in CRM" in Settings.
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

providerSchema.index({ locationId: 1, providerId: 1, channel: 1 }, { unique: true });

module.exports = mongoose.model('Provider', providerSchema);

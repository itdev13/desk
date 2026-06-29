const mongoose = require('mongoose');

/**
 * OAuth token storage — supports both location-level and company-level (agency) installs.
 * Ported from the Vaultsuite marketplace apps; the token lifecycle in ghlService depends on it.
 */
const oauthTokenSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: false, index: true },
    companyId: { type: String, required: true, index: true },
    tokenType: { type: String, enum: ['location', 'company'], required: true, default: 'location' },

    locationName: { type: String, default: null },
    locationEmail: { type: String, default: null },
    locationPhone: { type: String, default: null },
    locationTimezone: { type: String, default: null },

    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },

    installerUserId: { type: String, default: null },
    installerEmail: { type: String, default: null },
    installerName: { type: String, default: null }
  },
  { timestamps: true }
);

// Refresh when within 5 minutes of expiry.
oauthTokenSchema.methods.needsRefresh = function needsRefresh() {
  return new Date(Date.now() + 5 * 60 * 1000) >= this.expiresAt;
};

oauthTokenSchema.statics.findActiveToken = function findActiveToken(locationId) {
  return this.findOne({ locationId, isActive: true });
};

oauthTokenSchema.statics.findActiveCompanyToken = function findActiveCompanyToken(companyId) {
  return this.findOne({ companyId, tokenType: 'company', isActive: true });
};

module.exports = mongoose.model('OAuthToken', oauthTokenSchema);

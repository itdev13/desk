const mongoose = require('mongoose');

/**
 * Per-app-version config. One doc per marketplace versionId.
 *
 * `forceReconnect` is the one that matters here: GHL's UPDATE webhook does NOT add new OAuth scopes to
 * an existing token — the user must re-authorize. So when a version ADDS a scope (e.g. contacts), we
 * mark that versionId forceReconnect:true. On UPDATE, if the NEW version is flagged, we set the
 * workspace's needsReconnect so the app shows a "Reconnect" banner. Versions that don't add scopes
 * (bug fixes, UI tweaks) are left unflagged, so most updates don't nag anyone.
 *
 * You seed these rows yourself (one per version that needs a reconnect) — e.g. via a small admin
 * endpoint or directly in Mongo. A version with no row here defaults to NOT requiring a reconnect.
 */
const versionConfigSchema = new mongoose.Schema(
  {
    versionId: { type: String, required: true, unique: true, index: true },
    forceReconnect: { type: Boolean, default: false },
    // Optional: a note for the banner / your own reference (e.g. "adds contacts scope").
    reason: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('VersionConfig', versionConfigSchema);

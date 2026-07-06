const mongoose = require('mongoose');

/**
 * Simple key → string[] config store, editable in the DB without a redeploy. Each document is one
 * config key, e.g.:
 *   { key: "internalTestingCompanyIds", values: ["PG9VJ27Q...", "7IlT9P1b..."], description: "..." }
 *
 * Note: there is no in-memory cache — every read goes straight to MongoDB. This gives instant
 * propagation when a value is changed (no lag) at the cost of one query per read. These reads are
 * infrequent (a handful per charge), so the extra query is negligible.
 */
const appConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    values: { type: [String], default: [] },
    description: { type: String, default: '' }
  },
  { timestamps: true }
);

/** Return the string[] for a key, or `fallback` if the key doesn't exist. */
appConfigSchema.statics.getValues = async function getValues(key, fallback = []) {
  const doc = await this.findOne({ key }).lean();
  return doc?.values || fallback;
};

/** True if `value` is present in the key's array. */
appConfigSchema.statics.hasValue = async function hasValue(key, value) {
  if (!value) return false;
  const values = await this.getValues(key);
  return values.includes(value);
};

module.exports = mongoose.model('AppConfig', appConfigSchema);

const mongoose = require('mongoose');

/**
 * Persistent trial ledger — one row per location that has EVER been granted a free trial.
 *
 * We grant our own 3-day trial on a location's first-ever install (GHL's trial field is unreliable),
 * and record it here. On any later install we check this ledger: if a row exists, the trial was already
 * used → no second trial (go straight to active/paid). Keyed on locationId.
 *
 * CRITICAL: this collection must NEVER be deleted on uninstall — it's the long-term memory that stops
 * trial abuse (install → trial → uninstall → reinstall → trial again). The uninstall-cleanup job
 * purges tenant data but explicitly skips this model.
 */
const trialLedgerSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, unique: true, index: true },
    companyId: { type: String, default: null },
    firstTrialGrantedAt: { type: Date, default: Date.now },
    trialDurationDays: { type: Number, default: 3 },
    planIdAtTrial: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('TrialLedger', trialLedgerSchema);

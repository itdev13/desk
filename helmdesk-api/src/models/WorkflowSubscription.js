const mongoose = require('mongoose');

/**
 * A GoHighLevel workflow's subscription to one of HelmDesk's custom triggers.
 *
 * GHL calls POST /api/workflows/triggers/subscriptions when an agency adds a HelmDesk trigger to a
 * workflow (and again to update/delete it). We store the per-subscription `targetUrl` GHL hands us,
 * then POST the event payload there whenever that trigger fires (see ticketService.fireTrigger).
 *
 * Pattern ported from the telegram app's workflow module (proven against GHL's custom-trigger flow).
 */
const workflowSubscriptionSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true },
    companyId: { type: String, default: null },
    workflowId: { type: String, required: true },
    triggerKey: { type: String, required: true },
    targetUrl: { type: String, required: true }, // where fires are POSTed
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    extras: { type: mongoose.Schema.Types.Mixed, default: {} }, // { locationId, workflowId, companyId }
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }, // GHL meta incl. meta.key
    status: { type: String, enum: ['active', 'deleted'], default: 'active' }
  },
  { timestamps: true }
);

// Fast lookup when firing: all active subs for a location+trigger.
workflowSubscriptionSchema.index({ locationId: 1, triggerKey: 1, status: 1 });
// One subscription per (workflow, trigger) — also the upsert key.
workflowSubscriptionSchema.index({ workflowId: 1, triggerKey: 1 }, { unique: true });

module.exports = mongoose.model('WorkflowSubscription', workflowSubscriptionSchema);

const mongoose = require('mongoose');

/**
 * One workspace per installed GHL sub-account. Holds the agency's HelmDesk configuration —
 * everything the setup wizard collects. Settings-first: the app does not create tickets until
 * `setupComplete` is true, so the agency's channel/ignore/SLA choices are always in effect.
 */

// A single SLA target pair (in minutes) per priority level.
const slaTargetSchema = new mongoose.Schema(
  {
    priority: { type: String, enum: ['urgent', 'high', 'normal', 'low'], required: true },
    firstResponseMins: { type: Number, default: 240 }, // time to first agent reply
    resolveMins: { type: Number, default: 1440 } // time to resolution
  },
  { _id: false }
);

// A single auto-triage rule. Kept intentionally simple (not a full rules engine) —
// match on channel or a keyword in the body, then apply a priority and/or assignee.
const ruleSchema = new mongoose.Schema(
  {
    name: { type: String, default: 'Rule' },
    enabled: { type: Boolean, default: true },
    // condition
    matchChannel: { type: String, default: null }, // e.g. 'Email' — null = any
    matchKeyword: { type: String, default: null }, // case-insensitive substring of body
    // action
    setPriority: { type: String, enum: ['urgent', 'high', 'normal', 'low', null], default: null },
    assignAgentId: { type: String, default: null }
  },
  { _id: false }
);

const workspaceSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, unique: true, index: true },
    companyId: { type: String, index: true },
    locationName: { type: String, default: null },

    // ── Setup wizard state ──
    setupComplete: { type: Boolean, default: false },

    // Step 1 — which channels create tickets. Empty = none (safe default until configured).
    // Valid values mirror GHL messageType: SMS, Email, WhatsApp, FB, IG, Live_Chat, Call, GMB.
    supportChannels: { type: [String], default: [] },

    // Step 2 — ignore rules.
    ignoreAutomatedReplies: { type: Boolean, default: true }, // skip replies to workflow/campaign sends
    ignoreShortMessages: { type: Boolean, default: false }, // skip one-word acks ("ok", "thanks")

    // Step 3 — assignment.
    assignmentMode: { type: String, enum: ['round_robin', 'specific', 'unassigned'], default: 'round_robin' },
    defaultAssigneeId: { type: String, default: null }, // used when assignmentMode = 'specific'
    roundRobinCursor: { type: Number, default: 0 }, // internal pointer for round-robin

    // Step 4 — SLA + lifecycle.
    slaTargets: {
      type: [slaTargetSchema],
      default: () => [
        { priority: 'urgent', firstResponseMins: 60, resolveMins: 240 },
        { priority: 'high', firstResponseMins: 240, resolveMins: 480 },
        { priority: 'normal', firstResponseMins: 480, resolveMins: 1440 },
        { priority: 'low', firstResponseMins: 1440, resolveMins: 4320 }
      ]
    },
    autoCloseResolvedDays: { type: Number, default: 7 }, // 0 = never auto-close
    autoReplyEnabled: { type: Boolean, default: true },
    autoReplyMessage: {
      type: String,
      default: "Thanks for reaching out — we've received your message and a team member will get back to you shortly."
    },
    ticketNumberPrefix: { type: String, default: 'HD-' },

    // ── Auto-triage rules (Phase 2) ──
    rules: { type: [ruleSchema], default: [] },

    // ── White-label (Phase 3) ──
    brand: {
      name: { type: String, default: 'HelmDesk' },
      primaryColor: { type: String, default: '#E0A24A' },
      logoUrl: { type: String, default: null }
    },

    // Public portal intake.
    portalEnabled: { type: Boolean, default: false },
    portalSlug: { type: String, default: null, index: true } // unique-ish public id for the intake form
  },
  { timestamps: true }
);

/** Look up the configured SLA target for a priority (falls back to 'normal'). */
workspaceSchema.methods.slaFor = function slaFor(priority) {
  const found = this.slaTargets.find((t) => t.priority === priority);
  return found || this.slaTargets.find((t) => t.priority === 'normal') || { firstResponseMins: 480, resolveMins: 1440 };
};

module.exports = mongoose.model('Workspace', workspaceSchema);

const mongoose = require('mongoose');

/**
 * Product-analytics / clickstream events. One document per user action, written asynchronously
 * from the UI (batched + sendBeacon) so it never blocks the app. Tenant-scoped: locationId always
 * comes from the trusted session token, never the client body.
 *
 * Intentionally schema-light — `name` identifies the event and `props` holds arbitrary event
 * details — so new events can be added from the UI without a migration. Capped/TTL'd via the
 * `createdAt` index below if you want to auto-expire old rows (uncomment the expireAfterSeconds).
 */
const analyticsEventSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    companyId: { type: String, index: true, default: null },
    userId: { type: String, index: true, default: null },
    role: { type: String, default: null }, // admin | agent — from the session token

    name: { type: String, required: true, index: true }, // e.g. 'page_view', 'ticket_open', 'reply_sent'
    props: { type: mongoose.Schema.Types.Mixed, default: {} }, // arbitrary event details

    // Client-supplied context (best-effort; not trusted for tenancy).
    path: { type: String, default: null }, // UI route/view at the time
    sessionId: { type: String, default: null }, // per-tab client session, groups a visit
    ts: { type: Date, default: null }, // client timestamp (when the action happened)

    // Server context.
    ua: { type: String, default: null } // user-agent, for device/browser breakdowns
  },
  { timestamps: true } // createdAt = server receive time
);

// Query pattern: "events for a location over time", "funnel by event name".
analyticsEventSchema.index({ locationId: 1, createdAt: -1 });
analyticsEventSchema.index({ locationId: 1, name: 1, createdAt: -1 });
// To auto-expire after e.g. 180 days, add: analyticsEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);

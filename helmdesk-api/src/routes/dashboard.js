const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const Ticket = require('../models/Ticket');
const TicketEvent = require('../models/TicketEvent');
const logger = require('../utils/logger');

router.use(requireAuth);

/**
 * GET /api/dashboard
 * Summary-before-detail metrics for the queue header and dashboard page. All computed via Mongo
 * aggregation over the tenant's tickets — no per-use cost, fast with the tenant-first indexes.
 */
router.get('/', async (req, res) => {
  try {
    const { locationId } = req.auth;
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const OPEN = Ticket.OPEN_STATUSES;

    const [byStatus, openTotal, overdue, unassigned, mine, byAgent, slaAgg, resolveAgg] = await Promise.all([
      // Counts by status.
      Ticket.aggregate([{ $match: { locationId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Ticket.countDocuments({ locationId, status: { $in: OPEN } }),
      Ticket.countDocuments({ locationId, status: { $in: OPEN }, breached: true }),
      Ticket.countDocuments({ locationId, status: { $in: OPEN }, assigneeId: null }),
      Ticket.countDocuments({ locationId, status: { $in: OPEN }, assigneeId: req.auth.userId }),
      // Per-agent open load.
      Ticket.aggregate([
        { $match: { locationId, status: { $in: OPEN } } },
        { $group: { _id: { id: '$assigneeId', name: '$assigneeName' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } }
      ]),
      // SLA adherence over the last 30 days of resolved tickets.
      Ticket.aggregate([
        { $match: { locationId, resolvedAt: { $gte: since30 } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            inSla: { $sum: { $cond: [{ $eq: ['$breached', false] }, 1, 0] } }
          }
        }
      ]),
      // Average first-response time (minutes) over the last 30 days.
      Ticket.aggregate([
        { $match: { locationId, firstResponseAt: { $ne: null }, createdAt: { $gte: since30 } } },
        { $project: { mins: { $divide: [{ $subtract: ['$firstResponseAt', '$createdAt'] }, 60000] } } },
        { $group: { _id: null, avgMins: { $avg: '$mins' }, n: { $sum: 1 } } }
      ])
    ]);

    const statusCounts = byStatus.reduce((acc, r) => ({ ...acc, [r._id]: r.n }), {});
    const sla = slaAgg[0] || { total: 0, inSla: 0 };
    const slaPct = sla.total ? Math.round((sla.inSla / sla.total) * 100) : null;
    const avgFirstReplyMins = resolveAgg[0]?.avgMins != null ? Math.round(resolveAgg[0].avgMins) : null;

    res.json({
      success: true,
      kpis: {
        open: openTotal,
        overdue,
        unassigned,
        mine,
        inSlaPct: slaPct,
        avgFirstReplyMins,
        resolved30d: sla.total
      },
      statusCounts,
      byAgent: byAgent.map((a) => ({ agentId: a._id.id, name: a._id.name || 'Unassigned', open: a.n }))
    });
  } catch (error) {
    logger.error('dashboard failed', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dashboard/trend?days=14
 * Daily created vs resolved counts for the trend chart.
 */
router.get('/trend', async (req, res) => {
  try {
    const { locationId } = req.auth;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [created, resolved] = await Promise.all([
      Ticket.aggregate([
        { $match: { locationId, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } }
      ]),
      Ticket.aggregate([
        { $match: { locationId, resolvedAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$resolvedAt' } }, n: { $sum: 1 } } }
      ])
    ]);

    const map = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      map[d] = { date: d, created: 0, resolved: 0 };
    }
    created.forEach((c) => { if (map[c._id]) map[c._id].created = c.n; });
    resolved.forEach((r) => { if (map[r._id]) map[r._id].resolved = r.n; });

    res.json({ success: true, trend: Object.values(map) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

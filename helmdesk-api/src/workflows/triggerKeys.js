/**
 * HelmDesk custom workflow TRIGGER keys — the single source of truth.
 *
 * IMPORTANT: these wire strings MUST exactly match the Custom Triggers registered in the GoHighLevel
 * Marketplace app dashboard. There is no runtime registration API — the dashboard config and this
 * file have to agree. The fields each trigger exposes to a workflow (referenced as {{trigger.<field>}})
 * are the keys of the payload built in ticketService.fireTrigger / its callers, and must likewise be
 * declared on the matching trigger in the dashboard.
 *
 * We ship a focused 5 (not every event) so the agency's workflow builder stays uncluttered:
 */
const TRIGGERS = {
  TICKET_CREATED: 'helmdesk_ticket_created',       // a new ticket was opened
  SLA_BREACHED: 'helmdesk_sla_breached',           // a ticket missed its first-response/resolve target
  STATUS_CHANGED: 'helmdesk_ticket_status_changed',// a ticket's status changed (carries newStatus)
  TICKET_ASSIGNED: 'helmdesk_ticket_assigned',     // a ticket was assigned/reassigned to an agent
  CUSTOMER_REPLIED: 'helmdesk_customer_replied',   // the customer replied on an existing ticket
  // Fires ONLY when a public portal form is submitted. Carries `formName` (so a workflow can filter by
  // which form) plus the custom answers, on top of the standard ticket fields. Declare these fields on
  // the matching trigger in the GHL marketplace dashboard so they're filterable in the builder.
  PORTAL_SUBMITTED: 'helmdesk_portal_submitted'
};

module.exports = { TRIGGERS };

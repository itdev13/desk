# HelmDesk workflow triggers — dashboard registration reference

HelmDesk fires **custom workflow triggers** into GoHighLevel so agencies can automate on ticket
events. There is **no runtime registration API** — each trigger (and the fields a workflow can filter
on) must be declared **by hand in the GHL Marketplace app dashboard**, and the key + fields there must
exactly match what the code sends.

- Trigger keys live in `src/workflows/triggerKeys.js` (single source of truth).
- The payload is built by `buildTriggerPayload()` in `src/services/ticketService.js` — every trigger
  sends the **base fields** below, plus a few trigger-specific extras.
- In a workflow, fields are referenced as `{{trigger.<field>}}` and can be used as **filters**.

Register each trigger in **Marketplace app → your app → Custom Triggers**, using the exact **Key**.
Add each listed field (name + type) so it's filterable in the workflow builder.

---

## Base fields — present on EVERY trigger

| Field | Type | Notes |
|---|---|---|
| `locationId` | string | The sub-account. |
| `ticketRef` | string | Human ref, e.g. `LTR \| 21`. |
| `ticketId` | string | Internal id. |
| `subject` | string | Ticket subject. |
| `status` | string | `new` / `open` / `on_hold` / `resolved` / `closed`. |
| `priority` | string | `urgent` / `high` / `normal` / `low`. **Good filter.** |
| `channel` | string | `SMS` / `Email` / `portal` / `Custom` / … **Good filter.** |
| `contactId` | string | GHL contact id (use to act on the contact). |
| `contactName` | string | |
| `contactEmail` | string | |
| `assigneeId` | string | GHL user id, or empty if unassigned. **Good filter.** |
| `assigneeName` | string | |
| `source` | string | `inbound` / `portal` / `manual`. **Good filter.** |
| `formName` | string | Portal form name (only when `source = portal`). **Good filter.** |
| `customFields` | array | `[{ label, value }]` — custom portal answers. |
| `customFieldMap` | object | `{ "<question>": "<answer>" }` — dynamic keys (see note). |
| `createdAt` | date | Ticket creation time. |

> **Note on `customFieldMap`:** its keys are the agency's own question labels, so GHL **cannot**
> pre-declare them as filter fields. For a known screening question (e.g. "Do contact details
> match?"), filter on `formName` + use a **Condition** step inside the workflow to branch on the
> answer, or read `customFields` in a custom/webhook action. Declare `formName` as the filterable
> field; treat the answers as data the workflow reads, not a pre-declared filter.

---

## The triggers

### 1. Ticket Created
- **Key:** `helmdesk_ticket_created`
- **Fires:** a new ticket is opened (any source — inbound, portal, manual).
- **Fields:** base only.
- **Typical filters:** `priority`, `channel`, `source`, `formName`.

### 2. Portal Form Submitted
- **Key:** `helmdesk_portal_submitted`
- **Fires:** a public portal form is submitted (fires in addition to Ticket Created, but **only** for
  portal tickets).
- **Fields:** base only — but `source` is always `portal` and `formName` is always set.
- **Typical filters:** `formName` (act only on a specific form), then branch on `customFields`.

### 3. SLA Breached
- **Key:** `helmdesk_sla_breached`
- **Fires:** a ticket misses its first-response or resolution target.
- **Extra field:**
  | Field | Type | Notes |
  |---|---|---|
  | `breachType` | string | `first_response` or `resolution`. |
- **Typical filters:** `priority`, `breachType`, `assigneeId`.

### 4. Ticket Status Changed
- **Key:** `helmdesk_ticket_status_changed`
- **Fires:** a ticket's status changes.
- **Extra fields:**
  | Field | Type | Notes |
  |---|---|---|
  | `previousStatus` | string | Status before the change. |
  | `newStatus` | string | Status after the change. **Good filter** (e.g. only when `resolved`). |
- **Typical filters:** `newStatus`, `priority`.

### 5. Ticket Assigned
- **Key:** `helmdesk_ticket_assigned`
- **Fires:** a ticket is assigned or reassigned to an agent (also fires on auto-assign at creation).
- **Fields:** base only — `assigneeId` / `assigneeName` reflect the new assignee.
- **Typical filters:** `assigneeId` (notify a specific agent), `priority`.

### 6. Customer Replied
- **Key:** `helmdesk_customer_replied`
- **Fires:** the customer replies on an existing ticket.
- **Fields:** base only.
- **Typical filters:** `priority`, `channel`, `assigneeId`.

---

## Checklist when adding a NEW scope-adding release or trigger

1. Add the key to `src/workflows/triggerKeys.js`.
2. Fire it via `safeFire(TRIGGERS.<NAME>, ticket, extra)` (payload auto-includes the base fields).
3. In the GHL dashboard, create the Custom Trigger with the **exact key** and declare its fields
   (base + any extras) so they're filterable.
4. Keep this doc in sync.

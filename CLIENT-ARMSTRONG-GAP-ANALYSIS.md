# HelmDesk — Armstrong (Ace Integrated / IHR Security) Evaluation: Gap Analysis & Build Plan

**Prospect:** John Armstrong · Ace Integrated Technologies / IHR Security
**Architecture they want:** GoHighLevel (CRM) → HelmDesk (ticketing only) → ProjX360 (field/project)
**Goal:** map every question to what HelmDesk does TODAY, then decide what to build.

**Legend:** ✅ Supported today · 🟡 Partial / workaround · 🔴 Not supported (build needed) · ⚙️ Custom integration (their side)

---

## 1. Marketplace status & vendor identity

| Question | Status | Notes / Action |
|---|---|---|
| Officially supported Marketplace app? | ✅ | Yes — installed via the Marketplace, OAuth app. |
| Who is the vendor/developer? | ✅ (answer in email) | Us. Need to state the legal/brand vendor name + support entity. |
| Official website / support / docs? | 🟡 | Site: helmdesk-site (Vercel). Support email: binduchowdary856@gmail.com + calendar. **No docs portal yet.** |
| Is helmdesk.dev us? | ✅ (answer) | **NO — helmdesk.dev is an unrelated product.** State this clearly. |

**ACTION:** (a) Decide the public vendor name. (b) Stand up a lightweight **docs page** (even one page on the marketing site). (c) Give a branded support email instead of a personal gmail.

---

## 2. Contact & Company integration

| Question | Status | Reality in code |
|---|---|---|
| Uses GHL contact record or separate DB? | 🟡 | HelmDesk stores tickets in its own Mongo, but **links to the GHL contact** (contactId). Contact of record stays GHL. |
| Retain GHL Contact ID + Company ID? | 🟡 | **Contact ID: yes** (ticket.contactId). **Company ID: not captured today.** |
| Contact info changes in GHL auto-update in HelmDesk? | 🟡 | We cache contactName/email at ticket creation; we do NOT subscribe to ContactUpdate to refresh. (We DO handle User* events for agents.) |
| One company → multiple service locations on tickets? | 🔴 | No location/site concept on tickets. |
| Tickets linked to GHL Companies / Custom Objects (sites)? | 🔴 | No company link, no custom-object association. |

**ACTION (build):**
- **B1** Capture & store `companyId` on the ticket (small).
- **B2** Handle `ContactUpdate` webhook → refresh cached contact name/email on open tickets (small).
- **B3** Add a `serviceLocation` field on tickets (free-text first; later map to a GHL Custom Object). (medium)
- **B4 (bigger)** Associate tickets with GHL **Companies** and/or **Custom Objects** — requires the Objects API + UI. (large)

---

## 3. Automatic ticket creation — by source

| Source | Status | How |
|---|---|---|
| Inbound email to a service address | ✅ | If the email channel routes into GHL conversations → InboundMessage webhook → ticket. |
| GHL website form submission | 🟡 | Not directly. A **workflow** (form → webhook to HelmDesk) or the HelmDesk **client portal form** does it. |
| GHL workflow | 🟡 | Via a workflow **Webhook action** calling HelmDesk — **no native "Create Ticket" workflow action yet.** |
| SMS conversation | ✅ | InboundMessage (SMS) → ticket, if SMS channel enabled. |
| Manual from an existing GHL conversation | 🔴 | No "create ticket from this conversation" button inside GHL conversations. (They can create manually in HelmDesk.) |
| Internal intake email by an employee | 🟡 | Works if that email lands in GHL conversations for the location; triage via keywords. Cross-contact intake is messy. |
| API / webhook call | 🟡 | HelmDesk can RECEIVE a webhook (we process InboundMessage). **No documented public "create ticket" API endpoint** for them to call directly. |

**ACTION (build):**
- **B5** A documented **public "Create Ticket" API** (API-key or workflow-webhook target) — unblocks form, workflow, internal-intake, and API sources cleanly. (medium — highest leverage)
- **B6 (native)** A GHL **custom workflow action "Create HelmDesk Ticket"** so no-code workflows can create tickets. (medium-large; requires the Marketplace custom-action framework)

---

## 4. Customer acknowledgment

| Question | Status | Notes |
|---|---|---|
| Auto-acknowledge the customer on ticket create? | ✅ | Auto-reply feature sends on the ticket's channel. |
| Include the ticket number (HD-##)? | 🟡 | Auto-reply message is static today — **doesn't interpolate the ref.** Easy to add `{{ref}}`. |
| Future status changes trigger emails/SMS? | 🔴 | No status-change notifications to the customer (SLA breach is in-app only; no outbound). |
| Customer reply stays attached to the ticket? | ✅ | Yes — within the reopen window; replies on the same conversation append to the ticket. |

**ACTION (build):**
- **B7** Template variables in auto-reply (`{{ref}}`, `{{contactName}}`) (small).
- **B8** Optional **status-change notification** to the customer (configurable per status) (medium).

---

## 5. GHL Workflow integration (triggers & actions) — THE BIG ONE

| Capability | Status |
|---|---|
| HelmDesk ticket events as **workflow TRIGGERS** (created/assigned/status/overdue/closed/opportunity) | 🔴 **Not supported.** No custom workflow triggers published. |
| Workflow **ACTIONS** that update HelmDesk (assign/priority/add info/close/add reference) | 🔴 **Not supported.** No custom workflow actions published. |

This is the heart of John's automation vision and it's the **biggest gap.** GHL marketplace apps CAN publish custom **workflow triggers** and **actions**, but HelmDesk has none yet.

**ACTION (build — major):**
- **B9** Publish **custom workflow TRIGGERS**: Ticket Created, Assigned, Status Changed, Overdue, Closed. (large)
- **B10** Publish **custom workflow ACTIONS**: Create Ticket, Assign, Set Priority, Add Note, Change Status/Close. (large)
- These require the GHL custom triggers/actions framework (provider endpoints GHL calls) — a real project, but it's what makes HelmDesk a first-class automation citizen.

---

## 6. Sales opportunity creation (technician upsell → GHL Opportunity)

| Question | Status |
|---|---|
| HelmDesk creates a GHL **Opportunity** preserving ticket #, customer, location, technician, source, date? | 🔴 **Not supported.** No Opportunities integration at all. |
| Track technician-generated opportunities for reporting / finder's fee | 🔴 Needs the above + fields. |

**ACTION (build — major):**
- **B11** "Flag as sales opportunity" on a ticket → creates a **GHL Opportunity** via the Opportunities API, stamping custom fields: originating ticket ref, service location, technician (assignee), source = "HelmDesk service call", date identified. (large; needs Opportunities + Custom Fields API)
- Pairs naturally with the "Upgrade opportunity identified" **workflow trigger** (B9) so they can run finder's-fee automations.

---

## 7. Internal intake workflow (shared intake email → triage → ticket and/or opportunity)

| Status | Notes |
|---|---|
| 🟡→🔴 | Feasible **only** once B5 (create-ticket API) + B11 (opportunity creation) exist. Today: partial via keywords if the intake email is a GHL conversation. The "create ticket OR opportunity OR both, from a triaged internal email" flow needs the building blocks above + a GHL workflow they build. |

**ACTION:** Depends on B5, B9/B10, B11. Then it's a workflow THEY assemble in GHL. Document a reference recipe.

---

## 8. ProjX360 handoff (data out to middleware, status back in)

| Question | Status |
|---|---|
| Access ticket data via workflow/API/webhook to pass to ProjX360? | 🟡 | Needs **B5 public read API + B9 triggers/webhooks**. Today there's no outbound webhook or public API for them to consume. |
| Pass customer, company, location, ticket #, description, priority, **attachments**, assignee, notes? | 🟡/🔴 | Most fields exist; **attachments do NOT** (no file support); company/location need B1/B3. |
| ProjX360 status → update HelmDesk ticket + trigger GHL comms? | 🔴 | Needs **B5 write API** (update ticket) + **B8/B9** for the comms. |
| Anything architecturally blocking it? | ✅ No blocker | It's all additive API work — nothing prevents it. |

**ACTION:** B5 (read+write API) + **B12 outbound webhooks** (HelmDesk → their middleware on ticket events) + **B13 attachments**. Then ProjX360 round-trip is achievable (their integration/middleware).

---

## 9. Data ownership & export

| Question | Status |
|---|---|
| Data belongs to / accessible to the subaccount? | ✅ | Tenant-scoped by locationId; it's their data. |
| Ticket data exportable? | 🔴 | **No export feature** (no CSV/JSON export UI or endpoint). |
| API access to tickets, notes, attachments, status history, assignments, custom fields? | 🟡 | Internal session API exists for tickets/notes/status/assignee; **no public API, no attachments, limited status-history, no custom fields.** |
| Programmatic recurring backup? | 🔴 | Not without a public API (B5). |
| On uninstall, what happens to data? | 🟡 (answer carefully) | **We purge tenant data after a 7-day grace window** (configurable). They'd lose it unless exported. |
| Can they get a full export before removing? | 🔴 | No self-serve export today. |

**ACTION (build):**
- **B14** **Export** (CSV + JSON) of tickets + comments + events — UI button and/or API. (medium) — **important for their "company-controlled archive" requirement.**
- **B15** Make the uninstall grace window + export policy clear in docs; consider lengthening default grace or offering an export-on-uninstall.

---

## 10. Ticketing scope (simple lifecycle, no CRM/PM bloat)

| Question | Status |
|---|---|
| Configurable simple lifecycle **New → Triage → Assigned → Working → Waiting → Completed → Closed**? | 🟡 | Our statuses today: New, Open, Pending, On hold, Resolved, Closed. **Not their exact labels, and not customizable.** |
| Keep it ticketing-only, no forced CRM/PM? | ✅ | Yes — HelmDesk is ticketing-only by design; this is a strength to emphasize. |

**ACTION (build):**
- **B16** **Custom ticket statuses / pipeline** per workspace (label + order), so they can configure their 7-stage flow. (medium) — good selling point.

---

## 11. Mobile & field use

| Question | Status |
|---|---|
| Technicians access from mobile? | 🟡 | HelmDesk is an embedded web app; responsive-ish but **no dedicated mobile app**, and whether it shows in the GHL **mobile app** depends on custom-page support there. |
| Update status, add notes, upload photos, flag upgrade from the field? | 🟡/🔴 | Status/notes: yes (web). **Photo upload: NO** (no attachments). Flag upgrade: needs B11. |
| Inside GHL mobile app or separate? | 🟡 | Likely separate web view; GHL mobile custom-page embedding is limited. |

**ACTION:** Mobile polish + **B13 attachments (photo upload)** are the key field-use gaps. Set expectations honestly (web, responsive; no native app).

---

## 12. Support responsibility

| Question | Answer (for email) |
|---|---|
| What GHL supports | Platform, their CRM, conversations, workflows engine. |
| What HelmDesk vendor supports | The HelmDesk app itself — tickets, SLAs, portal, settings. |
| Who supports GHL↔HelmDesk integration issues | **Us** (the vendor) for anything HelmDesk-side; shared for workflow glue. |
| Recommended technical contact for advanced impl | Offer a named contact + the calendar link for an implementation call. |

---

## Prioritized build backlog (what unlocks this deal)

**Tier 1 — unlocks the core of their ask (do first):**
- **B5** Public Create/Read/Update **Ticket API** (API-key auth) ← unblocks sources, ProjX360, intake, backup.
- **B14** **Export** (CSV/JSON) ← their data-archive requirement.
- **B1** Capture **companyId**; **B3** add **serviceLocation** field ← multi-location tickets.
- **B7** Auto-reply **template vars (ref)** ← acknowledgment with ticket number.
- **B16** **Custom statuses** (their 7-stage lifecycle).

**Tier 2 — the automation story:**
- **B9/B10** Custom workflow **triggers + actions** (the big GHL-native piece).
- **B12** Outbound **webhooks** on ticket events (ProjX360 handoff).
- **B11** **Opportunity creation** from a ticket (technician upsell).
- **B8** Status-change customer notifications.

**Tier 3 — field & polish:**
- **B13** **Attachments / photo upload**.
- **B2** ContactUpdate sync.
- **B4** Company / Custom Object association (deep).
- Docs portal, branded support email, mobile polish.

---

## Honesty guardrails for the written reply
- Do **NOT** claim native workflow triggers/actions, Opportunity creation, attachments, export, custom statuses, or a public API **as existing** — they don't exist yet.
- Frame honestly as: **available today** / **on our near-term roadmap (weeks)** / **custom integration we can scope with you**.
- Their architecture is sound and **nothing is architecturally blocked** — it's additive API work. That's a genuine, confidence-building message.
- Correct the **helmdesk.dev** confusion.

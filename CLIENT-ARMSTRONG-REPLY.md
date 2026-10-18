# Reply to John Armstrong — Ace Integrated Technologies / IHR Security

**To:** John Armstrong
**From:** HelmDesk Team (binduchowdary856@gmail.com)
**Re:** HelmDesk evaluation — your integration questions

---

Hi John,

Thank you for the detailed and well-thought-out evaluation — your architecture (CRM → HelmDesk for ticketing → ProjX360 for field/project) is sound, and I want to give you straight answers to every question rather than marketing copy. Where something works today, I've said so plainly; where it's a build, I've said that too, along with how we'll approach it. The short version up front: **nothing in your plan is architecturally blocked — it's all achievable, and we want to build it with you.**

Here's the point-by-point.

---

## 1. Marketplace status & vendor identity

HelmDesk is a native application installed through the Marketplace via OAuth — not a third-party script or workaround. The vendor is **HelmDesk**, and that's who supports the app directly.

For anything you may see online under similar names (e.g. "helmdesk.dev"), that isn't our channel — the reliable way to reach us is **binduchowdary856@gmail.com**, plus the onboarding/implementation call link at the end of this message. We maintain a help/getting-started guide covering setup and every feature; a dedicated developer/API docs portal is on our near-term roadmap as the API surface grows (more on that below).

## 2. Does HelmDesk use the CRM contact, or a separate database?

Both, by design — and the distinction matters. The **customer record of record stays in your CRM.** HelmDesk does *not* maintain a parallel customer database and is not a second CRM. What HelmDesk stores is its own **ticket** data — tickets, conversations, notes, statuses, SLAs — with each ticket **linked back to the CRM contact by Contact ID**, plus a lightweight cached name/email for display. So: your CRM owns the customer; HelmDesk owns the ticket and points at the customer. One customer can have many tickets, all tied to the same contact.

## 3. Retaining Contact ID and Company ID

Every ticket is tied to the **sub-account it's installed on** (its location), so tickets always belong to the right business, and each ticket retains the **CRM Contact ID** linking it to the customer. If by "Company ID" you mean a CRM **Company** record a contact belongs to, capturing that association onto the ticket is a natural addition — see the next point.

## 4. Does customer info auto-update in HelmDesk when it changes in the CRM?

Two parts here, worth separating:

- **Your team members (agents):** Yes — this syncs automatically today. When a user is added, updated, or removed in your CRM, HelmDesk's agent list reflects it, so assignments and seats stay correct.
- **Customer contact details:** Not automatically today. We capture the customer's name and email at ticket creation for display, but don't yet re-sync if those details change in the CRM afterward. The ticket always stays linked by **Contact ID**, so the connection is never lost — it's only the cached display copy that doesn't refresh.

This is on our near-term roadmap and is a natural one for us, since we already process the equivalent live events for users. If keeping customer details in lock-step matters to your workflow, tell us how you'd want it to behave and we'll shape it to your needs.

## 5. One Company → multiple service locations on tickets

This gets at your core architecture, and it's **supportable.** In your CRM, **Companies** and **Custom Objects** (e.g. service locations / sites) live inside a location, and associating tickets to those is achievable — there's nothing architecturally in the way. It isn't wired up in the standard app today, but it's additive: a **Company link** plus a **service-location link** on each ticket. The model you're describing — one Company → many service locations, tickets tied to the right site — is exactly what we'd design around your object structure. Let's review how you've set up Companies and your location Custom Objects, and we'll map tickets to them.

## 6. Automatic ticket creation by source

HelmDesk automatically creates a ticket from any **inbound customer message on a connected channel** — and your team can **reply right back on that same channel from inside HelmDesk.** Supported channels today:

✅ **Email, SMS, Facebook, Instagram, WhatsApp, Live Chat, Web Chat, Google** — e.g. a customer messages your Facebook page, HelmDesk opens a ticket, and your agent replies on Facebook straight from the ticket.
✅ Plus our branded **client portal form** creates tickets directly.

For the remaining sources on your list — **website form, workflow, internal intake email, and direct API/webhook calls** — these all converge on one thing: a **documented public "Create Ticket" API.** That single endpoint lets your forms, workflows, internal-intake automations, and any external system create tickets cleanly. It's our **top near-term roadmap item** precisely because it unblocks this whole category (and the ProjX360 handoff later). A native "Create Ticket" workflow action is planned alongside it.

Net: **every connected conversation channel creates tickets and is fully two-way today**; form/workflow/API/intake unify under the public API we're prioritizing — and we'll scope those endpoints around your exact intake flows.

## 7. Customer acknowledgment & the reply loop

- **Auto-acknowledge on creation:** ✅ Yes, today — HelmDesk sends the customer a configurable confirmation on their channel the moment a ticket is created.
- **Include the ticket number:** ✅ **We'll wire this in for you** — adding the ticket reference (and customer name) into the acknowledgment is a small change we'll set up as part of your onboarding, so every customer gets their HD-#### up front.
- **Future status changes → emails/SMS to the customer:** Not automatic today; on our near-term roadmap. Since we already send on-channel messages for acknowledgments, extending to "notify when status becomes Working/Completed" is a natural add — we'll scope which statuses notify with you.
- **Replies staying attached to the ticket:** ✅ Yes, today — a customer's email/SMS reply stays attached to the correct ticket (reopening a recently-closed one within your configured window), and your agents reply from inside HelmDesk back onto the customer's channel. The whole thread lives on the ticket.

## 8. HelmDesk events as workflow triggers, and workflows updating HelmDesk

This is the heart of your automation vision, so let me be direct.

**Today:** HelmDesk doesn't yet publish native workflow **triggers** or **actions** in your workflow builder. That's the one meaningful build between where we are and your full vision — a "when," not an "if."

**What we'll build:**
- **Triggers** (HelmDesk → your workflows): Ticket Created, Assigned, Status Changed, Overdue, Closed, and **Upgrade Opportunity Identified** — so any ticket event can start an automation you design.
- **Actions** (your workflows → HelmDesk): Create Ticket, Assign, Set Priority, Add Information/Note, Change Status / Close, and Add an External Reference (e.g. a ProjX360 record ID) — so your workflows can drive HelmDesk back.

**Timeline, honestly:** the development itself is quick — we can have these built and working in a matter of days, and we'll start immediately for you. The one dependency outside our control is the **Marketplace review/approval** required before custom triggers and actions appear in your workflow builder — that step is gated by the platform, not us. So we're committing to building fast; we'll just set the go-live expectation around that review rather than promise a date we don't own.

## 9. Sales opportunity creation (technician upsell → CRM Opportunity)

This is a genuinely valuable use case, and **yes — we'll build it.** We'll deliver a "Flag as sales opportunity" action on a ticket that creates an **Opportunity in your CRM**, carrying the full context so nothing is lost:

- the **originating service ticket number** (e.g. HD-1042),
- the **customer** (linked by contact),
- the **service location** *(this comes online together with the service-location capability in point 5 — once a ticket carries its site, the opportunity carries it too),*
- the **originating technician** (the ticket's assignee),
- the **opportunity source** (e.g. "HelmDesk service call"), and
- the **date the opportunity was identified.**

These map onto the Opportunity's standard and custom fields, so your sales team sees the full picture and you can report on — and automate finder's-fees from — technician-generated opportunities. It pairs directly with the "Upgrade Opportunity Identified" trigger above. Creating opportunities is standard, approved API functionality (no special Marketplace gate), so it's straightforward for us to add; it does require one new permission, so you'll **re-authorize the app once** when we ship this update — after that it's live.

## 10. Internal intake workflow (shared email → triage → ticket and/or opportunity)

Yes — supported, and it doesn't need anything beyond the building blocks above. Your internal-intake flow is a **composition**:

1. The email lands in your CRM (your shared intake address routing into conversations).
2. A **workflow you build** triages it and decides: service issue, upgrade opportunity, or both.
3. That workflow calls HelmDesk's **actions** to **create a ticket**, **create an opportunity**, or **both.**

For your example — *"ABC customer says their cameras aren't working, possibly an upgrade"* — your triage workflow could open a service **ticket** (for the repair) **and** an **opportunity** (for the upgrade), both stamped with customer, source, and date, and linked so you can track the pair. We provide the actions and triggers (and a reference recipe); **you own the triage logic** in your workflow builder, which keeps it flexible to however your team words these emails.

## 11. ProjX360 handoff (data out to middleware, status back in)

You've framed this right — it's a **custom integration**, and the most important thing I can tell you is: **nothing in the architecture prevents it.** It's all additive API work.

**Data out (HelmDesk → ProjX360 / middleware):** the handoff payload carries —
- ✅ **customer, ticket number, issue description, priority, assigned employee, notes** — present on the ticket today.
- 🟡 **company and service location** — come online with the company/service-location work in point 5.
- 🔴 **attachments** — the one genuine gap: HelmDesk doesn't yet support file/photo attachments on tickets. We'll add attachment support, and once it's there, files pass through the handoff like any other field. (This is the same capability your field technicians want for photos — so it serves both needs.)

This rides on the **public ticket API** (read + write) and **outbound webhooks** (HelmDesk pushes ticket events to your endpoint) — both on our priority roadmap.

**Status back in (ProjX360 → HelmDesk):** the write side of that same API lets ProjX360 update a HelmDesk ticket's status, which can in turn **trigger customer communication through your workflows** (via the status-change notifications and triggers above). So the round-trip is fully achievable. **Nothing architecturally blocks the ProjX360 integration** — it needs the public read/write API, outbound webhooks, and attachment support, which we'll build and wire with you and your middleware.

## 12. Data ownership & export

Your requirement for a **company-controlled archive of service history** is important, so directly:

- **Does the data belong to and stay accessible to your sub-account?** ✅ Yes. All HelmDesk ticket data is scoped to your sub-account — it's your data, isolated to your account.
- **Can ticket data be exported?** Not through a self-serve export today — this is a **priority build**, and your archive requirement is exactly why. We'll add **export (CSV + JSON)** of tickets, notes, status history, assignments, and custom fields.
- **API access to tickets, notes, attachments, status history, assignments, custom fields?** The public read API that powers this is on our roadmap (the same API that unblocks the ProjX360 handoff). Attachments come online with the attachment feature above; status history and assignments are already tracked and will be exposed through that API.
- **Programmatic recurring backup?** Yes — once the public read API is in place, you can pull a scheduled backup to your own storage on whatever cadence you set, giving you a true company-controlled archive independent of HelmDesk.
- **If HelmDesk is removed, what happens to the data?** On uninstall we keep your data through a configurable grace window (**7 days by default**), then purge it — a privacy-friendly default. **This window is fully adjustable to your policy:** we can shorten it, extend it, or **retain your data indefinitely** for your account. For an archive-focused setup like yours, we'll set retention to match your requirements.
- **Can you get a complete export before removing the app?** Yes — that's exactly what the export feature delivers: a full export of your service history on demand, before any uninstall.

**Bottom line:** your data is yours and isolated today; export + public API (for scheduled backups) are priority builds; and retention-on-uninstall is configurable to your policy — including keeping it indefinitely.

## 13. Ticketing scope (simple lifecycle, no CRM/PM bloat)

We're fully aligned — this is how HelmDesk is designed.

**On staying a simple ticketing layer:** yes, unequivocally. HelmDesk is **ticketing-only by design** — not a CRM, not an opportunities/pipeline tool, not project management, not accounting. It doesn't duplicate or replace your CRM, Opportunities, ProjX360, or your accounting system. Your employees work tickets and nothing more; the heavier functions stay in the systems you've chosen. This focus is a strength, not a limitation.

**On your exact workflow** — New → Triage → Assigned → Working → Waiting → Completed → Closed: yes, we'll make this work. HelmDesk ships with a simple lifecycle today (New, Open, Pending, On-hold, Resolved, Closed), and your stages map onto it naturally. **Configurable statuses — your own labels and stage order per workspace — is a build we'll do for your account**, so your team sees your exact 7-stage flow and nothing extraneous.

## 14. Mobile & field use

- **Access from mobile?** Yes — HelmDesk is a responsive web app, so technicians can open it in a mobile browser and work tickets from the field: view their queue, read the conversation, and act on tickets.
- **Update status, add internal notes, flag an upgrade from the field?** Status updates and internal notes: yes, today, from mobile. Flagging an upgrade opportunity ties to the opportunity-creation capability above — once live, a technician can flag it right from the ticket.
- **Upload photos from the field?** Not yet — this is the attachment capability noted in point 11. It's a priority build, and it's the same feature that serves your ProjX360 handoff, so photo upload from the field comes online with it.
- **Inside the platform's mobile app or a separate interface?** HelmDesk runs as an embedded page. On desktop/web it's embedded directly in your account; on phones the most reliable experience today is the responsive web view in a mobile browser. Native embedding inside the platform's mobile app depends on that app's support for embedded pages, which is limited. Beyond the responsive web view, a **dedicated, polished field-mobile experience is on our roadmap** — and we'll prioritize the mobile/field flow as part of your implementation.

## 15. Support responsibility

- **Handled by the platform:** the CRM platform itself — your account, conversations, the workflow engine, mobile app, and core platform functionality.
- **Handled by us (the HelmDesk vendor):** everything HelmDesk — tickets, SLAs, the portal, settings, and all the integration capabilities discussed here. **For anything involving HelmDesk, we are your single point of contact** — you won't be bounced between vendors.
- **API / workflow integration issues between the platform and HelmDesk:** **we own the whole HelmDesk integration surface** — webhooks, workflow triggers/actions, the public API, the ProjX360 data flow. If it touches HelmDesk, it's ours to support and resolve.
- **Technical contact for an advanced implementation like yours:** yes — us, directly. Given the scope here, we'll work with you hands-on to scope and deliver it.

---

## Next step — let's talk live

Rather than send you off to general documentation, **let's get on a call.** We'll screen-share the live app so you can see exactly what HelmDesk does today, I'll walk you through the existing capabilities firsthand, and we'll talk through your full architecture — the ProjX360 round-trip, opportunities, your 7-stage workflow, custom statuses, and the rest. From there, our commitment is simple: **we'll build it out fully to fit your needs.** You've mapped a clear, well-thought-out architecture, and nothing in it is blocked.

**Would Sunday work for you?** I'd suggest we schedule a session then so we can go through everything properly and agree on next steps. Grab whatever time suits you here:

**📅 Book a time:** https://calendar.app.google/9PnxDV6QnokzQz2c6
**✉️ Or reach us anytime:** binduchowdary856@gmail.com

Looking forward to it — this is exactly the kind of implementation HelmDesk is built for.

Best regards,
**HelmDesk Team**

---

### Quick status legend (internal — not part of the email)
✅ Available today · 🟡 Partial / near-term roadmap · 🔴 Build needed · ⚡ Committed build for this client

| # | Topic | State |
|---|---|---|
| 1 | Marketplace app & vendor | ✅ |
| 2 | Uses CRM contact (not separate DB) | ✅ |
| 3 | Contact ID + sub-account retained | ✅ |
| 4 | User sync ✅ / contact sync 🟡 | ✅/🟡 |
| 5 | Company + service-location on tickets | 🟡 build w/ you |
| 6 | Create from channels ✅ / API for rest | ✅/🟡 |
| 7 | Auto-ack ✅ / ticket# ⚡ / status-notify 🟡 | ✅/⚡/🟡 |
| 8 | Workflow triggers & actions | 🔴 ⚡ (approval-gated go-live) |
| 9 | Opportunity creation | 🔴 ⚡ (one re-auth) |
| 10 | Internal intake (composition) | 🟡 once blocks ship |
| 11 | ProjX360 handoff (no blocker) | 🟡 ; attachments 🔴 |
| 12 | Ownership ✅ / export 🔴 / retention configurable | ✅/🔴 |
| 13 | Ticketing-only ✅ / custom statuses ⚡ | ✅/⚡ |
| 14 | Mobile web ✅ / photos 🔴 / dedicated mobile 🟡 | ✅/🔴/🟡 |
| 15 | HelmDesk owns all HelmDesk support | ✅ |

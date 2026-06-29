# HelmDesk — Marketplace Launch Kit

<!-- INTERNAL planning doc — not customer-facing. Public listing copy must stay platform-name-free
     (see White-label compliance note under Keywords). -->
Everything needed to list HelmDesk on the marketplace. Logo files live in
`assets/` (and `helmdesk-ui/public/`). Marketing site: `helmdesk-site/`.

---

## 1. App name

**HelmDesk** — confirmed.

Standalone brand ("steering the support helm"), one word, clean as a domain and a one-letter icon,
no clash with Zendesk/Freshdesk/Help Scout/Gorgias. Used consistently across the app, OAuth pages,
logo, and listing.

---

## 2. Logo

To GHL spec — square, 512×512, 17 KB (within 400–800px, under 500 KB).

- `assets/icon-512.png` ← **upload this to the listing**
- `assets/icon.svg` ← vector source (also the app favicon)

Amber rounded tile (`#E0A24A`), ink "H" (`#0F1729`) with a helm-hub dot in the crossbar.

---

## 3. Category

**Primary: Customer Support / Help Desk** (or the closest GHL marketplace equivalent —
*Communications* if no dedicated support category).
**Secondary: CRM / Productivity.**

Rationale: the app's primary job is support-request management on top of Conversations.

---

## 4. Tagline

**Chosen:** *Every request owned, tracked, resolved.*

Alternates (kept for A/B / ad copy):
- *Turn conversations into tracked tickets.*
- *A real help desk, inside your CRM.*

---

## 5. Business niche

**GHL dropdown value: `Marketing Agency`.**

The marketplace "Business niche" field is a fixed dropdown (Dental, Real Estate, Fitness, Solar,
Financial Services, Marketing Agency, …). Every option except "Marketing Agency" is a *vertical*
(an end-business type). HelmDesk is a *horizontal* tool — an agency installs it and resells it to
clients across all those verticals. The buyer is the agency, so **Marketing Agency** is the only
correct pick; choosing a vertical would wrongly narrow a product whose whole value is "works for
every client you serve." (If multi-select is allowed, still lead with Marketing Agency; don't add
verticals.)

Positioning (for copy/description — platform-name-free, white-label safe):
**Agencies and SaaS-mode resellers running customer support across many sub-accounts.**

Their pain: support lives in the Conversations inbox as an undifferentiated stream — no owner, no
priority, no "is this overdue", no proof it was resolved. HelmDesk turns each request into a tracked
ticket with SLAs and a Kanban board, and agencies can **white-label and resell** it to their own
clients. (Backed by the #2 most-voted idea on the HighLevel board — ~888 votes, 5+ years, still
"Under Review" — i.e. unmet demand the platform hasn't committed to building.)

---

## 6. Marketing website

`helmdesk-site/` — Next.js, warm-brutalist theme (cloned from enrichflow-site), amber accent.
Sections: hero → features → how-it-works → pricing → FAQ → footer, plus `/support`.
Install button points to the GHL marketplace listing URL.

**Messaging priority:** the **white-label / resell-to-clients** angle is the *hero-level* headline —
it's the highest-value, most-requested use case. Hero leads with "give every client a branded help
desk," with the product capabilities (tickets/SLA/Kanban) as supporting features below.

---

## 7. Keywords (listing + site `<meta keywords>`)

1. helpdesk
2. ticketing
3. support ticket system
4. agency support desk
5. customer support tickets
6. SLA tracking
7. Kanban support board
8. white-label helpdesk
9. CRM helpdesk app
10. multi-location support

> **White-label compliance:** do NOT use "GoHighLevel", "HighLevel", "GHL", or "LeadConnector" in
> keywords, description, tagline, or any public marketing. Refer to the platform generically — "your
> CRM", "the platform", "your sub-accounts". (Functional API URLs/domains in the code are exempt —
> they're required for the integration and aren't customer-facing.)

---

## Pricing (for the site + GHL plan setup)

| Tier | Price | Seats | Highlights |
|---|---|---|---|
| Starter | $29/mo | up to 3 agents | Unlimited tickets, queue, replies, internal notes |
| **Team** (recommended) | $79/mo | up to 10 | + SLA timers, auto-triage, Kanban, dashboard |
| Agency | $199/mo | unlimited / multi-sub-account | + client reports, white-label, portal intake |

Map each GHL `planId` into `PLANS_JSON` (see helmdesk-api/.env.example).

---

## App description (paste into the rich-text field)

> **Give every client a branded help desk — and resell it.**
>
> HelmDesk turns your conversations into tracked support tickets. Every inbound message becomes a
> ticket with a number, an owner, a priority, and an SLA clock — so nothing gets lost in the inbox.
> Agencies can white-label HelmDesk and offer it to every sub-account as their own support solution.
>
> **What you get**
> - **Tickets from every channel** — SMS, Email, Web Chat, WhatsApp, Facebook & Instagram → tickets automatically.
> - **SLA timers & breach alerts** — see what's overdue before it's missed; report "94% in SLA" to clients.
> - **Kanban board & queue** — drag Open → Pending → Resolved, or work a prioritized queue.
> - **Smart routing** — auto-assign by round-robin, channel, or keyword; internal notes + @mentions.
> - **Client portal intake** — customers submit requests from a branded web form.
> - **White-label & resell** — your brand, your colors, billed per workspace across all sub-accounts.
>
> **Pricing** — Starter $29/mo · Team $79/mo · Agency $199/mo (unlimited agents + white-label).
>
> Every request owned, tracked, resolved.

## Preview image

Spec: **16:9**, PNG/JPG/SVG/GIF, min 640×360 / max 960×540. All white-label clean (no platform names).
Upload in this order (story: triage → workflow → resolve):
- `assets/preview-1.png` — Queue: KPI strip + SLA-coded ticket rows (960×540, 57 KB)
- `assets/preview-2.png` — Kanban board: New / Open / Pending / Resolved columns (960×540, 56 KB)
- `assets/preview-3.png` — Ticket detail: thread + reply/note composer + SLA panel (960×540, 69 KB)
- Sources: `assets/preview-{1,2,3}.svg` (edit + re-render with sharp if needed)
- Optional later: dashboard/reporting + a white-label-branded shot.

## App preview video (optional)
YouTube URL field — skip for launch, or record a 60–90s screen walkthrough later.

## Upload checklist (GHL marketplace dashboard)

- [ ] App name: **HelmDesk**
- [ ] Icon: upload `assets/icon-512.png`
- [ ] Category + tagline + description (use niche + keywords above)
- [ ] Redirect URL: `<BASE_URL>/oauth/callback`
- [ ] Scopes: see helmdesk README (conversations, contacts, users, oauth, charges, installer-details)
- [ ] Webhooks: lifecycle → `/api/webhooks/helmdesk`; **InboundMessage → `/api/webhooks/inbound`**
- [ ] Custom Page: `<BASE_URL>/app`; set Shared Secret as `GHL_SSO_KEY`
- [ ] Subscription plans created; planIds mapped in `PLANS_JSON`
- [ ] Website live; install button → listing URL

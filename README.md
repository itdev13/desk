# HelmDesk — Helpdesk & Ticketing for GoHighLevel

Turn inbound GoHighLevel conversations into tracked support tickets — with ticket numbers, an
isolated thread per ticket, SLA timers, a Kanban board, routing, a dashboard, and white-label
resale for agencies. Built to sit on top of HighLevel's API, storing tickets in its own database.

**The gap it fills:** "Helpdesk / Ticketing" is the #2 most-voted request on the HighLevel ideas
board (~888 votes, "Under Review" for 5+ years). HighLevel hasn't committed to building it.

## Why this shape

- **Zero variable cost.** A ticket is a row in our own MongoDB — no AI, no metered third-party
  services. Every dollar of subscription past fixed infra is margin.
- **Monthly subscription only.** GHL collects the recurring fee; we mirror entitlement. No usage
  metering (there's nothing to meter).
- **Settings-first.** An agency configures channels / filters / assignment / SLA in a setup wizard
  before any tickets flow, so "what counts as a support message" is always their explicit choice.

## Architecture

```
GoHighLevel                          HelmDesk (your cloud)               MongoDB
─────────────                        ──────────────────────             ──────────
OAuth install        ───────────►    OAuth + token lifecycle            oauthtokens, companylocations
InboundMessage webhook ─────────►    Ticket engine (filter→dedup→create) tickets, comments, ticketevents
Conversations API    ◄───────────    Agent replies sent out             workspaces, agents, counters
Contacts / Users API ◄──────────►    Contact card + agent roster        subscriptions, subscriptiontransactions
Marketplace billing  ───────────►    Monthly subscription mirror
                                     SLA monitor (cron) — breach + auto-close
```

What we **build** = the entire ticketing system. What we **consume from GHL** = OAuth (install),
the InboundMessage webhook (receive), the Conversations API (send), Contacts/Users, and billing.

## Repo layout

```
helmdesk/
  helmdesk-api/        Node + Express + Mongoose API
    src/
      config/          db connection
      models/          OAuthToken, CompanyLocation, Installation, Counter, Workspace,
                       Agent, Ticket, Comment, TicketEvent, Subscription, SubscriptionTransaction
      services/        ghlService, ticketService (the engine), subscriptionService, agentService
      routes/          oauth, auth, webhooks (lifecycle + /inbound), tickets, settings,
                       agents, dashboard, subscription, portal (public intake)
      jobs/            slaMonitor (breach detection + auto-close)
      middleware/      auth (JWT session)
  helmdesk-ui/         React + Vite Custom Page UI (embedded in GHL)
    src/
      pages/           SetupWizard, Queue, Board, TicketDetail, Dashboard, Team, Settings
      components/      ui (icons/pills/avatar), NewTicketModal
      lib/             api client, format helpers
```

## Running locally

**API**
```bash
cd helmdesk-api
cp .env.example .env        # fill GHL_CLIENT_ID/SECRET, MONGODB_URI, JWT_SECRET, GHL_SSO_KEY
npm install
npm run dev                 # http://localhost:3020
```

**UI**
```bash
cd helmdesk-ui
npm install
npm run dev                 # http://localhost:5174 (proxies /api,/oauth,/portal → :3020)
# dev tip: open http://localhost:5174/?locationId=<aConnectedLocationId> to bypass GHL SSO
```

**Production**: `npm run build` in `helmdesk-ui` produces `dist/`, which the API serves at `/app`
(same-origin) for the GHL iframe.

## GoHighLevel marketplace setup

1. Create a marketplace app; set the redirect URI to `<BASE_URL>/oauth/callback`.
2. Add scopes: `conversations.readonly/write`, `conversations/message.readonly/write`,
   `contacts.readonly/write`, `locations.readonly`, `users.readonly`, `oauth.readonly`,
   `charges.readonly/write`, `marketplace-installer-details.readonly`.
3. Webhooks:
   - App lifecycle (INSTALL/UNINSTALL/PLAN_CHANGE/Invoice*) → `POST <BASE_URL>/api/webhooks/helmdesk`
   - **InboundMessage** → `POST <BASE_URL>/api/webhooks/inbound`  ← this is what creates tickets
4. Add a Custom Page pointing at `<BASE_URL>/app` and set the app's **Shared Secret** as `GHL_SSO_KEY`.
5. Create subscription plans; map each `planId` in `PLANS_JSON`:
   `{"<id>":{"name":"Team","priceUsd":79,"seatLimit":10}, ...}`

## The ticket lifecycle

```
inbound message ─► filter (support channel? automation? short?) ─► dedup (open ticket for contact?)
   ├─ existing open ticket → append message (reopen if resolved)
   └─ none → create: number + SLA + auto-assign + auto-reply ─► queue/board
agent: reply (→ GHL, stamps first-response) | note (internal) | status | assign | priority
SLA monitor: flags breaches red; auto-closes resolved after N days
customer replies after resolve → auto-reopen
```

## Billing

Monthly subscription, billed per workspace through GHL's marketplace. Tiers map from `planId`
(default Starter $29 / Team $79 / Agency $199). `SUBSCRIPTION_REQUIRED=true` gates the app with a
402 when a workspace isn't entitled. No per-ticket charges.

## Verified

- API: all 29 modules load clean; server mounts all routes; syntax-checked.
- UI: production build succeeds (42 modules).
- Next step before launch: run the live OAuth + InboundMessage round-trip spike against a real
  GHL dev location to confirm webhook payload shape and per-channel send.

---
Built on the proven OAuth/webhook/Mongo scaffolding from the Vaultsuite marketplace apps
(ExportKit / EnrichFlow), with the usage-metering layer intentionally omitted.

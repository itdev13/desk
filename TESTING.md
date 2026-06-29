# HelmDesk — Step-by-Step Testing Guide

Test in three stages, in order. Each stage builds confidence before the next:

1. **Local boot** — does the app run and serve the UI?
2. **Offline logic** — do tickets create / dedup / SLA correctly, with no GHL needed?
3. **Live GHL** — does a real inbound message become a ticket, and does a reply reach the customer?

---

## Stage 0 — Prerequisites

- Node 18+ and a MongoDB you can reach (local `mongod`, Docker, or a free Mongo Atlas cluster).
- A GoHighLevel **agency account** with marketplace developer access (for Stage 3).
- A tunnel tool for Stage 3 so GHL can reach your local server: `cloudflared` or `ngrok`.

---

## Stage 1 — Local boot (5 min)

```bash
# 1. API
cd helmdesk/helmdesk-api
cp .env.example .env
#   Set at minimum:  MONGODB_URI, JWT_SECRET  (GHL_* can stay blank for Stage 1–2)
#   Set:  SUBSCRIPTION_REQUIRED=false   ← lets you use the app without a real plan while testing
npm install
npm run dev
```
Expect: `🚀 HelmDesk API started` and `✅ MongoDB connected`.

Smoke-check it's alive:
```bash
curl -s localhost:3020/health
# → {"status":"healthy","app":"HelmDesk","db":"connected",...}
```

```bash
# 2. UI (separate terminal)
cd helmdesk/helmdesk-ui
npm install
npm run dev      # http://localhost:5174
```

---

## Stage 2 — Offline logic test (no GHL required)

The goal: prove the ticket engine works end to end against your own DB. We seed a workspace, fire a
fake "inbound message" at the webhook, and watch a ticket appear in the UI.

### 2.1 — Create a session without GHL (dev fallback)

The UI accepts a `?locationId=` param that bypasses GHL SSO. Pick any test id, e.g. `TESTLOC1`.

First, create the workspace + a fake token so the app treats `TESTLOC1` as "connected". Run this
one-off seed script from `helmdesk-api/`:

```bash
node -e '
require("dotenv").config({path:".env"});
const m=require("mongoose");
(async()=>{
  await m.connect(process.env.MONGODB_URI);
  const OAuthToken=require("./src/models/OAuthToken");
  const Workspace=require("./src/models/Workspace");
  const Agent=require("./src/models/Agent");
  const loc="TESTLOC1";
  await OAuthToken.findOneAndUpdate({locationId:loc},{locationId:loc,companyId:"TESTCO1",tokenType:"location",accessToken:"x",refreshToken:"x",expiresAt:new Date(Date.now()+9e8),isActive:true,locationName:"Test Sub-Account"},{upsert:true});
  await Workspace.findOneAndUpdate({locationId:loc},{locationId:loc,companyId:"TESTCO1",locationName:"Test Sub-Account"},{upsert:true,setDefaultsOnInsert:true});
  await Agent.findOneAndUpdate({locationId:loc,ghlUserId:"U1"},{name:"Dana Kim",email:"dana@test.co",active:true},{upsert:true,setDefaultsOnInsert:true});
  console.log("✅ seeded TESTLOC1");
  process.exit(0);
})();'
```

Now open: **http://localhost:5174/?locationId=TESTLOC1**
You should land in the **Setup Wizard** (because `setupComplete` is false).

### 2.2 — Complete setup

Walk the 4 steps (pick Email + SMS as channels, keep defaults), click **Finish → Go live**.
You should land in the empty Queue.

### 2.3 — Fire a fake inbound message → ticket should appear

This simulates exactly what GHL's InboundMessage webhook sends. Run:

```bash
curl -s -X POST localhost:3020/api/webhooks/inbound \
  -H 'Content-Type: application/json' \
  -d '{
    "type":"InboundMessage",
    "locationId":"TESTLOC1",
    "contactId":"CONTACT1",
    "conversationId":"CONV1",
    "messageType":"SMS",
    "direction":"inbound",
    "body":"My booking page is throwing an error on submit",
    "messageId":"MSG1",
    "dateAdded":"2026-06-29T18:13:49.000Z"
  }'
# → {"success":true,"action":"created","ticket":"HD-1"}
```

Refresh the Queue → **ticket HD-1 appears**, assigned to Dana (round-robin), with an SLA countdown.

> Note: with no real token, the auto-reply send will fail silently (logged, non-fatal). That's
> expected offline — the ticket still creates. The auto-reply is verified for real in Stage 3.

### 2.4 — Test dedup (same conversation → no duplicate)

Fire the **same `conversationId`** again with a new body:
```bash
curl -s -X POST localhost:3020/api/webhooks/inbound -H 'Content-Type: application/json' \
  -d '{"type":"InboundMessage","locationId":"TESTLOC1","contactId":"CONTACT1","conversationId":"CONV1","messageType":"SMS","direction":"inbound","body":"Any update?","messageId":"MSG2"}'
# → {"success":true,"action":"appended","ticket":"HD-1"}
```
Open HD-1 → the second message is **appended to the same ticket**, not a new one. ✅

### 2.5 — Test the filter (non-support channel → ignored)

You picked Email + SMS as support channels. Fire a Facebook message:
```bash
curl -s -X POST localhost:3020/api/webhooks/inbound -H 'Content-Type: application/json' \
  -d '{"type":"InboundMessage","locationId":"TESTLOC1","contactId":"CONTACT2","conversationId":"CONV2","messageType":"FB","direction":"inbound","body":"hi"}'
# → {"success":true,"action":"ignored","reason":"channel_not_support"}
```
No ticket created. ✅ (Change channels in Settings to include Facebook, then it would create.)

### 2.6 — Exercise the agent actions in the UI

On HD-1: change **status** (New→Open→Pending→Resolved), change **priority** (watch the SLA recompute),
add an **internal note** (stays in the thread, marked internal), and **reassign**. Then check the
**Dashboard** — open count, per-agent load, and status breakdown should reflect your actions.

### 2.7 — Test SLA breach (optional, fast)

Set a tiny SLA to force a breach:
- In Settings → Assignment & SLA, set the **Normal → First reply** to `1` minute, save.
- Create a fresh ticket (new conversationId), wait ~1–2 min for the SLA monitor pass.
- The ticket flips to **breached** (red) and appears under the **Overdue** filter.

### 2.8 — Test the public portal (optional)

In Settings → Branding & portal, enable the portal + save. Copy the **Public intake URL**
(`/portal/p-xxxx`). Then:
```bash
curl -s localhost:3020/portal/<slug>            # → brand info
curl -s -X POST localhost:3020/portal/<slug>/submit -H 'Content-Type: application/json' \
  -d '{"name":"Sam Cole","email":"sam@test.co","subject":"Need an invoice","message":"Where do I download it?"}'
# → {"success":true,"ref":"HD-N",...}
```
A portal-sourced ticket appears in the Queue.

---

## Stage 3 — Live GoHighLevel test (the real round-trip)

This is the only step that needs a real GHL account. It validates your *account setup* (scopes,
webhook subscription, connected channel) — the code is already verified by Stage 2.

### 3.1 — Expose your local server

```bash
cloudflared tunnel --url http://localhost:3020
# copy the https URL it prints, e.g. https://abc-123.trycloudflare.com  → call it <PUBLIC>
```
Set in `.env` (then restart `npm run dev`):
```
BASE_URL=<PUBLIC>
GHL_REDIRECT_URI=<PUBLIC>/oauth/callback
SUBSCRIPTION_REQUIRED=false      # keep false until you've wired a real plan
```

### 3.2 — Configure the marketplace app

In the GHL marketplace developer dashboard, on your app:
- **Redirect URL:** `<PUBLIC>/oauth/callback`
- **Scopes:** conversations.readonly/write, conversations/message.readonly/write,
  contacts.readonly/write, locations.readonly, users.readonly, oauth.readonly,
  charges.readonly/write, marketplace-installer-details.readonly
- **Client ID / Secret:** copy into `.env` (`GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`), restart.
- **Webhooks:**
  - App events (INSTALL/UNINSTALL/PLAN_CHANGE) → `<PUBLIC>/api/webhooks/helmdesk`
  - **InboundMessage** → `<PUBLIC>/api/webhooks/inbound`  ← creates tickets
- **Custom Page:** URL = `<PUBLIC>/app`; copy the app's **Shared Secret** into `.env` as `GHL_SSO_KEY`, restart.

### 3.3 — Install on a test sub-account

Visit `<PUBLIC>/oauth/authorize`, pick a test sub-account, authorize.
- Expect the success page, and in your API logs: `✅ HelmDesk connected (location)`.
- Confirm a token + workspace were created:
  ```bash
  curl -s "<PUBLIC>/oauth/status?locationId=<THE_LOCATION_ID>"   # connected:true
  ```

### 3.4 — Open the app inside GHL & finish setup

In the sub-account's left menu, open **HelmDesk** (the Custom Page). The SSO handshake should resolve
your user, and you'll see the Setup Wizard. Pick the channel you'll test with (e.g. **SMS**), finish.

### 3.5 — The real round-trip (the moment of truth)

1. From a real phone, **text the sub-account's number** (or send on whichever channel you enabled).
2. Within a second or two: a **ticket appears** in the HelmDesk Queue, and the customer receives the
   **auto-reply** ("Thanks for reaching out…"). Check logs for `🎫 Ticket created`.
3. Open the ticket, type a **reply**, send. The text should **arrive on the real phone**.
4. Reply again from the phone → it **appends** to the same ticket (dedup working live).
5. Mark **Resolved**. Text once more from the phone → ticket **auto-reopens**.

If all five happen, the full receive→ticket→send→dedup→reopen loop is proven against live GHL.

### 3.6 — Uninstall cleanup

Uninstall the app from the sub-account → logs show `🗑️ Uninstalled`, tokens removed, subscription
canceled. (Re-install works cleanly.)

---

## What each stage proves

| Stage | Proves | Needs GHL? |
|---|---|---|
| 1 | App boots, DB connects, UI serves | No |
| 2 | Ticket engine: create, dedup, filter, SLA, status, portal, dashboard | No |
| 3 | OAuth, webhook subscription, live receive + send + reopen, billing wiring | Yes |

## Troubleshooting

- **Wizard won't load / 403:** workspace not connected — re-run the Stage 2.1 seed, or check
  `oauth/status` in Stage 3.
- **Inbound returns `ignored`:** the channel isn't in the workspace's support channels (Settings),
  or `setupComplete` is false. The `reason` field tells you which.
- **Reply fails in Stage 3:** the channel isn't actually connected/provisioned in that GHL
  sub-account, or a scope is missing. Check the API log for the GHL error body.
- **402 on API calls:** `SUBSCRIPTION_REQUIRED=true` but no active plan — set it false for testing,
  or map a real `planId` in `PLANS_JSON`.

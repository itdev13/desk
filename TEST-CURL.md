# HelmDesk — Test the message flow with curl

These commands let you (a) inject an inbound message so a **ticket gets created**, and (b) send a
**reply** back — hitting the real GoHighLevel API. Great for verifying an install end to end.

## What you need first

| Value | Where to get it |
|---|---|
| `TOKEN` | A **Location** OAuth access token for the sub-account (from the app install / token store). |
| `CONVERSATION_ID` | Open any conversation in the sub-account → it's in the data / URL. |
| `CONVERSATION_PROVIDER_ID` | The conversation provider's id (only needed for **custom-provider** SMS/Email). |
| `CONTACT_ID` | The contact on that conversation (for sending replies). |

> Tokens expire (~24h). If you get `401 Invalid JWT`, get a fresh token.

---

## 1. Set your variables

```bash
export TOKEN='PASTE_LOCATION_ACCESS_TOKEN'
export CONVERSATION_ID='PASTE_CONVERSATION_ID'
export CONVERSATION_PROVIDER_ID='PASTE_PROVIDER_ID'   # only for custom-provider SMS/Email
export CONTACT_ID='PASTE_CONTACT_ID'                  # only needed for replies
export GHL='https://services.leadconnectorhq.com'
```

---

## 2. Inject an INBOUND message → should create a ticket

**Custom conversation provider (SMS/Email via a custom provider) — use `type: "Custom"`:**
```bash
curl -sS -X POST "$GHL/conversations/messages/inbound" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Version: 2021-04-15" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "Custom",
    "conversationId": "'"$CONVERSATION_ID"'",
    "conversationProviderId": "'"$CONVERSATION_PROVIDER_ID"'",
    "message": "Hi, my booking page is throwing an error — please help!"
  }'
```

**Native SMS (Twilio, no custom provider):**
```bash
curl -sS -X POST "$GHL/conversations/messages/inbound" \
  -H "Authorization: Bearer $TOKEN" -H "Version: 2021-04-15" -H "Content-Type: application/json" \
  -d '{ "type": "SMS", "conversationId": "'"$CONVERSATION_ID"'", "message": "Test inbound SMS" }'
```

**Native Email:**
```bash
curl -sS -X POST "$GHL/conversations/messages/inbound" \
  -H "Authorization: Bearer $TOKEN" -H "Version: 2021-04-15" -H "Content-Type: application/json" \
  -d '{ "type": "Email", "conversationId": "'"$CONVERSATION_ID"'", "subject": "Need help", "message": "Test inbound email" }'
```

**Expected:** `{"success":true,"conversationId":"...","messageId":"..."}`
Then GHL fires the **InboundMessage** webhook to HelmDesk → a ticket appears in the **Queue**.

> Note: for a **custom-provider** message to become a ticket, the workspace must have
> **Settings → "Conversation Providers" enabled** (and setup complete). Native SMS/Email just need
> that channel selected as a support channel.

---

## 3. Send a REPLY back to the customer

**Custom provider — `type: "Custom"` + provider id (verified: SMS type fails for custom providers):**
```bash
curl -sS -X POST "$GHL/conversations/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Version: 2021-04-15" -H "Content-Type: application/json" \
  -d '{
    "type": "Custom",
    "contactId": "'"$CONTACT_ID"'",
    "conversationProviderId": "'"$CONVERSATION_PROVIDER_ID"'",
    "message": "Thanks — we are looking into your booking page now."
  }'
```

**Native SMS reply:**
```bash
curl -sS -X POST "$GHL/conversations/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Version: 2021-04-15" -H "Content-Type: application/json" \
  -d '{ "type": "SMS", "contactId": "'"$CONTACT_ID"'", "message": "Reply via SMS" }'
```

**Expected:** `{"conversationId":"...","messageId":"..."}`

---

## 4. Read the messages on a conversation (see what GHL stored)

```bash
curl -sS "$GHL/conversations/$CONVERSATION_ID/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Version: 2021-04-15" | python3 -m json.tool
```

---

## Troubleshooting

| Response | Meaning |
|---|---|
| `401 Invalid JWT` | Token expired/wrong — get a fresh Location token. |
| `400 CONVERSATION_PROVIDER_MISMATCH` | For a custom provider you must use `type:"Custom"` + `conversationProviderId` (not `type:"SMS"`). |
| `success:true` but no ticket | Check: workspace setup complete? channel selected (or "Conversation Providers" on)? message not a skip-keyword? Check the API logs for `Inbound ignored — <reason>`. |
| Ticket created but reply not delivered | The channel may be receive-only (Call/portal). Reply on a real text channel. |

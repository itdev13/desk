# Reply to Symone — Liberty Timeshare Resolution

**To:** Symone Servio <symone@libertytimeshareresolution.com>
**From:** HelmDesk Team (binduchowdary856@gmail.com)
**Re:** HelmDesk Agency plan — your pre-purchase questions

---

Hi Symone,

Thanks for the detailed questions — they're exactly the right ones to ask before you commit, and your setup (a 9-person support team separate from your contact owners, handling both internal and client tickets) is a good fit for HelmDesk. I've answered each point straight, including where something works perfectly today and where we'd make an adjustment for you.

**1. Ticket owner vs. contact owner**

Good news — this works exactly the way you need. When HelmDesk assigns a ticket to an agent, it sets the **ticket's owner on HelmDesk's own record only.** It does **not** touch the contact's assigned user in your CRM. Your existing contact ownership stays exactly as-is — ticket assignment and contact ownership are tracked completely separately. So your support team can own and work tickets without ever changing who owns the contact.

**2. Round robin by priority**

Honest answer: today, round robin balances the **total number of tickets** evenly across your 9 agents — so everyone gets a fair, equal share of the overall volume. It does **not** currently balance equally *within each priority level* (an equal share of urgents, an equal share of highs, etc.) — that specific per-priority balancing isn't how it works out of the box today.

That said, this is exactly the kind of adjustment we're happy to build for you. If equal distribution within each priority is important to how your team works, we can add that as an option — just let us know and we'll make it fit your workflow.

**3. Client ticket submission**

A few parts here:

- **Branded client portal:** Yes — on the Agency plan you get a branded, public intake form your clients can use to submit tickets on their own. **No login or account required** — they just open the form and submit. Each submission becomes a ticket, automatically linked to the right contact.
- **Text or email:** Yes — clients can also open a ticket simply by texting or emailing you on your connected channels. Those inbound messages become tickets automatically.
- **Checking status / replying:** Clients can **reply directly** to their ticket — a reply to the same email or text thread stays attached to the correct ticket, so the back-and-forth stays in one place. What we don't have *yet* is a self-serve portal page where a client logs in to see their ticket's live status on their own. If a client-facing status view matters to you, that's on our radar and something we can look at building — but today the reply-by-email/SMS loop keeps the conversation connected.

**4. Automatic ticket creation (keeping leads and bots out)**

This is well-handled, and important given you run sales/lead intake in the same sub-account:

- **Limit by channel:** Yes — you choose exactly which channels create tickets (e.g. your support email and SMS), and messages on other channels won't become tickets.
- **Ignore bots and automation:** Yes — HelmDesk can ignore automated and marketing/bot replies, and skip very short one-word messages, so automated responses don't turn into tickets.
- **Keyword rules:** You can set "always create" and "never create" keyword rules for fine control over what becomes a ticket.

One honest note: today the channel filtering is by **channel type** (Email, SMS, etc.) plus those keyword/automation filters — not yet down to a *specific individual phone number or inbox*. If you need ticket creation scoped to a particular number or inbox (to fully wall off sales from support), that's another adjustment we can make for your account — tell us your exact setup and we'll configure it to match.

**5. Trial or refund**

Here's our commitment: **if it doesn't work for you, we'll refund you.** But more than that — we're confident we'll make it work. We'll connect with you directly for setup and support, and if your business needs any extensions or improvements to fit how you operate (like the per-priority round robin or the number/inbox filtering above), we'll build those for you. Our goal is to get it genuinely working for your team, not just to make a sale.

**6. Support and updates**

You're right that HelmDesk is newer — and that's actually an advantage for you, because you get direct, responsive, hands-on support from the team building it. **We handle all support for HelmDesk ourselves** — if something stops working, you reach us directly (not a general queue), and we respond quickly. For an Agency-plan customer like you, we'll also work with you on setup and any adjustments your workflow needs.

---

I'd be glad to walk you through any of this live and help get your setup dialed in before you commit. A few useful links:

- **Website:** https://desk-web-kappa.vercel.app/
- **Help & feature guide:** https://desk-web-kappa.vercel.app/help
- **Book a call:** https://calendar.app.google/9PnxDV6QnokzQz2c6
- **Email us anytime:** binduchowdary856@gmail.com

Looking forward to working with you and your team at Liberty Timeshare Resolution.

Best regards,
**HelmDesk Team**

---

### Internal notes (not part of the email)
| Q | Verdict | Code basis |
|---|---|---|
| 1 Ticket vs contact owner | ✅ Separate — assignment never writes contact owner | ticketService assigns `assigneeId` on ticket only; ghlService only `upsertContact` (link/merge), never assignedTo |
| 2 Round robin per priority | 🟡 Global cursor today (balances total); offered to build per-priority | single `roundRobinCursor` in Workspace, rotates all active agents regardless of priority |
| 3 Portal / status / reply | ✅ Portal no login; ✅ text/email creates; ✅ reply stays attached; 🔴 no client status-check page | portal.js public + rate-limited; no customer-facing status view |
| 4 Channel filtering | ✅ by channel type + ignore-bots + keyword rules; 🟡 not per-number/inbox | shouldAccept: supportChannels whitelist + automation/short filters; no per-number scoping |
| 5 Trial/refund | Business: refund if it doesn't work + we'll build to fit (user's words) | status enum supports `trialing`; no built-in refund (marketplace billing) |
| 6 Support | We own all support, responsive, hands-on | positioning |

---

## Follow-up #2 — after Symone's positive reply (manager looped in, wants client status page ASAP)

**Subject:** Re: HelmDesk for Liberty Timeshare Resolution

Hi Symone,

Wonderful — thank you, and welcome to the department manager as well. Happy to have you both involved.

The client-facing ticket status page is absolutely something we can build for you, and I'd love to make it a priority. The best next step would be a quick call so we can walk through your exact setup, show you HelmDesk live, and map out how the status page should work for your clients — then we can get moving on it right away.

Would a short call work for you and the team? You can grab whatever time suits you here:

📅 **https://calendar.app.google/9PnxDV6QnokzQz2c6**

Or if you'd prefer, just send me a couple of times that work and I'll make one of them work on my end.

Looking forward to speaking with you both.

Best regards,
**HelmDesk Team**

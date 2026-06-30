const express = require('express');
const router = express.Router();
const Workspace = require('../models/Workspace');
const ticketService = require('../services/ticketService');
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');

/**
 * Public client-portal intake. NO session auth — this is the customer-facing "Submit a request"
 * endpoint an agency embeds on a website/portal. Identified by the workspace's public portalSlug.
 *
 * Rate-limited per IP to prevent abuse since it's unauthenticated and creates tickets + contacts.
 */
const intakeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait a moment and try again.' }
});

/** GET /portal/:slug.json — branding as JSON (for programmatic/embedded use). */
router.get('/:slug.json', async (req, res) => {
  const ws = await Workspace.findOne({ portalSlug: req.params.slug, portalEnabled: true });
  if (!ws) return res.status(404).json({ success: false, error: 'Portal not found' });
  res.json({ success: true, brand: ws.brand, locationName: ws.locationName });
});

/** GET /portal/:slug — the customer-facing, branded intake FORM (self-contained HTML page). */
router.get('/:slug', async (req, res) => {
  const ws = await Workspace.findOne({ portalSlug: req.params.slug, portalEnabled: true });
  if (!ws) return res.status(404).send(renderPortalNotFound());
  res.send(renderPortalForm(ws));
});

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderPortalNotFound() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found</title>
  <style>body{font-family:-apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f5f7fa;color:#5a687f}</style></head>
  <body><div><h2>This support form isn't available.</h2></div></body></html>`;
}

function renderPortalForm(ws) {
  const accent = esc(ws.brand?.primaryColor || '#E0A24A');
  const brandName = esc(ws.brand?.name || 'Support');
  const slug = esc(ws.portalSlug);
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brandName} — Submit a request</title>
<style>
  :root{--accent:${accent}}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f7fa;color:#0f1729;line-height:1.55}
  .wrap{max-width:560px;margin:0 auto;padding:40px 20px}
  .card{background:#fff;border:1px solid #dde3ec;border-radius:16px;padding:32px;box-shadow:0 8px 30px -22px rgba(15,23,41,.4)}
  .head{display:flex;align-items:center;gap:12px;margin-bottom:6px}
  .badge{width:40px;height:40px;border-radius:10px;background:var(--accent);color:#0f1729;display:grid;place-items:center;font-weight:800;font-size:20px}
  h1{font-size:22px;margin:0}
  p.sub{color:#5a687f;margin:4px 0 24px;font-size:14px}
  label{display:block;font-size:13px;font-weight:600;color:#2a3447;margin:14px 0 6px}
  input,textarea{width:100%;border:1px solid #dde3ec;border-radius:8px;padding:11px 12px;font-size:15px;font-family:inherit;color:#0f1729}
  input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px ${accent}33}
  textarea{min-height:120px;resize:vertical}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button{margin-top:22px;width:100%;background:var(--accent);color:#0f1729;border:none;border-radius:8px;padding:13px;font-size:15px;font-weight:700;cursor:pointer}
  button:disabled{opacity:.6;cursor:not-allowed}
  .hp{position:absolute;left:-9999px}
  .ok,.err{margin-top:16px;padding:14px;border-radius:8px;font-size:14px;display:none}
  .ok{background:#e4f4ec;color:#14492f}.err{background:#fbe6e6;color:#991b1b}
  .foot{text-align:center;color:#9aa6ba;font-size:12px;margin-top:18px}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="head"><div class="badge">${brandName[0] ? brandName[0].toUpperCase() : 'S'}</div><h1>${brandName}</h1></div>
  <p class="sub">Submit a request and our team will get back to you.</p>
  <form id="f">
    <div class="row">
      <div><label>Name</label><input name="name" autocomplete="name"></div>
      <div><label>Email</label><input name="email" type="email" autocomplete="email"></div>
    </div>
    <label>Phone (optional)</label><input name="phone" type="tel" autocomplete="tel">
    <label>Subject</label><input name="subject" required>
    <label>How can we help?</label><textarea name="message" required></textarea>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button type="submit" id="btn">Submit request</button>
    <div class="ok" id="ok"></div>
    <div class="err" id="err"></div>
  </form>
  <div class="foot">Powered by ${brandName}</div>
</div></div>
<script>
  const f=document.getElementById('f'),btn=document.getElementById('btn'),ok=document.getElementById('ok'),err=document.getElementById('err');
  f.addEventListener('submit',async(e)=>{
    e.preventDefault();ok.style.display='none';err.style.display='none';
    const d=Object.fromEntries(new FormData(f).entries());
    if(d.website){return;} // honeypot: bots fill this hidden field
    if(!d.email&&!d.phone){err.textContent='Please provide an email or phone so we can reply.';err.style.display='block';return;}
    btn.disabled=true;btn.textContent='Submitting…';
    try{
      const r=await fetch('/portal/${slug}/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
      const j=await r.json();
      if(!r.ok||j.success===false)throw new Error(j.error||'Something went wrong');
      f.reset();ok.textContent=(j.ref?('Request '+j.ref+' received. '):'')+'We will be in touch shortly.';ok.style.display='block';
    }catch(ex){err.textContent=ex.message;err.style.display='block';}
    finally{btn.disabled=false;btn.textContent='Submit request';}
  });
</script>
</body></html>`;
}

/**
 * POST /portal/:slug/submit
 * Body: { name, email, phone, subject, message }
 * Creates/merges the GHL contact, then creates a portal-sourced ticket.
 */
router.post('/:slug/submit', intakeLimiter, async (req, res) => {
  try {
    const ws = await Workspace.findOne({ portalSlug: req.params.slug, portalEnabled: true });
    if (!ws) return res.status(404).json({ success: false, error: 'Portal not found' });

    const { name, email, phone, subject, message, website } = req.body;
    // Honeypot: real users never fill the hidden `website` field; bots do. Silently 200 to not tip them off.
    if (website) return res.json({ success: true });
    if (!subject && !message) return res.status(400).json({ success: false, error: 'Please describe your request.' });
    if (!email && !phone) return res.status(400).json({ success: false, error: 'Please provide an email or phone so we can reply.' });

    // Upsert the contact in GHL so the ticket links to a real person.
    let contact = { id: null, name: name || email || phone };
    try {
      const upserted = await ghlService.upsertContact(ws.locationId, {
        firstName: (name || '').split(' ')[0] || undefined,
        lastName: (name || '').split(' ').slice(1).join(' ') || undefined,
        email: email || undefined,
        phone: phone || undefined
      });
      contact = { id: upserted.id || upserted.contact?.id, name: name || email || phone };
    } catch (e) {
      logger.warn('portal contact upsert failed (continuing without contactId)', { message: e.message });
    }

    const ticket = await ticketService.createTicket(ws, {
      subject: subject || (message || '').slice(0, 80),
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: email || null,
      channel: 'portal',
      source: 'portal',
      firstMessage: message || subject
    });

    res.json({ success: true, ref: ticket.ref, message: 'Your request has been submitted. We will be in touch shortly.' });
  } catch (error) {
    logger.error('portal submit failed', { message: error.message });
    res.status(500).json({ success: false, error: 'Could not submit your request. Please try again.' });
  }
});

module.exports = router;

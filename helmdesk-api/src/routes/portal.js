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
  // The global helmet CSP uses script-src 'self', which blocks this page's INLINE <script> (the
  // one that intercepts submit and POSTs). That silently made the form fall back to a native GET.
  // This is a self-contained public page, so relax its CSP to allow its own inline script + styles.
  res.set('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'");
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

/** Render one form field to HTML from its config. `name` is the field key; choice options escaped. */
function renderField(f) {
  const name = esc(f.key);
  const label = esc(f.label || 'Field');
  const req = f.required ? 'required' : '';
  const reqMark = f.required ? ' <span style="color:#d64545">*</span>' : '';
  const maxAttr = f.maxLength ? `maxlength="${f.maxLength}"` : '';
  const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
  if (f.type === 'textarea') {
    return `<label>${label}${reqMark}</label><textarea name="${name}" ${req} ${maxAttr} ${ph}></textarea>`;
  }
  if (f.type === 'select') {
    const opts = (f.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    return `<label>${label}${reqMark}</label><select name="${name}" ${req}><option value="">Select…</option>${opts}</select>`;
  }
  if (f.type === 'radio' || f.type === 'checkbox') {
    const inputType = f.type;
    const opts = (f.options || []).map((o, i) =>
      `<label class="opt"><input type="${inputType}" name="${name}" value="${esc(o)}" ${f.required && inputType === 'radio' && i === 0 ? '' : ''}> ${esc(o)}</label>`
    ).join('');
    return `<label>${label}${reqMark}</label><div class="opts" data-required="${f.required ? 1 : 0}" data-type="${inputType}" data-name="${name}">${opts}</div>`;
  }
  // default: single-line text (email/phone get the right input type for keyboards + validation)
  const inputType = f.maps === 'email' ? 'email' : f.maps === 'phone' ? 'tel' : 'text';
  const ac = f.maps === 'email' ? 'email' : f.maps === 'phone' ? 'tel' : f.maps === 'name' ? 'name' : 'off';
  return `<label>${label}${reqMark}</label><input type="${inputType}" name="${name}" ${req} ${maxAttr} ${ph} autocomplete="${ac}">`;
}

/** Pick readable text (near-black or white) for a given background hex, via WCAG luminance. */
function contrastText(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return '#0f1729';
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.5 ? '#0f1729' : '#ffffff'; // dark text on light bg, white text on dark bg
}

function renderPortalForm(ws) {
  const accent = esc(ws.brand?.primaryColor || '#E0A24A');
  const onAccent = contrastText(ws.brand?.primaryColor || '#E0A24A');
  const brandName = esc(ws.brand?.name || 'Support');
  const slug = esc(ws.portalSlug);
  const fields = (ws.portalFields && ws.portalFields.length) ? ws.portalFields : Workspace.PORTAL_DEFAULT_FIELDS;
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brandName} — Submit a request</title>
<style>
  :root{--accent:${accent};--on-accent:${onAccent}}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f7fa;color:#0f1729;line-height:1.55}
  .wrap{max-width:560px;margin:0 auto;padding:40px 20px}
  .card{background:#fff;border:1px solid #dde3ec;border-radius:16px;padding:32px;box-shadow:0 8px 30px -22px rgba(15,23,41,.4)}
  .head{display:flex;align-items:center;gap:12px;margin-bottom:6px}
  .badge{width:44px;height:44px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-weight:800;font-size:20px}
  h1{font-size:22px;margin:0}
  p.sub{color:#5a687f;margin:4px 0 24px;font-size:14px}
  label{display:block;font-size:13px;font-weight:600;color:#2a3447;margin:14px 0 6px}
  input,textarea,select{width:100%;border:1px solid #dde3ec;border-radius:8px;padding:11px 12px;font-size:15px;font-family:inherit;color:#0f1729;background:#fff}
  input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px ${accent}33}
  textarea{min-height:120px;resize:vertical}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .opts{display:flex;flex-direction:column;gap:8px}
  .opts .opt{display:flex;align-items:center;gap:8px;font-weight:400;font-size:14px;color:#0f1729;margin:0;cursor:pointer}
  .opts .opt input{width:auto;margin:0}
  button{margin-top:22px;width:100%;background:var(--accent);color:var(--on-accent);border:none;border-radius:8px;padding:13px;font-size:15px;font-weight:700;cursor:pointer}
  button:disabled{opacity:.6;cursor:not-allowed}
  .hp{position:absolute;left:-9999px}
  .ok,.err{margin-top:16px;padding:14px;border-radius:8px;font-size:14px;display:none}
  .ok{background:#e4f4ec;color:#14492f}.err{background:#fbe6e6;color:#991b1b}
  .foot{text-align:center;color:#9aa6ba;font-size:12px;margin-top:18px}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="head"><div class="badge">${brandName[0] ? brandName[0].toUpperCase() : 'S'}</div><h1>${brandName}</h1></div>
  <p class="sub">Submit a request and our team will get back to you.</p>
  <form id="f" method="post" action="/portal/${slug}/submit">
    ${fields.map((f) => renderField(f)).join('\n    ')}
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button type="submit" id="btn">Submit request</button>
    <div class="ok" id="ok"></div>
    <div class="err" id="err"></div>
  </form>
  <div class="foot">Powered by ${brandName}</div>
</div></div>
<script>
  const f=document.getElementById('f'),btn=document.getElementById('btn'),ok=document.getElementById('ok'),err=document.getElementById('err');
  function collect(){
    const fd=new FormData(f), d={};
    for(const [k,v] of fd.entries()){
      if(d[k]===undefined){d[k]=v;}
      else if(Array.isArray(d[k])){d[k].push(v);} // checkbox group → array
      else{d[k]=[d[k],v];}
    }
    return d;
  }
  function validateChoiceGroups(){
    // Native 'required' doesn't cover checkbox/radio groups; enforce here.
    for(const g of f.querySelectorAll('.opts[data-required="1"]')){
      if(!g.querySelector('input:checked')){return g.getAttribute('data-name');}
    }
    return null;
  }
  f.addEventListener('submit',async(e)=>{
    e.preventDefault();ok.style.display='none';err.style.display='none';
    const missing=validateChoiceGroups();
    if(missing){err.textContent='Please complete all required fields.';err.style.display='block';return;}
    const d=collect();
    if(d.website){return;} // honeypot: bots fill this hidden field
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

    // Honeypot: real users never fill the hidden `website` field; bots do. Silently 200 to not tip them off.
    if (req.body.website) return res.json({ success: true });

    // Interpret the submitted body via the workspace's configured fields (falling back to defaults).
    const fields = (ws.portalFields && ws.portalFields.length) ? ws.portalFields : Workspace.PORTAL_DEFAULT_FIELDS;
    const core = { name: '', email: '', phone: '', subject: '', message: '' };
    const custom = []; // { label, value } for non-core questions, shown to the agent

    for (const fld of fields) {
      let val = req.body[fld.key];
      if (Array.isArray(val)) val = val.filter(Boolean).join(', ');
      val = (val == null ? '' : String(val)).trim();
      // Required-field enforcement (server-side, authoritative).
      if (fld.required && !val) {
        return res.status(400).json({ success: false, error: `“${fld.label}” is required.` });
      }
      if (!val) continue;
      if (fld.maps && core[fld.maps] !== undefined) core[fld.maps] = val;
      else if (!fld.maps) custom.push({ label: fld.label, value: val });
    }

    const { name, email, phone } = core;
    if (!email && !phone) return res.status(400).json({ success: false, error: 'Please provide an email or phone so we can reply.' });

    // Derive subject/message when the agency's custom form omits those fields, so the form never
    // dead-ends: fall back to the first custom answer, then a generic label.
    const custBlock = custom.map((c) => `${c.label}: ${c.value}`).join('\n');
    let { subject, message } = core;
    if (!subject) subject = custom[0]?.value?.slice(0, 80) || 'Support request';
    if (!message) message = custBlock || subject;

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

    // Fold custom answers into the opening message so the agent sees them in context — but only if
    // the message came from a real message field (if we already derived it from the custom answers,
    // they're in there and we'd be duplicating).
    const appendCustom = core.message && custom.length ? '\n\n— Form details —\n' + custBlock : '';
    const ticket = await ticketService.createTicket(ws, {
      subject,
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: email || null,
      channel: 'portal',
      source: 'portal',
      firstMessage: message + appendCustom,
      customFields: custom
    });

    res.json({ success: true, ref: ticket.ref, message: 'Your request has been submitted. We will be in touch shortly.' });
  } catch (error) {
    logger.error('portal submit failed', { message: error.message });
    res.status(500).json({ success: false, error: 'Could not submit your request. Please try again.' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const Workspace = require('../models/Workspace');
const PortalForm = require('../models/PortalForm');
const ticketService = require('../services/ticketService');
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');

const PORTAL_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'";

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

/** GET /portal/:slug — LEGACY single-form intake (the workspace's own portalSlug/portalFields). */
router.get('/:slug', async (req, res) => {
  const ws = await Workspace.findOne({ portalSlug: req.params.slug, portalEnabled: true });
  if (!ws) return res.status(404).send(renderPortalNotFound());
  // Relax CSP so this self-contained page's inline script/styles run (global CSP blocks inline).
  res.set('Content-Security-Policy', PORTAL_CSP);
  const legacyForm = { name: 'Submit a request', fields: ws.portalFields };
  res.send(renderPortalForm(ws, legacyForm, `/portal/${esc(req.params.slug)}/submit`));
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
  // Optional help/description line shown under the label.
  const help = f.helpText ? `<span class="help">${esc(f.helpText)}</span>` : '';
  if (f.type === 'textarea') {
    return `<label>${label}${reqMark}</label>${help}<textarea name="${name}" ${req} ${maxAttr} ${ph}></textarea>`;
  }
  if (f.type === 'select') {
    const opts = (f.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    return `<label>${label}${reqMark}</label>${help}<select name="${name}" ${req}><option value="">Select…</option>${opts}</select>`;
  }
  if (f.type === 'radio' || f.type === 'checkbox') {
    const inputType = f.type;
    const opts = (f.options || []).map((o, i) =>
      `<label class="opt"><input type="${inputType}" name="${name}" value="${esc(o)}" ${f.required && inputType === 'radio' && i === 0 ? '' : ''}> ${esc(o)}</label>`
    ).join('');
    return `<label>${label}${reqMark}</label>${help}<div class="opts" data-required="${f.required ? 1 : 0}" data-type="${inputType}" data-name="${name}">${opts}</div>`;
  }
  // default: single-line text (email/phone get the right input type for keyboards + validation)
  const inputType = f.maps === 'email' ? 'email' : f.maps === 'phone' ? 'tel' : 'text';
  const ac = f.maps === 'email' ? 'email' : f.maps === 'phone' ? 'tel' : f.maps === 'name' ? 'name' : 'off';
  return `<label>${label}${reqMark}</label>${help}<input type="${inputType}" name="${name}" ${req} ${maxAttr} ${ph} autocomplete="${ac}">`;
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

/**
 * Render the public intake page. `ws` supplies branding; `form` supplies the fields/title/slug and
 * `submitPath` is where the form POSTs (so legacy /portal/:slug and new /f/:slug can both reuse this).
 */
function renderPortalForm(ws, form, submitPath) {
  const accent = esc(ws.brand?.primaryColor || '#E0A24A');
  const onAccent = contrastText(ws.brand?.primaryColor || '#E0A24A');
  const brandName = esc(ws.brand?.name || 'Support');
  const formTitle = esc(form?.name || 'Submit a request');
  const action = esc(submitPath);
  const fields = (form?.fields && form.fields.length) ? form.fields : Workspace.PORTAL_DEFAULT_FIELDS;
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brandName} — ${formTitle}</title>
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
  .help{display:block;font-size:13px;color:#6b7280;margin:-2px 0 7px}
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
  .err{margin-top:16px;padding:14px;border-radius:8px;font-size:14px;display:none;background:#fbe6e6;color:#991b1b}
  .done{display:none;text-align:center;padding:24px 8px 8px}
  .done.show{display:block;animation:fade .2s ease}
  .done-icon{width:56px;height:56px;border-radius:50%;background:#e4f4ec;color:#14492f;display:grid;place-items:center;margin:0 auto 16px}
  .done h2{margin:0 0 6px;font-size:20px}
  .done p{margin:0 auto;max-width:340px;color:#5a687f;font-size:14px}
  @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .foot{text-align:center;color:#9aa6ba;font-size:12px;margin-top:18px}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="head"><div class="badge">${brandName[0] ? brandName[0].toUpperCase() : 'S'}</div><h1>${brandName}</h1></div>
  <p class="sub">${formTitle} and our team will get back to you.</p>
  <form id="f" method="post" action="${action}">
    ${fields.map((f) => renderField(f)).join('\n    ')}
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button type="submit" id="btn">Submit request</button>
    <div class="err" id="err"></div>
  </form>
  <div class="done" id="done">
    <div class="done-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
    <h2 id="done-title">Request received</h2>
    <p id="done-msg">We’ve got your request and will be in touch shortly.</p>
  </div>
  <div class="foot">Powered by ${brandName}</div>
</div></div>
<script>
  const f=document.getElementById('f'),btn=document.getElementById('btn'),err=document.getElementById('err');
  const done=document.getElementById('done'),doneMsg=document.getElementById('done-msg');
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
    e.preventDefault();err.style.display='none';
    const missing=validateChoiceGroups();
    if(missing){err.textContent='Please complete all required fields.';err.style.display='block';return;}
    const d=collect();
    if(d.website){return;} // honeypot: bots fill this hidden field
    btn.disabled=true;btn.textContent='Submitting…';
    try{
      const r=await fetch('/portal/${slug}/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
      const j=await r.json();
      if(!r.ok||j.success===false)throw new Error(j.error||'Something went wrong');
      // Success → swap the form out for a clean confirmation panel.
      f.reset();f.style.display='none';
      doneMsg.textContent=(j.ref?('Your request '+j.ref+' has been received. '):'Your request has been received. ')+'We’ll be in touch shortly.';
      done.classList.add('show');
    }catch(ex){err.textContent=ex.message;err.style.display='block';}
    finally{btn.disabled=false;btn.textContent='Submit request';}
  });
</script>
</body></html>`;
}

/**
 * Shared submission handler. `ws` = branding/location; `form` = the form whose fields/name drive the
 * ticket (a PortalForm for /f/:slug, or a synthetic {name, fields} for the legacy /portal/:slug).
 */
async function processSubmission(ws, form, req, res) {
  try {
    // Honeypot: real users never fill the hidden `website` field; bots do. Silently 200 to not tip them off.
    if (req.body.website) return res.json({ success: true });

    // Interpret the submitted body via the form's configured fields (falling back to defaults).
    const fields = (form?.fields && form.fields.length) ? form.fields : Workspace.PORTAL_DEFAULT_FIELDS;
    const core = { name: '', email: '', phone: '', subject: '', message: '', priority: '' };
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
    // No hard-coded contact rule: the agency's per-field `required` settings are the source of truth
    // (enforced in the loop above). If they leave email/phone optional, a ticket is created without
    // a reply-to — their choice. We just need SOME content to make a ticket, which we derive below.

    // Guard against a totally empty submission (no core value and no custom answers) → junk ticket.
    const anyContent = Object.values(core).some(Boolean) || custom.length > 0;
    if (!anyContent) return res.status(400).json({ success: false, error: 'Please fill in the form before submitting.' });

    // Derive subject/message when the agency's custom form omits those fields, so the form never
    // dead-ends: fall back to the first custom answer, then a generic label.
    const custBlock = custom.map((c) => `${c.label}: ${c.value}`).join('\n');
    let { subject, message } = core;
    if (!subject) subject = custom[0]?.value?.slice(0, 80) || 'Support request';
    if (!message) message = custBlock || subject;

    // Upsert the contact in GHL so the ticket links to a real person (creates them if they don't
    // exist yet, by email/phone). Tag + source let the agency see these came from the portal.
    let contact = { id: null, name: name || email || phone };
    try {
      const upserted = await ghlService.upsertContact(ws.locationId, {
        firstName: (name || '').split(' ')[0] || undefined,
        lastName: (name || '').split(' ').slice(1).join(' ') || undefined,
        email: email || undefined,
        phone: phone || undefined,
        source: `${ws.brand?.name || 'HelmDesk'} Portal`,
        tags: ['helmdesk', 'portal']
      });
      contact = { id: upserted.id || upserted.contact?.id, name: name || email || phone };
    } catch (e) {
      logger.warn('portal contact upsert failed (continuing without contactId)', { message: e.message });
    }

    // Mirror the submission into GHL's native Conversations as an inbound message, so the form
    // submission is visible there too (not just in HelmDesk). Best-effort — never blocks the ticket.
    const providerId = process.env.GHL_CONVERSATION_PROVIDER_ID || '6a4419eda0320c4756a842cb';
    if (contact.id && providerId) {
      try {
        await ghlService.addInboundMessage(ws.locationId, {
          type: 'Custom',
          contactId: contact.id,
          conversationProviderId: providerId,
          direction: 'inbound',
          message: `Ticketing - Form submitted\n\n${message}${custom.length ? '\n\n— Form details —\n' + custBlock : ''}`
        });
      } catch (e) {
        logger.warn('portal inbound-message mirror failed (continuing)', { message: e.message });
      }
    }

    // Fold custom answers into the opening message so the agent sees them in context — but only if
    // the message came from a real message field (if we already derived it from the custom answers,
    // they're in there and we'd be duplicating).
    const appendCustom = core.message && custom.length ? '\n\n— Form details —\n' + custBlock : '';
    // Normalize a customer-chosen priority (e.g. "High" → "high"); ignore anything not in the enum so a
    // crafted submission can't set a junk value. Falls through to the ticket default when unset/invalid.
    const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low'];
    const chosenPriority = VALID_PRIORITIES.includes(String(core.priority).toLowerCase())
      ? String(core.priority).toLowerCase()
      : null;

    const ticket = await ticketService.createTicket(ws, {
      subject,
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: email || null,
      channel: 'portal',
      source: 'portal',
      formName: form?.name || `${ws.brand?.name || 'HelmDesk'} Portal`,
      priority: chosenPriority || undefined, // undefined → createTicket applies the default/rules
      firstMessage: message + appendCustom,
      customFields: custom
    });

    // Bump the form's submission counter (best-effort), if this came from a saved PortalForm.
    if (form?._id) PortalForm.updateOne({ _id: form._id }, { $inc: { submitCount: 1 } }).catch(() => {});

    res.json({ success: true, ref: ticket.ref, message: 'Your request has been submitted. We will be in touch shortly.' });
  } catch (error) {
    logger.error('portal submit failed', { message: error.message });
    res.status(500).json({ success: false, error: 'Could not submit your request. Please try again.' });
  }
}

/** LEGACY: POST /portal/:slug/submit — the workspace's own single form. */
router.post('/:slug/submit', intakeLimiter, async (req, res) => {
  const ws = await Workspace.findOne({ portalSlug: req.params.slug, portalEnabled: true });
  if (!ws) return res.status(404).json({ success: false, error: 'Portal not found' });
  return processSubmission(ws, { name: 'Submit a request', fields: ws.portalFields }, req, res);
});

/* ── Multi-form intake (short URLs): /f/:slug ─────────────────────────────────────────────
 * A PortalForm has its own short slug + fields. Resolve the form, then its workspace for branding. */
async function loadFormAndWs(slug) {
  const form = await PortalForm.findOne({ slug, enabled: true }).lean();
  if (!form) return null;
  const ws = await Workspace.findOne({ locationId: form.locationId, portalEnabled: true });
  if (!ws) return null;
  return { form, ws };
}

/** GET /f/:slug — a specific multi-form intake page. */
router.get('/f/:slug', async (req, res) => {
  const found = await loadFormAndWs(req.params.slug);
  if (!found) return res.status(404).send(renderPortalNotFound());
  res.set('Content-Security-Policy', PORTAL_CSP);
  res.send(renderPortalForm(found.ws, found.form, `/portal/f/${esc(req.params.slug)}/submit`));
});

/** POST /f/:slug/submit — submit a specific multi-form. */
router.post('/f/:slug/submit', intakeLimiter, async (req, res) => {
  const found = await loadFormAndWs(req.params.slug);
  if (!found) return res.status(404).json({ success: false, error: 'Form not found' });
  return processSubmission(found.ws, found.form, req, res);
});

/* Pretty URL: /f/<workspace-name>/<slug>. The name segment is cosmetic — we always key off <slug>. */
/** GET /f/:nameSlug/:slug — same page, with the workspace name in the path. */
router.get('/f/:nameSlug/:slug', async (req, res) => {
  const found = await loadFormAndWs(req.params.slug);
  if (!found) return res.status(404).send(renderPortalNotFound());
  res.set('Content-Security-Policy', PORTAL_CSP);
  res.send(renderPortalForm(found.ws, found.form, `/portal/f/${esc(req.params.nameSlug)}/${esc(req.params.slug)}/submit`));
});

/** POST /f/:nameSlug/:slug/submit — submit via the pretty URL. */
router.post('/f/:nameSlug/:slug/submit', intakeLimiter, async (req, res) => {
  const found = await loadFormAndWs(req.params.slug);
  if (!found) return res.status(404).json({ success: false, error: 'Form not found' });
  return processSubmission(found.ws, found.form, req, res);
});

module.exports = router;

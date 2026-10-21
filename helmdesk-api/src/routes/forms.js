const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const PortalForm = require('../models/PortalForm');
const Workspace = require('../models/Workspace');
const { sanitizePortalFields } = require('./settings');
const logger = require('../utils/logger');

router.use(requireAuth);

/** A short, unguessable public slug for a form's URL (e.g. "k3x9ab"). */
function shortSlug() {
  return crypto.randomBytes(5).toString('base64url').slice(0, 7);
}

/** A readable, URL-safe slug from a name (e.g. "Liberty Timeshare" → "liberty-timeshare"). */
function slugifyName(name) {
  const s = String(name || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanumerics → hyphen
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
    .slice(0, 40);
  return s || 'support';
}

// The public base for form URLs. Set PORTAL_PUBLIC_BASE to a short/branded domain (e.g.
// https://forms.yourbrand.com) that proxies to this API's /portal path, so the UI never discloses the
// raw API domain. Falls back to BASE_URL. The short form URL is `${base}/f/${slug}`.
function publicFormUrl(slug, workspaceSlug) {
  const base = (process.env.PORTAL_PUBLIC_BASE || process.env.BASE_URL || '').replace(/\/$/, '');
  // Pretty: /f/<workspace-name>/<slug> when we have a name; plain /f/<slug> otherwise.
  return workspaceSlug ? `${base}/f/${workspaceSlug}/${slug}` : `${base}/f/${slug}`;
}
const withUrl = (f) => ({ ...f, url: publicFormUrl(f.slug, f.workspaceSlug) });

/** The workspace's name slug (brand name, else location name), for the pretty URL. */
async function workspaceSlugFor(locationId) {
  const ws = await Workspace.findOne({ locationId }).select('brand locationName').lean();
  return slugifyName(ws?.brand?.name && ws.brand.name !== 'HelmDesk' ? ws.brand.name : ws?.locationName);
}

/** GET /api/forms — list the workspace's forms (admin), each with its public short URL. */
router.get('/', requireAdmin, async (req, res) => {
  const forms = await PortalForm.find({ locationId: req.auth.locationId }).sort({ createdAt: 1 }).lean();
  res.json({ success: true, forms: forms.map(withUrl) });
});

/** POST /api/forms — create a new form (admin). Body: { name?, fields?, enabled? }. */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || 'Support request').slice(0, 80);
    const fields = sanitizePortalFields(req.body.fields) ?? Workspace.PORTAL_DEFAULT_FIELDS;
    // Mint a unique short slug (retry on the rare collision).
    let slug;
    for (let i = 0; i < 5; i++) { slug = shortSlug(); if (!(await PortalForm.exists({ slug }))) break; }
    const workspaceSlug = await workspaceSlugFor(req.auth.locationId);
    const form = await PortalForm.create({
      locationId: req.auth.locationId, name, slug, workspaceSlug, enabled: req.body.enabled !== false, fields
    });
    res.json({ success: true, form: withUrl(form.toObject ? form.toObject() : form) });
  } catch (err) {
    logger.error('create form failed', { message: err.message });
    res.status(500).json({ success: false, error: 'Could not create form.' });
  }
});

/** PUT /api/forms/:id — update a form (admin). Body: { name?, fields?, enabled? }. */
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const update = {};
    if (req.body.name !== undefined) update.name = String(req.body.name || 'Support request').slice(0, 80);
    if (req.body.enabled !== undefined) update.enabled = !!req.body.enabled;
    if (req.body.fields !== undefined) update.fields = sanitizePortalFields(req.body.fields) ?? Workspace.PORTAL_DEFAULT_FIELDS;
    // Refresh the workspace name slug on save, so a form created before this feature (or after a
    // rebrand) gets the pretty URL too.
    update.workspaceSlug = await workspaceSlugFor(req.auth.locationId);
    const form = await PortalForm.findOneAndUpdate(
      { _id: req.params.id, locationId: req.auth.locationId }, update, { new: true }
    );
    if (!form) return res.status(404).json({ success: false, error: 'Form not found.' });
    res.json({ success: true, form: withUrl(form.toObject ? form.toObject() : form) });
  } catch (err) {
    logger.error('update form failed', { message: err.message });
    res.status(500).json({ success: false, error: 'Could not update form.' });
  }
});

/** DELETE /api/forms/:id — remove a form (admin). */
router.delete('/:id', requireAdmin, async (req, res) => {
  const r = await PortalForm.deleteOne({ _id: req.params.id, locationId: req.auth.locationId });
  res.json({ success: true, deleted: r.deletedCount });
});

module.exports = router;

const crypto = require('crypto');
const logger = require('./logger');

/**
 * GoHighLevel webhook signature verification — matching the official WebhookIntegrationGuide.
 *
 * GHL signs the webhook payload (JSON.stringify of the parsed body) and sends the signature in a
 * header. Two schemes during the transition:
 *   - X-GHL-Signature — Ed25519 (the current/preferred scheme)
 *   - X-WH-Signature   — RSA-SHA256 (LEGACY, deprecated 2026-09-01)
 * Prefer X-GHL-Signature whenever present; fall back to the legacy header until it's gone.
 * Keys are the fixed platform public keys from the docs; overridable via env if GHL rotates them.
 */
// Ed25519 public key for X-GHL-Signature — supplied via env (no hardcoded fallback).
const GHL_PUBLIC_KEY = (process.env.GHL_WEBHOOK_ED25519_PUBLIC_KEY || '').replace(/\\n/g, '\n');

const LEGACY_PUBLIC_KEY = process.env.GHL_WEBHOOK_LEGACY_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

/** Ed25519 verify (X-GHL-Signature). */
function verifyGhl(payload, signature) {
  if (!signature || signature === 'N/A') return { ok: false, reason: 'no signature' };
  if (!GHL_PUBLIC_KEY) return { ok: false, reason: 'GHL_WEBHOOK_ED25519_PUBLIC_KEY not set' };
  try {
    const ok = crypto.verify(null, Buffer.from(payload, 'utf8'), GHL_PUBLIC_KEY, Buffer.from(signature, 'base64'));
    return { ok, reason: ok ? null : 'verify failed' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** RSA-SHA256 verify (legacy X-WH-Signature). */
function verifyLegacy(payload, signature) {
  if (!signature || signature === 'N/A') return { ok: false, reason: 'no signature' };
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(payload);
    const ok = verifier.verify(LEGACY_PUBLIC_KEY, signature, 'base64');
    return { ok, reason: ok ? null : 'verify failed' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Verify a webhook request. Returns { ok, verified, reason, scheme }.
 *   - verified=true  → a signature header was present and passed.
 *   - verified=false → no signature header at all (ok=true so we don't reject; GHL may omit it).
 * Prefers X-GHL-Signature (Ed25519); falls back to the legacy X-WH-Signature (RSA) until removed.
 */
function verifyWebhook(req) {
  const payload = JSON.stringify(req.body); // GHL signs the serialized body, per the docs
  const ghlSig = req.headers['x-ghl-signature'];
  const legacySig = req.headers['x-wh-signature'];

  if (ghlSig) return { ...verifyGhl(payload, ghlSig), verified: undefined, scheme: 'ghl' };
  if (legacySig) return { ...verifyLegacy(payload, legacySig), verified: undefined, scheme: 'legacy' };
  return { ok: true, verified: false, reason: 'no_signature', scheme: null };
}

/**
 * Express middleware. WEBHOOK_VERIFY_ENFORCE:
 *   - 'false' (default): log-only — verify but never reject, so a mis-config can't drop real
 *     webhooks. Watch the logs; once failures never appear, flip to enforce.
 *   - 'true': reject unverified webhooks with 401.
 * Requests with a valid signature always pass; requests with NO signature pass (transition-safe).
 */
function webhookSignatureGuard(req, res, next) {
  const enforce = String(process.env.WEBHOOK_VERIFY_ENFORCE ?? 'false').toLowerCase() === 'true';
  const r = verifyWebhook(req);

  if (r.reason === 'no_signature') {
    logger.info('🔏 Webhook had no signature header (accepted)', { type: req.body?.type });
    return next();
  }
  if (!r.ok) {
    logger.warn('🔏 Webhook signature check FAILED', { scheme: r.scheme, reason: r.reason, enforce, type: req.body?.type });
    if (enforce) return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
  }
  return next();
}

module.exports = { verifyWebhook, verifyGhl, verifyLegacy, webhookSignatureGuard };

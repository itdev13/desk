/**
 * Diagnose / seed the reconnect banner. Run on the SERVER (where the real .env with MONGODB_URI is):
 *
 *   node scripts/reconnect-check.js                      # diagnose only
 *   node scripts/reconnect-check.js seed <versionId>     # seed a forceReconnect row for <versionId>
 *
 * The banner shows for an install when there exists a VersionConfig row with forceReconnect:true
 * whose versionId is DIFFERENT from the install's current versionId.
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set — run this on the server.'); process.exit(1); }
  await mongoose.connect(uri);

  const VersionConfig = require('../src/models/VersionConfig');
  const Installation = require('../src/models/Installation');

  const [, , cmd, versionArg] = process.argv;

  if (cmd === 'seed') {
    if (!versionArg) { console.error('Usage: node scripts/reconnect-check.js seed <versionId>'); process.exit(1); }
    const row = await VersionConfig.findOneAndUpdate(
      { versionId: versionArg },
      { $set: { forceReconnect: true, reason: 'We added contact access so tickets show the full contact card — reconnect to enable it.' } },
      { upsert: true, new: true }
    );
    console.log('✅ Seeded/updated VersionConfig:', JSON.stringify(row, null, 2));
  }

  // Diagnose.
  const vcs = await VersionConfig.find({}).lean();
  console.log('\n=== VersionConfig rows ===');
  console.log(vcs.length ? JSON.stringify(vcs, null, 2) : '(none — banner can never fire until you seed one)');

  const installs = await Installation.find({ status: 'active' })
    .select('locationId companyName appId versionId rawWebhookData.versionId isWhitelabelCompany whitelabelDetails.domain')
    .lean();
  console.log('\n=== Active installs ===');
  for (const i of installs) {
    const v = i.versionId || i.rawWebhookData?.versionId || null;
    const flagged = vcs.find((c) => c.forceReconnect && c.versionId !== v);
    // Mirror resolveReconnect's domain rule exactly.
    const appId = i.appId || process.env.GHL_APP_ID || null;
    const wlDomain = i.isWhitelabelCompany ? (i.whitelabelDetails?.domain || '').trim() : '';
    const host = (wlDomain || 'app.gohighlevel.com').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const url = appId ? `https://${host}/v2/location/${i.locationId}/integration/${appId}` : '(no appId!)';
    console.log(`\n${i.locationId} (${i.companyName || '?'})`);
    console.log(`  installedVersion : ${v || 'NULL'}`);
    console.log(`  whitelabel       : ${i.isWhitelabelCompany ? 'yes' : 'no'}  domain=${JSON.stringify(i.whitelabelDetails?.domain)}`);
    console.log(`  banner           : ${flagged ? 'YES (flagged ' + flagged.versionId + ')' : 'no'}`);
    console.log(`  reconnectUrl     : ${url}`);
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

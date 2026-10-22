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
    .select('locationId companyName versionId rawWebhookData.versionId')
    .lean();
  console.log('\n=== Active installs (versionId) ===');
  for (const i of installs) {
    const v = i.versionId || i.rawWebhookData?.versionId || null;
    const flagged = vcs.find((c) => c.forceReconnect && c.versionId !== v);
    console.log(`${i.locationId} (${i.companyName || '?'}): installedVersion=${v || 'NULL'} → banner=${flagged ? 'YES (' + flagged.versionId + ')' : 'no'}`);
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

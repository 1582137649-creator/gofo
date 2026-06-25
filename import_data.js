// import_data.js — 将 dashboard_data.json 导入 Supabase
// 使用前：先在 Supabase SQL Editor 执行 supabase_init.sql 建表
// 运行：node import_data.js

const fs = require('fs');
const https = require('https');
const path = require('path');

const SUPABASE_URL = 'fgibhpggdmimxjknqqah.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7UouyWr5_y64QwrVd8qFig_8H3H0jt5';

// Read source data
const dataPath = path.join(__dirname, '..', '2026-06-24-19-18-58', 'dashboard_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const records = data.records;

console.log(`Total records to import: ${records.length}`);

function insertBatch(rows) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows.map(r => ({
      period: r.period,
      region: r.region,
      level4: r.level4 || '',
      level5: r.level5 || '',
      vendor: r.vendor,
      payment: r.payment,
      hours: r.hours
    })));

    const req = https.request({
      hostname: SUPABASE_URL,
      path: '/rest/v1/dashboard_data',
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer': 'return=minimal'
      }
    }, (res) => {
      let respBody = '';
      res.on('data', c => respBody += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(rows.length);
        } else {
          console.error(`  HTTP ${res.statusCode}: ${respBody}`);
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function importAll() {
  const BATCH_SIZE = 100;
  let imported = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    try {
      const count = await insertBatch(batch);
      imported += count;
      const pct = Math.round(imported / records.length * 100);
      process.stdout.write(`\r  Importing... ${imported}/${records.length} (${pct}%)`);
    } catch (err) {
      failed += batch.length;
      console.error(`\n  Batch failed at offset ${i}: ${err.message}`);
    }
  }

  console.log(`\n\nDone! Imported: ${imported}, Failed: ${failed}`);
  if (failed > 0) {
    console.log('Tips: Make sure you ran supabase_init.sql in Supabase SQL Editor first.');
  }
}

importAll().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

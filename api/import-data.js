// ============================================================
// POST /api/import-data
// 清空 dashboard_data 表并导入模板中的 882 条完整数据
// 需要 setup_key 验证
// ============================================================
const fs = require('fs');
const path = require('path');
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fgibhpggdmimxjknqqah.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_7UouyWr5_y64QwrVd8qFig_8H3H0jt5';
const SUPABASE_HOST = SUPABASE_URL ? new URL(SUPABASE_URL).hostname : '';
const SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'bp2026ziwei';

function supabaseRequest(reqPath, method, body) {
  return new Promise((resolve, reject) => {
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Prefer'] = 'return=representation';
      headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }

    const r = https.request({
      hostname: SUPABASE_HOST,
      path: reqPath,
      method: method,
      headers: headers,
      timeout: 10000,
    }, (resp) => {
      let b = '';
      resp.on('data', c => b += c);
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, data: JSON.parse(b) }); }
        catch (e) { resolve({ status: resp.statusCode, data: b }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('Supabase request timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function loadRecordsFromDataJS() {
  const dataPath = path.join(process.cwd(), 'lib', 'data.js');
  const content = fs.readFileSync(dataPath, 'utf-8');
  const match = content.match(/const TEMPLATE_RECORDS\s*=\s*(\[.*?\]);/s);
  if (!match) throw new Error('TEMPLATE_RECORDS not found in lib/data.js');
  return JSON.parse(match[1]);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  var providedKey = req.method === 'POST' ? (req.body && req.body.setup_key) : (req.query && req.query.setup_key);
  if (providedKey !== SETUP_KEY) {
    return res.status(403).json({ error: 'Invalid setup_key' });
  }

  try {
    // Step 1: Load records from lib/data.js
    var records = loadRecordsFromDataJS();
    console.log('[import-data] Loaded', records.length, 'records from lib/data.js');

    // Step 2: Delete all existing records
    var deleteResult = await supabaseRequest('/rest/v1/dashboard_data?id=gt.0', 'DELETE');
    console.log('[import-data] Delete result:', deleteResult.status);

    // Step 3: Insert records in batches of 100
    var batchSize = 100;
    var inserted = 0;
    var errors = [];

    for (var i = 0; i < records.length; i += batchSize) {
      var batch = records.slice(i, i + batchSize);
      var insertResult = await supabaseRequest('/rest/v1/dashboard_data', 'POST', batch);

      if (insertResult.status >= 200 && insertResult.status < 300) {
        inserted += batch.length;
      } else {
        errors.push({
          batch: Math.floor(i / batchSize) + 1,
          status: insertResult.status,
          error: insertResult.data,
        });
      }
    }

    // Step 4: Verify by counting
    var countResult = await supabaseRequest('/rest/v1/dashboard_data?select=id&limit=1', 'GET', null);
    // Get count via prefer header
    var countResp = await new Promise((resolve, reject) => {
      var r = https.request({
        hostname: SUPABASE_HOST,
        path: '/rest/v1/dashboard_data?select=id',
        method: 'GET',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + SUPABASE_KEY,
          'Prefer': 'count=exact',
          'Range': '0-0',
        },
        timeout: 10000,
      }, (resp) => {
        var range = resp.headers['content-range'] || '';
        var b = '';
        resp.on('data', c => b += c);
        resp.on('end', () => {
          resolve({ range: range, status: resp.statusCode });
        });
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('count timeout')); });
      r.end();
    });

    var totalCount = 0;
    if (countResp.range) {
      var m = countResp.range.match(/\/(\d+)/);
      if (m) totalCount = parseInt(m[1]);
    }

    return res.json({
      success: true,
      message: 'Import complete',
      records_loaded: records.length,
      records_inserted: inserted,
      errors: errors,
      total_in_table: totalCount,
    });

  } catch (e) {
    console.error('[import-data] Error:', e);
    return res.status(500).json({ error: e.message });
  }
};

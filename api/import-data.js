// ============================================================
// POST /api/import-data  (also supports GET with query params)
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
      timeout: 15000,
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

async function countRecords() {
  var resp = await supabaseRequest('/rest/v1/dashboard_data?select=id', 'GET', null);
  // PostgREST returns content-range header; body is the data array
  // If body is an array, count is its length (but may be capped at 1000)
  // Use content-range for exact count
  return resp;
}

async function getAllIds() {
  var allIds = [];
  var offset = 0;
  while (true) {
    var result = await supabaseRequest(
      '/rest/v1/dashboard_data?select=id&order=id.asc&limit=1000&offset=' + offset,
      'GET', null
    );
    if (result.status !== 200 || !Array.isArray(result.data) || result.data.length === 0) break;
    allIds = allIds.concat(result.data.map(function(r) { return r.id; }));
    if (result.data.length < 1000) break;
    offset += 1000;
  }
  return allIds;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var providedKey = req.method === 'POST' ? (req.body && req.body.setup_key) : (req.query && req.query.setup_key);
  if (providedKey !== SETUP_KEY) {
    return res.status(403).json({ error: 'Invalid setup_key' });
  }

  try {
    // Step 1: Load records from lib/data.js
    var records = loadRecordsFromDataJS();

    // Step 2: Get all existing record IDs
    var existingIds = await getAllIds();

    // Step 3: Delete in batches of 100 IDs using id=in.(...) filter
    var deletedCount = 0;
    var deleteErrors = [];
    for (var d = 0; d < existingIds.length; d += 100) {
      var idBatch = existingIds.slice(d, d + 100);
      var idFilter = 'id=in.(' + idBatch.join(',') + ')';
      var batchResult = await supabaseRequest('/rest/v1/dashboard_data?' + idFilter, 'DELETE');
      if (batchResult.status >= 200 && batchResult.status < 300) {
        deletedCount += idBatch.length;
      } else {
        deleteErrors.push({ batch: Math.floor(d / 100) + 1, status: batchResult.status });
      }
    }

    // Step 4: Verify deletion
    var remainingIds = await getAllIds();

    // Step 5: Insert records in batches of 100
    var batchSize = 100;
    var inserted = 0;
    var insertErrors = [];
    for (var i = 0; i < records.length; i += batchSize) {
      var batch = records.slice(i, i + batchSize);
      var insertResult = await supabaseRequest('/rest/v1/dashboard_data', 'POST', batch);
      if (insertResult.status >= 200 && insertResult.status < 300) {
        inserted += batch.length;
      } else {
        insertErrors.push({ batch: Math.floor(i / batchSize) + 1, status: insertResult.status, error: insertResult.data });
      }
    }

    // Step 6: Final count
    var finalIds = await getAllIds();

    return res.json({
      success: true,
      message: 'Import complete',
      records_loaded: records.length,
      records_inserted: inserted,
      insert_errors: insertErrors,
      diagnostics: {
        existing_before_delete: existingIds.length,
        deleted: deletedCount,
        delete_errors: deleteErrors,
        remaining_after_delete: remainingIds.length,
        final_count: finalIds.length,
      },
    });

  } catch (e) {
    console.error('[import-data] Error:', e);
    return res.status(500).json({ error: e.message });
  }
};

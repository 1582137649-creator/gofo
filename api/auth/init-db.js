// ============================================================
// POST /api/auth/init-db
// 初始化 bp_permissions 表并写入默认管理员
// 需要 Setup Key 验证
// ============================================================
const jwt = require('jsonwebtoken');
const https = require('https');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : '';

function supabaseRequest(reqPath, method, body) {
  return new Promise((resolve, reject) => {
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }
    if (method === 'PATCH') headers['Prefer'] = 'return=representation';
    if (method === 'POST') headers['Prefer'] = 'return=representation';

    const r = https.request({ hostname: supabaseHost, path: reqPath, method, headers, timeout: 3000 }, (resp) => {
      let b = '';
      resp.on('data', c => b += c);
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, data: JSON.parse(b) }); }
        catch (e) { resolve({ status: resp.statusCode, data: b }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('Supabase request timeout (3s)')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // GET: support initialization via query params (for easy browser access)
  if (req.method === 'GET') {
    const setupKey = req.query.setup_key;
    const expectedKey = process.env.ADMIN_SETUP_KEY || 'bp2026admin';

    // If no setup_key, return instructions
    if (!setupKey) {
      return res.json({
        message: 'Add ?setup_key=YOUR_KEY to initialize bp_permissions table via GET, or POST with setup_key in body',
        sql: `-- Execute in Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS bp_permissions (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bp_permissions_key ON bp_permissions (key);
INSERT INTO bp_permissions (key, value) VALUES
  ('admin_open_ids', '[]'::jsonb),
  ('region_permissions', '{"MS中南大区":[],"WE美西大区":[],"TX德州大区":[],"NE东北大区":[],"GL大湖大区":[],"Ground项目部":[]}'::jsonb)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE bp_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read on bp_permissions" ON bp_permissions FOR SELECT USING (true);
CREATE POLICY "Allow anon insert on bp_permissions" ON bp_permissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update on bp_permissions" ON bp_permissions FOR UPDATE USING (true);
CREATE POLICY "Allow anon delete on bp_permissions" ON bp_permissions FOR DELETE USING (true);`
      });
    }

    // Verify setup key
    if (setupKey !== expectedKey) {
      return res.status(403).json({ error: 'Setup key 错误' });
    }

    // Use query params as body
    req.body = {
      setup_key: setupKey,
      admin_open_ids: req.query.admin_open_ids ? JSON.parse(req.query.admin_open_ids) : [],
      region_permissions: req.query.region_permissions ? JSON.parse(req.query.region_permissions) : {
        'MS中南大区': [], 'WE美西大区': [], 'TX德州大区': [],
        'NE东北大区': [], 'GL大湖大区': [], 'Ground项目部': []
      }
    };
    // Fall through to POST logic below
  }

  try {
    // Verify setup key
    const { setup_key } = req.body || {};
    const expectedKey = process.env.ADMIN_SETUP_KEY || 'bp2026admin';
    if (!setup_key || setup_key !== expectedKey) {
      return res.status(403).json({ error: 'Setup key 错误' });
    }

    // Try to insert default data (will fail if table doesn't exist)
    const adminOpenIds = req.body.admin_open_ids || [];
    const regionPerms = req.body.region_permissions || {
      'MS中南大区': [], 'WE美西大区': [], 'TX德州大区': [],
      'NE东北大区': [], 'GL大湖大区': [], 'Ground项目部': []
    };

    // Try POST (insert) first
    const insertResult = await supabaseRequest('/rest/v1/bp_permissions', 'POST', [
      { key: 'admin_open_ids', value: adminOpenIds },
      { key: 'region_permissions', value: regionPerms }
    ]);

    if (insertResult.status === 201) {
      return res.json({ success: true, message: 'bp_permissions 表初始化成功！', data: insertResult.data });
    }

    // If insert fails (table might exist with data), try PATCH
    if (insertResult.status === 409) {
      // Update existing records
      await supabaseRequest('/rest/v1/bp_permissions?key=eq.admin_open_ids', 'PATCH', { value: adminOpenIds });
      await supabaseRequest('/rest/v1/bp_permissions?key=eq.region_permissions', 'PATCH', { value: regionPerms });
      return res.json({ success: true, message: 'bp_permissions 表已更新！' });
    }

    // Table doesn't exist — return SQL for manual execution
    return res.json({
      success: false,
      message: 'bp_permissions 表不存在，请在 Supabase SQL Editor 中执行以下 SQL',
      supabase_sql_editor: 'https://supabase.com/dashboard/project/fgibhpggdmimxjknqqah/sql/new',
      sql: `CREATE TABLE IF NOT EXISTS bp_permissions (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bp_permissions_key ON bp_permissions (key);
INSERT INTO bp_permissions (key, value) VALUES
  ('admin_open_ids', '${JSON.stringify(adminOpenIds)}'::jsonb),
  ('region_permissions', '${JSON.stringify(regionPerms)}'::jsonb)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE bp_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read on bp_permissions" ON bp_permissions FOR SELECT USING (true);
CREATE POLICY "Allow anon insert on bp_permissions" ON bp_permissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update on bp_permissions" ON bp_permissions FOR UPDATE USING (true);
CREATE POLICY "Allow anon delete on bp_permissions" ON bp_permissions FOR DELETE USING (true);`,
      error_detail: insertResult.data
    });

  } catch (err) {
    console.error('Init DB error:', err);
    return res.status(500).json({ error: `Init failed: ${err.message}` });
  }
};

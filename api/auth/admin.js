// ============================================================
// /api/auth/admin — 管理员权限配置 API
// GET:  读取所有权限配置
// POST: 更新权限配置（仅 admin）
// ============================================================
const jwt = require('jsonwebtoken');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : '';

function supabaseFetch(path, method, body) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }
    if (method === 'PATCH') headers['Prefer'] = 'return=representation';
    const r = https.request({ hostname: supabaseHost, path, method, headers }, (resp) => {
      let b = '';
      resp.on('data', c => b += c);
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, data: JSON.parse(b) }); }
        catch (e) { resolve({ status: resp.statusCode, data: b }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function checkAdmin(req) {
  const authHeader = req.headers.authorization || '';
  const token = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '').trim();
  if (!token) return null;
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    if (user.role !== 'admin') return null;
    return user;
  } catch (e) { return null; }
}

async function loadPermissions() {
  const result = await supabaseFetch('/rest/v1/bp_permissions?select=key,value', 'GET');
  const rows = Array.isArray(result.data) ? result.data : [];
  const perms = {};
  rows.forEach(r => { perms[r.key] = r.value; });
  return {
    admin_open_ids: perms.admin_open_ids || [],
    region_permissions: perms.region_permissions || {},
  };
}

async function savePermission(key, value) {
  return supabaseFetch(`/rest/v1/bp_permissions?key=eq.${key}`, 'PATCH', { value });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: 读取权限（公开，用于前端显示当前配置）
  if (req.method === 'GET') {
    try {
      const perms = await loadPermissions();
      return res.json(perms);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST: 更新权限（仅 admin）
  if (req.method === 'POST') {
    const adminUser = await checkAdmin(req);
    if (!adminUser) return res.status(403).json({ error: '仅管理员可修改权限' });

    try {
      const { admin_open_ids, region_permissions } = req.body || {};

      if (admin_open_ids !== undefined) {
        await savePermission('admin_open_ids', admin_open_ids);
      }
      if (region_permissions !== undefined) {
        await savePermission('region_permissions', region_permissions);
      }

      return res.json({ success: true, message: '权限已更新' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

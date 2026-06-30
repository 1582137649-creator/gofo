// ============================================================
// POST /api/auth/setup
// 自服务管理员开通：用户登录后提供 setup_key，通过验证后设为 admin
// ============================================================
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Validate JWT token
    const authHeader = req.headers.authorization || '';
    const token = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '').trim();
    if (!token) return res.status(401).json({ error: '未登录，请先飞书授权登录' });

    const jwtSecret = process.env.JWT_SECRET;
    let user;
    try {
      user = jwt.verify(token, jwtSecret);
    } catch (e) {
      return res.status(401).json({ error: 'Token 无效或已过期，请重新登录' });
    }

    // 2. Check setup key
    const { setup_key } = req.body || {};
    const expectedKey = process.env.ADMIN_SETUP_KEY || 'bp2026admin';

    if (!setup_key || setup_key !== expectedKey) {
      return res.status(403).json({ error: 'Setup key 错误' });
    }

    // 3. Read current admin list from Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    const existing = await new Promise((resolve, reject) => {
      const https = require('https');
      const r = https.request({
        hostname: new URL(supabaseUrl).hostname,
        path: '/rest/v1/bp_permissions?key=eq.admin_open_ids&select=value',
        method: 'GET',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      }, (resp) => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => {
          try {
            const arr = JSON.parse(body);
            resolve(arr.length > 0 ? arr[0].value : []);
          } catch (e) { resolve([]); }
        });
      });
      r.on('error', reject);
      r.end();
    });

    const adminList = Array.isArray(existing) ? existing : [];
    if (adminList.includes(user.open_id)) {
      return res.json({ success: true, message: '你已经是管理员了', admin: true });
    }

    // 4. Add user to admin list
    adminList.push(user.open_id);

    await new Promise((resolve, reject) => {
      const https = require('https');
      const body = JSON.stringify({ value: adminList });
      const r = https.request({
        hostname: new URL(supabaseUrl).hostname,
        path: '/rest/v1/bp_permissions?key=eq.admin_open_ids',
        method: 'PATCH',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (resp) => {
        let b = '';
        resp.on('data', c => b += c);
        resp.on('end', () => resolve(resp.statusCode));
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    return res.json({ success: true, message: `管理员权限已开通！(${user.name || user.open_id})`, admin: true, open_id: user.open_id });

  } catch (err) {
    console.error('Setup error:', err);
    return res.status(500).json({ error: `Setup failed: ${err.message}` });
  }
};

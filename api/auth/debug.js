// api/auth/debug.js — 诊断工具：检查飞书SSO配置状态
const https = require('https');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  const result = { timestamp: new Date().toISOString() };

  // 1. Check env vars (mask secrets)
  result.env = {
    FEISHU_APP_ID: process.env.FEISHU_APP_ID ? process.env.FEISHU_APP_ID.substring(0, 8) + '...' : 'MISSING',
    FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET ? '***set***' : 'MISSING',
    FEISHU_REDIRECT_URI: process.env.FEISHU_REDIRECT_URI || 'MISSING',
    JWT_SECRET: process.env.JWT_SECRET ? '***set***' : 'MISSING',
    FRONTEND_URL: process.env.FRONTEND_URL || 'MISSING',
  };

  // 2. Check permissions.json
  try {
    const permPath = path.join(process.cwd(), 'permissions.json');
    const perms = JSON.parse(fs.readFileSync(permPath, 'utf-8'));
    result.permissions = {
      found: true,
      cwd: process.cwd(),
      path: permPath,
      admin_count: (perms.admin_open_ids || []).length,
      region_count: Object.keys(perms.region_permissions || {}).length,
      has_users: Object.values(perms.region_permissions || {}).some(a => a.length > 0),
    };
  } catch (e) {
    result.permissions = { found: false, cwd: process.cwd(), error: e.message };
  }

  // 3. Test Feishu app access token
  try {
    const appTokenResult = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        app_id: process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET,
      });
      const r = https.request({
        hostname: 'open.feishu.cn',
        path: '/open-apis/auth/v3/app_access_token/internal',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      }, (resp) => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => resolve(JSON.parse(body)));
      });
      r.on('error', reject);
      r.write(postData);
      r.end();
    });
    result.feishu_api = { code: appTokenResult.code, msg: appTokenResult.msg || appTokenResult.message };
  } catch (e) {
    result.feishu_api = { error: e.message };
  }

  res.json(result);
};

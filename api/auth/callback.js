// api/auth/callback.js — 飞书 OAuth 回调 → JWT 签发
const jwt = require('jsonwebtoken');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ==================== Permission Loading ====================
// Priority: Supabase (dynamic) > permissions.json (static fallback)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : '';

let permissionsCache = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds

async function getPermissions() {
  // Try Supabase first
  if (supabaseHost && supabaseKey) {
    try {
      if (permissionsCache && (Date.now() - cacheTime) < CACHE_TTL) {
        return permissionsCache;
      }
      const perms = await fetchPermissionsFromSupabase();
      permissionsCache = perms;
      cacheTime = Date.now();
      return perms;
    } catch (e) {
      console.warn('Supabase permissions fetch failed, falling back to file:', e.message);
    }
  }
  // Fallback: permissions.json
  return getPermissionsFromFile();
}

function fetchPermissionsFromSupabase() {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: supabaseHost,
      path: '/rest/v1/bp_permissions?select=key,value',
      method: 'GET',
      timeout: 3000,
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    }, (resp) => {
      let body = '';
      resp.on('data', c => body += c);
      resp.on('end', () => {
        try {
          const rows = JSON.parse(body);
          const perms = {};
          rows.forEach(row => { perms[row.key] = row.value; });
          resolve({
            admin_open_ids: perms.admin_open_ids || [],
            region_permissions: perms.region_permissions || {},
          });
        } catch (e) {
          reject(new Error('Invalid Supabase response'));
        }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('Supabase request timeout (3s)')); });
    r.end();
  });
}

let filePermissions = null;
function getPermissionsFromFile() {
  if (!filePermissions) {
    try {
      const permPath = path.join(process.cwd(), 'permissions.json');
      filePermissions = JSON.parse(fs.readFileSync(permPath, 'utf-8'));
    } catch (e) {
      console.warn('permissions.json not found, using empty defaults');
      filePermissions = { admin_open_ids: [], region_permissions: {} };
    }
  }
  return filePermissions;
}

// Get Feishu app access token (cached in module scope)
let appAccessToken = null;
let appTokenExpiresAt = 0;

function getAppAccessToken() {
  return new Promise((resolve, reject) => {
    if (appAccessToken && Date.now() < appTokenExpiresAt - 60000) {
      return resolve(appAccessToken);
    }

    const postData = JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    });

    const req = https.request(
      {
        hostname: 'open.feishu.cn',
        path: '/open-apis/auth/v3/app_access_token/internal',
        method: 'POST',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (resp) => {
        let body = '';
        resp.on('data', (chunk) => (body += chunk));
        resp.on('end', () => {
          const data = JSON.parse(body);
          if (data.code !== 0) return reject(new Error(`Feishu token error: ${data.msg || data.message}`));
          appAccessToken = data.app_access_token;
          appTokenExpiresAt = Date.now() + data.expire * 1000;
          resolve(appAccessToken);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Feishu app_token request timeout (5s)')); });
    req.write(postData);
    req.end();
  });
}

// Get user info from Feishu
function getFeishuUserInfo(userAccessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'open.feishu.cn',
        path: '/open-apis/authen/v1/user_info',
        method: 'GET',
        timeout: 5000,
        headers: { Authorization: `Bearer ${userAccessToken}` },
      },
      (resp) => {
        let body = '';
        resp.on('data', (chunk) => (body += chunk));
        resp.on('end', () => {
          const data = JSON.parse(body);
          if (data.code !== 0) return reject(new Error(`Feishu user info error: ${data.msg || data.message}`));
          resolve(data.data);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Feishu user_info request timeout (5s)')); });
    req.end();
  });
}

// Resolve user role and allowed pages
async function getRoleAndPages(openId, unionId) {
  const perms = await getPermissions();
  const adminOpenIds = perms.admin_open_ids || [];
  const regionPerms = perms.region_permissions || {};

  // Map region names to page keys
  const regionPageMap = {
    'MS中南大区': 'ms_central',
    'WE美西大区': 'we_west',
    'TX德州大区': 'tx_texas',
    'NE东北大区': 'ne_northeast',
    'GL大湖大区': 'gl_lakes',
    'FL佛州大区': 'fl_florida',
    'PR波多黎各区': 'pr_puerto_rico',
    'Ground项目部': 'ground',
  };

  // Check both open_id and union_id against admin list
  const allIds = [openId, unionId].filter(Boolean);
  const isAdmin = allIds.some(id => adminOpenIds.includes(id));

  if (isAdmin) {
    return {
      role: 'admin',
      regions: ['all'],
      pages: ['summary'].concat(Object.values(regionPageMap)),
    };
  }

  const assignedRegions = [];
  for (const [region, ids] of Object.entries(regionPerms)) {
    if (allIds.some(id => ids.includes(id))) {
      assignedRegions.push(region);
    }
  }

  if (assignedRegions.length > 0) {
    return {
      role: 'region_bp',
      regions: assignedRegions,
      pages: assignedRegions.map((r) => regionPageMap[r] || r),
    };
  }

  return { role: 'unauthorized', regions: [], pages: [] };
}

module.exports = async (req, res) => {
  const { code, state } = req.query;

  // Validate state (CSRF)
  const cookies = req.headers.cookie || '';
  const stateMatch = cookies.match(/oauth_state=([^;]+)/);
  const savedState = stateMatch ? stateMatch[1] : null;
  if (!state || !savedState || state !== savedState) {
    return res.status(403).json({ error: 'Invalid state (CSRF check failed)' });
  }

  try {
    // Step 1: Exchange code for user_access_token
    const appToken = await getAppAccessToken();
    const body = JSON.stringify({
      grant_type: 'authorization_code',
      code: code,
    });

    const tokenResult = await new Promise((resolve, reject) => {
      const r = https.request(
        {
          hostname: 'open.feishu.cn',
          path: '/open-apis/authen/v1/oidc/access_token',
          method: 'POST',
          timeout: 5000,
          headers: {
            Authorization: `Bearer ${appToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (resp) => {
          let b = '';
          resp.on('data', (c) => (b += c));
          resp.on('end', () => {
            const d = JSON.parse(b);
            if (d.code !== 0) return reject(new Error(`Token exchange error: ${d.msg || d.message}`));
            resolve(d.data);
          });
        }
      );
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Feishu token exchange timeout (5s)')); });
      r.write(body);
      r.end();
    });

    // Step 2: Get user info
    const userInfo = await getFeishuUserInfo(tokenResult.access_token);
    const openId = userInfo.open_id || userInfo.union_id;
    const unionId = userInfo.union_id || openId;
    const userName = userInfo.name || openId;

    // Step 3: Resolve role and pages (check both open_id and union_id)
    const auth = await getRoleAndPages(openId, unionId);

    // Step 4: Sign JWT
    const jwtPayload = {
      open_id: openId,
      union_id: unionId,
      name: userName,
      role: auth.role,
      regions: auth.regions,
      pages: auth.pages,
    };

    const jwtSecret = process.env.JWT_SECRET;
    const jwtExpiresIn = parseInt(process.env.JWT_EXPIRES_IN || '604800', 10);
    const token = jwt.sign(jwtPayload, jwtSecret, { expiresIn: jwtExpiresIn });

    // Step 5: Set JWT cookie + 302 redirect to /
    // Cookie approach is the most reliable across all Vercel serverless environments
    // No HTML relay page, no URL hash — just a plain HTTP redirect with a cookie
    const jwtExpiresInSeconds = parseInt(process.env.JWT_EXPIRES_IN || '604800', 10);

    // Clear CSRF state cookie; set JWT as non-HttpOnly cookie so frontend JS can read it
    res.setHeader('Set-Cookie', [
      'oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      `bp_jwt_token=${token}; Path=/; SameSite=Lax; Max-Age=${jwtExpiresInSeconds}`,
    ]);

    // Plain 302 redirect to root — no hash, no relay page
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.status(500).json({ error: `OAuth failed: ${err.message}` });
  }
};

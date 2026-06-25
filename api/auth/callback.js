// api/auth/callback.js — 飞书 OAuth 回调 → JWT 签发
const jwt = require('jsonwebtoken');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load permissions config (with fallback for serverless)
let permissions = null;
function getPermissions() {
  if (!permissions) {
    try {
      const permPath = path.join(process.cwd(), 'permissions.json');
      permissions = JSON.parse(fs.readFileSync(permPath, 'utf-8'));
    } catch (e) {
      console.warn('permissions.json not found, using empty defaults');
      permissions = { admin_open_ids: [], region_permissions: {} };
    }
  }
  return permissions;
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
    req.end();
  });
}

// Resolve user role and allowed pages
function getRoleAndPages(openId) {
  const perms = getPermissions();
  const adminOpenIds = perms.admin_open_ids || [];
  const regionPerms = perms.region_permissions || {};

  // Map region names to page keys
  const regionPageMap = {
    'MS中南大区': 'ms_central',
    'WE美西大区': 'we_west',
    'TX德州大区': 'tx_texas',
    'NE东北大区': 'ne_northeast',
    'GL大湖大区': 'gl_lakes',
    'Ground项目部': 'ground',
  };

  if (adminOpenIds.includes(openId)) {
    return {
      role: 'admin',
      regions: ['all'],
      pages: ['summary'].concat(Object.values(regionPageMap)),
    };
  }

  const assignedRegions = [];
  for (const [region, ids] of Object.entries(regionPerms)) {
    if (ids.includes(openId)) {
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
      r.write(body);
      r.end();
    });

    // Step 2: Get user info
    const userInfo = await getFeishuUserInfo(tokenResult.access_token);
    const openId = userInfo.open_id || userInfo.union_id;
    const userName = userInfo.name || openId;

    // Step 3: Resolve role and pages
    const auth = getRoleAndPages(openId);

    // Step 4: Sign JWT
    const jwtPayload = {
      open_id: openId,
      name: userName,
      role: auth.role,
      regions: auth.regions,
      pages: auth.pages,
    };

    const jwtSecret = process.env.JWT_SECRET;
    const jwtExpiresIn = parseInt(process.env.JWT_EXPIRES_IN || '604800', 10);
    const token = jwt.sign(jwtPayload, jwtSecret, { expiresIn: jwtExpiresIn });

    // Step 5: Redirect back to frontend with JWT (relative path, avoids env var issues)
    const isProd = process.env.VERCEL_ENV === 'production';

    // Clear state cookie
    res.setHeader('Set-Cookie', `oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; ${isProd ? 'Secure;' : ''}`);

    // Redirect to root with JWT in hash (stays on same domain)
    res.writeHead(302, {
      Location: `/#token=${token}`,
    });
    res.end();
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.status(500).json({ error: `OAuth failed: ${err.message}` });
  }
};

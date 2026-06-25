// api/auth/feishu.js — 飞书 OAuth 重定向
const crypto = require('crypto');

module.exports = async (req, res) => {
  const appId = process.env.FEISHU_APP_ID;
  const redirectUri = process.env.FEISHU_REDIRECT_URI;
  if (!appId || !redirectUri) {
    return res.status(500).json({ error: 'Server misconfigured: missing FEISHU_APP_ID or FEISHU_REDIRECT_URI' });
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=contact:user.id:readonly`;

  // Set state cookie for CSRF protection (httpOnly, sameSite lax, secure)
  const isProd = process.env.VERCEL_ENV === 'production';
  res.setHeader('Set-Cookie', `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600; ${isProd ? 'Secure;' : ''}`);

  // Vercel edge: redirect
  res.writeHead(302, { Location: authUrl });
  res.end();
};

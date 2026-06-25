/**
 * auth-guard.js — BP Dashboard 通用权限拦截脚本
 *
 * 使用方法：
 *   在每个 HTML 页面的 <head> 最顶部（其他 script 之前）引入：
 *   <script src="auth-guard.js"></script>
 *
 * 依赖：
 *   - 后端服务已启动，API_BASE 指向正确的地址
 *   - login.html 已部署到 GitHub Pages
 *
 * 约定：
 *   - token 存 localStorage key: "bp_token"
 *   - 用户信息存 localStorage key: "bp_user"
 *
 * 暴露给页面：
 *   - window.BP_AUTH.user      当前用户信息 { open_id, name, role, regions, pages }
 *   - window.BP_AUTH.hasAccess(pageKey)  检查是否可访问某个页面
 *   - window.BP_AUTH.logout()          登出
 */

(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // 配置 — 部署时修改为实际后端地址
  // -----------------------------------------------------------------------
  var API_BASE = 'https://bpdashboard.loca.lt';
  var LOGIN_PAGE = './login.html';

  // -----------------------------------------------------------------------
  // 区域 key → 页面关键字映射（与后端 REGION_PAGE_MAP 保持一致）
  // -----------------------------------------------------------------------
  var REGION_KEY_MAP = {
    '华东': 'east_china',
    '华南': 'south_china',
    '华北': 'north_china',
    '华中': 'central_china',
    '西南': 'southwest',
    '西北': 'northwest',
    '东北': 'northeast',
  };

  // -----------------------------------------------------------------------
  // 当前页面的区域 key — 各页面在引入脚本前设定
  // 例如: <script>window.__PAGE_REGION__ = 'east_china';</script>
  // dashboard / summary 页面设为 null
  // -----------------------------------------------------------------------
  var pageRegion = window.__PAGE_REGION__ || null;

  // -----------------------------------------------------------------------
  // 暴露的全局对象
  // -----------------------------------------------------------------------
  var BP_AUTH = {
    user: null,
    hasAccess: hasAccess,
    logout: logout,
  };

  function hasAccess(pageKey) {
    if (!BP_AUTH.user) return false;
    if (BP_AUTH.user.role === 'admin') return true;
    return BP_AUTH.user.pages && BP_AUTH.user.pages.indexOf(pageKey) !== -1;
  }

  function logout() {
    localStorage.removeItem('bp_token');
    localStorage.removeItem('bp_user');
    window.location.replace(LOGIN_PAGE);
  }

  // -----------------------------------------------------------------------
  // 主流程
  // -----------------------------------------------------------------------
  async function init() {
    // 1) 检查 token
    var token = localStorage.getItem('bp_token');
    if (!token) {
      redirectToLogin();
      return;
    }

    // 2) 校验 token → 获取用户信息
    var user = null;
    try {
      var res = await fetch(API_BASE + '/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token },
      });

      if (res.status === 401) {
        localStorage.removeItem('bp_token');
        localStorage.removeItem('bp_user');
        redirectToLogin();
        return;
      }

      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }

      user = await res.json();
    } catch (err) {
      // 后端不可达 — 尝试用缓存
      console.warn('[auth-guard] 后端不可达，使用缓存:', err.message);
      var cached = localStorage.getItem('bp_user');
      if (cached) {
        try { user = JSON.parse(cached); } catch (_) {}
      }
      if (!user) {
        redirectToLogin();
        return;
      }
    }

    // 3) 保存用户信息
    if (user) {
      localStorage.setItem('bp_user', JSON.stringify(user));
      BP_AUTH.user = user;
    }

    // 4) 权限校验 — 非 admin 用户检查是否能看当前页面
    if (user && user.role !== 'admin' && pageRegion) {
      if (!user.pages || user.pages.indexOf(pageRegion) === -1) {
        showNoAccessPage();
        return;
      }
    } else if (user && user.role === 'unauthorized') {
      showNoAccessPage();
      return;
    }

    // 5) 挂载到全局
    window.BP_AUTH = BP_AUTH;

    // 6) 触发自定义事件，页面可以监听此事件来加载数据
    var event = new CustomEvent('bp-auth-ready', { detail: user });
    document.dispatchEvent(event);
  }

  // -----------------------------------------------------------------------
  // 跳转登录页
  // -----------------------------------------------------------------------
  function redirectToLogin() {
    // 保存当前 URL，登录后回到这里
    window.location.replace(LOGIN_PAGE);
  }

  // -----------------------------------------------------------------------
  // 无权限页面
  // -----------------------------------------------------------------------
  function showNoAccessPage() {
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;' +
      'font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;background:#f3f4f6;">' +
      '<div style="text-align:center;background:#fff;padding:48px;border-radius:12px;' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:420px;">' +
      '<div style="font-size:48px;margin-bottom:16px;">🔒</div>' +
      '<h2 style="color:#1f2937;margin-bottom:8px;">暂无访问权限</h2>' +
      '<p style="color:#6b7280;font-size:14px;margin-bottom:24px;">' +
      '您没有此页面的访问权限，请联系管理员开通。</p>' +
      '<button onclick="localStorage.removeItem(\'bp_token\');' +
      'localStorage.removeItem(\'bp_user\');window.location.replace(\'' + LOGIN_PAGE + '\')" ' +
      'style="display:inline-block;padding:10px 24px;background:#3370ff;color:#fff;' +
      'border:none;border-radius:8px;font-size:14px;cursor:pointer;">' +
      '返回登录</button></div></div>';
  }

  // -----------------------------------------------------------------------
  // 启动
  // -----------------------------------------------------------------------
  init();
})();

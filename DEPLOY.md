# BP Dashboard — 飞书 SSO 部署指南

## 一、项目结构

```
.
├── server/                 # Node.js 后端
│   ├── index.js            # Express 主服务
│   ├── auth.js             # 飞书 OAuth + JWT
│   ├── permissions.json    # 权限配置
│   ├── package.json
│   └── .env                # 环境变量（从 .env.example 复制）
├── login.html              # 登录页（部署到 GitHub Pages）
├── auth-guard.js           # 通用权限拦截脚本（部署到 GitHub Pages）
├── DEPLOY.md               # 本文件
└── *.html                  # 9 个业务页面（已有）
```

## 二、飞书应用配置

### 2.1 创建应用
1. 打开 [飞书开放平台](https://open.feishu.cn/)
2. 创建「企业自建应用」
3. 进入应用 →「安全设置」→ 添加回调域名（你的穿透域名）
4. 进入「权限管理」→ 添加权限：
   - `contact:user.id:readonly` — 获取用户 ID
   - `contact:user.name:readonly` — 获取用户姓名（可选）
5. 发布应用并通过审核

### 2.2 获取凭证
- 在「凭证与基础信息」页面，复制 **App ID** 和 **App Secret**

## 三、环境变量配置

```bash
cd server
cp .env.example .env
```

编辑 `.env`：

```ini
FEISHU_APP_ID=cli_xxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
JWT_SECRET=自行生成一个32位以上的随机字符串
JWT_EXPIRES_IN=604800
PORT=3000
FRONTEND_URL=https://your-username.github.io
FEISHU_REDIRECT_URI=https://your-tunnel.cpolar.cn/api/auth/feishu/callback
```

> ⚠️ `FEISHU_REDIRECT_URI` 必须与飞书开放平台中配置的回调地址完全一致。

## 四、权限配置

编辑 `server/permissions.json`：

```json
{
  "admin_open_ids": ["ou_支持BP的openid"],
  "region_permissions": {
    "华东": ["ou_华东BP的openid"],
    "华南": ["ou_华南BP的openid"],
    "华北": ["ou_华北BP的openid"],
    "华中": ["ou_华中BP的openid"],
    "西南": ["ou_西南BP的openid"],
    "西北": ["ou_西北BP的openid"],
    "东北": ["ou_东北BP的openid"]
  }
}
```

### 如何获取用户的 open_id？
有三种方式：
1. **飞书管理后台** → 通讯录 → 用户详情页 → URL 中的 `user_id`
2. **让用户登录一次后**，查看服务端日志输出的 `open_id`
3. **飞书开放平台 API**：调用 `GET /open-apis/contact/v3/users` 批量获取

## 五、部署步骤

### 5.1 启动后端

```bash
cd server
npm install
npm start
```

看到以下输出表示启动成功：
```
[server] BP Dashboard Auth Server 已启动
[server] 端口: 3000
```

### 5.2 开启穿透（二选一）

**cpolar（推荐，免费）**
```bash
cpolar http 3000
```
记下输出的 `https://xxxx.cpolar.cn` 地址。

**ngrok**
```bash
ngrok http 3000
```

### 5.3 更新回调地址

1. 将穿透地址填入 `server/.env` 的 `FEISHU_REDIRECT_URI`
2. 将穿透地址填入飞书开放平台的「回调地址」
3. 重启后端：`Ctrl+C` 后重新 `npm start`

### 5.4 部署前端文件到 GitHub Pages

将以下文件放到 GitHub Pages 的仓库根目录：

- `login.html`
- `auth-guard.js`
- 9 个业务 HTML 页面

在 `login.html` 和 `auth-guard.js` 中，搜索 `__API_BASE__` 并替换为实际的后端地址。例如：

```html
<!-- login.html 中用 sed 替换 -->
<!-- 找到: var API_BASE = '__API_BASE__'; -->
<!-- 改为: var API_BASE = 'https://your-tunnel.cpolar.cn'; -->
```

### 5.5 各页面嵌入权限拦截

在每个业务 HTML 的 `<head>` 最顶部加入：

```html
<!-- 声明当前页面所属区域（dashboard/summary 页面不设此项） -->
<script>window.__PAGE_REGION__ = 'east_china';</script>
<!-- 加载权限拦截 -->
<script src="auth-guard.js"></script>
```

各页面的 `__PAGE_REGION__` 值：

| 页面 | `__PAGE_REGION__` |
|------|-------------------|
| summary.html | 不设（或 `null`） |
| dashboard.html | 不设（或 `null`） |
| east_china.html | `'east_china'` |
| south_china.html | `'south_china'` |
| north_china.html | `'north_china'` |
| central_china.html | `'central_china'` |
| southwest.html | `'southwest'` |
| northwest.html | `'northwest'` |
| northeast.html | `'northeast'` |

## 六、页面集成示例

以下是一个完整的区域页面模板（以华东为例）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>华东大区 Dashboard</title>

  <!-- ═══ 权限拦截（必须放在最前面）═══ -->
  <script>window.__PAGE_REGION__ = 'east_china';</script>
  <script src="auth-guard.js"></script>

  <script>
    // 等待权限校验完成后加载数据
    document.addEventListener('bp-auth-ready', function(e) {
      var user = e.detail;
      console.log('当前用户:', user.name, user.role);
      // 在这里加载你的业务数据
      loadDashboard();
    });
  </script>
</head>
<body>
  <!-- 你的业务内容 -->
</body>
</html>
```

## 七、API 接口说明

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/feishu` | GET | 302 跳转到飞书授权页 |
| `/api/auth/feishu/callback` | GET | 飞书回调，code → JWT → 302 回前端 |
| `/api/auth/me` | GET | 校验 JWT，返回用户信息和可访问页面列表 |
| `/api/health` | GET | 健康检查 |

请求 `/api/auth/me` 需带 header：`Authorization: Bearer <jwt_token>`

响应示例：

```json
{
  "open_id": "ou_xxx",
  "name": "张三",
  "role": "region_bp",
  "regions": ["华东"],
  "pages": ["summary", "dashboard", "east_china"]
}
```

## 八、常见问题

### 飞书回调失败：redirect_uri 不匹配
确保 `.env` 中 `FEISHU_REDIRECT_URI`、飞书开放平台回调地址、穿透域名三者一致。cpolar/ngrok 重启后地址会变，需要全部更新。

### 后端重启后用户需重新登录吗？
不需要。JWT 存在用户浏览器 localStorage 中，只要 JWT 未过期（默认 7 天），用户无需重新登录。

### 如何更新权限？
编辑 `server/permissions.json`，重启后端即可。用户下次请求 `/api/auth/me` 时会读到最新权限。

### 如何发布到正式环境？
推荐部署到 **Fly.io** 或 **Railway**（均有免费额度），获得固定域名后：
1. 将 `FRONTEND_URL` 和 `FEISHU_REDIRECT_URI` 更新为正式域名
2. 更新飞书开放平台回调地址
3. 更新 `login.html` 和 `auth-guard.js` 中的 `API_BASE`

## 九、安全建议

- JWT 密钥使用足够随机的字符串（`openssl rand -hex 32` 生成）
- 生产环境开启 HTTPS（Railway/Fly.io 自带）
- 定期审查 `permissions.json`，移除离职员工
- `admin_open_ids` 控制在最小范围以内

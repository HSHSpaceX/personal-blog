# 拾光手记

纯 HTML/CSS/JavaScript 的个人博客，正式站点及 canonical：<https://hsh-personal-blog.pages.dev/>。文章由 `js/posts.js` 维护，`node scripts/generate-site.mjs` 生成 `posts/<slug>.html`、sitemap、feed、robots 和浏览器公开配置 `js/config.js`。旧 `post.html?slug=...` 入口继续跳转到静态文章。搜索支持文章全文、动态与已审核公开评论。

本地预览：

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

配置入口是 `site.config.mjs`，集中定义 `SITE_BASE_URL`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`JOIN_REQUEST_URL`、`GITHUB_OWNER` 和 `GITHUB_REPO`。未填 Supabase 公共配置时，站点内容仍可阅读，用户写入不可用。**不要提交数据库密码、service_role key、用户密码或 GitHub PAT。**

登录采用邀请制 Supabase Auth；无公开注册。站长在 Dashboard 邀请账号并赋予 admin role。评论、点赞、关注、资料和头像由 Supabase RLS/Storage 管理；公开点赞／关注数经只返回计数的 RPC 读取，原始关系只对本人可见。旧评论可用脚本生成审阅后的 SQL 迁移。完整配置见 [Supabase 部署](docs/SUPABASE_SETUP.md) 和 [认证与 PAT](docs/AUTH_SETUP.md)。GitHub PAT 仅供管理员发布文章/动态/图库，**只在当前标签页临时 sessionStorage 中保存**；同标签页刷新/跳转可恢复，退出、切换账号或关闭标签页后清除。普通用户的 Community 投稿不需要 PAT。

本地检查：

```bash
node scripts/generate-site.mjs
node scripts/check-seo.mjs
node tests/search.test.cjs
node tests/ui.test.cjs
node tests/auth-policy.test.cjs
node tests/supply-chain.test.mjs
node scripts/check-secrets.mjs
node scripts/submit-indexnow.mjs --dry-run
git diff --check
```

GitHub Actions 的静态站生成工作流在主分支文章变更时自动更新静态文章、sitemap、feed；IndexNow 可在部署后手动运行，失败不影响部署。Bing 排查与待人工检查项见 [Bing 诊断](docs/BING_INDEX_DIAGNOSIS.md)。

安全关键第三方资源固定版本并本地存放在 `assets/vendor/`，完整性由测试验证。上线前应用第三份安全加固迁移；真实 Supabase RLS 验收使用两个普通账号和一个 admin，执行 `scripts/check-supabase-rls.mjs`，具体准备、环境变量和本地 PostgreSQL 验证见 [Supabase 部署](docs/SUPABASE_SETUP.md#上线前安全验收)。未配置项目时不能确认真实 RLS、SMTP 和邀请/恢复邮件流程。

Community V2 Round 1 的数据模型、权限、账号中心及独立测试项目验收见 [Community V2](docs/COMMUNITY_V2.md)。新增迁移尚需人工在测试项目验证；不自动修改生产 Supabase。

Community V2 Round 2 的投稿/审核、按用户与类型阈值、私有 Storage 和原生 PostgreSQL/DOM CI 见 [Round 2](docs/COMMUNITY_V2_ROUND2.md)。仅新增迁移，部署前需在独立测试 Supabase 项目验收。

Community V2 Round 3 的公开主页/RPC、评论编辑审核、完整个人资源中心和真实 Chromium 移动端测试见 [Round 3](docs/COMMUNITY_V2_ROUND3.md)。

Community V2 Round 4 的通知事件、一对一私信/图片、消息中心和 unread/Storage 权限见 [Round 4](docs/COMMUNITY_V2_ROUND4.md)。

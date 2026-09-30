# 拾光手记

纯 HTML/CSS/JavaScript 的个人博客，正式站点及 canonical：<https://hsh-personal-blog.pages.dev/>。文章由 `js/posts.js` 维护，`node scripts/generate-site.mjs` 生成 `posts/<slug>.html`、sitemap、feed、robots 和浏览器公开配置 `js/config.js`。旧 `post.html?slug=...` 入口继续跳转到静态文章。搜索支持文章全文、动态与已审核公开评论。

本地预览：

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

配置入口是 `site.config.mjs`，集中定义 `SITE_BASE_URL`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`JOIN_REQUEST_URL`、`GITHUB_OWNER` 和 `GITHUB_REPO`。未填 Supabase 公共配置时，站点内容仍可阅读，用户写入不可用。**不要提交数据库密码、service_role key、用户密码或 GitHub PAT。**

登录采用邀请制 Supabase Auth；无公开注册。站长在 Dashboard 邀请账号并赋予 admin role。评论、点赞、关注、资料和头像由 Supabase RLS/Storage 管理；公开点赞／关注数经只返回计数的 RPC 读取，原始关系只对本人可见。旧评论可用脚本生成审阅后的 SQL 迁移。完整配置见 [Supabase 部署](docs/SUPABASE_SETUP.md) 和 [认证与 PAT](docs/AUTH_SETUP.md)。GitHub PAT 仅供管理员发布文章/动态/图库，**只在当前页面内存中保存**；刷新、离开或退出后需重新输入。

本地检查：

```bash
node scripts/generate-site.mjs
node scripts/check-seo.mjs
node tests/search.test.cjs
node tests/auth-policy.test.cjs
node scripts/submit-indexnow.mjs --dry-run
git diff --check
```

GitHub Actions 的静态站生成工作流在主分支文章变更时自动更新静态文章、sitemap、feed；IndexNow 可在部署后手动运行，失败不影响部署。Bing 排查与待人工检查项见 [Bing 诊断](docs/BING_INDEX_DIAGNOSIS.md)。

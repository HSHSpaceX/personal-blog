# Bing 收录诊断（2026-09-30）

## 核查范围与线上访问限制

检查的基线是 `f42ec9e`（`main` 的当前检出内容）。仓库没有 `CNAME`、Cloudflare Pages 配置或 GitHub Pages 部署工作流，无法仅凭仓库确认实际部署渠道。原 `sitemap.xml` 使用 `https://hsh-personal-blog.pages.dev/`，而 README、feed 和旧 `js/sitemap.js` 使用 `https://hshspacex.github.io/personal-blog/`。本次修复暂以 sitemap 指向的 Pages 域名作为 `SITE_BASE_URL`；发布前必须核实实际正式域名及其重定向策略。

从当前云环境对上述两个 host 的首页、`robots.txt`、`sitemap.xml`、`BingSiteAuth.xml`、`feed.xml`、`archive.html`、`post.html`、`js/posts.js` 均发起了 HTTPS GET。每个请求都在出站代理的 CONNECT 阶段得到 `403 Forbidden`，没有取得源站响应。因此**未能核实**这些线上 URL 的 HTTP 状态、重定向、Content-Type、title、description、canonical、robots/noindex 或原始 HTML。代理 403 不是站点返回的 403。云环境草稿已加入两个域名的访问需求，但草稿不会即时改变当前实例。

当前 HEAD 的 `js/posts.js` 只有一篇真实文章：`post-austria-history`。尝试访问其两种可能的线上旧 URL：

- `https://hsh-personal-blog.pages.dev/post.html?slug=post-austria-history`
- `https://hshspacex.github.io/personal-blog/post.html?slug=post-austria-history`

这两项也被同一代理 403 阻断。**无法请求两篇真实文章**：当前 HEAD 只有一篇；旧 feed 中的四个 slug 不存在于当前文章数据，不能充作真实文章。新增第二篇真实文章后，应复查两篇静态文章的线上原始响应。

## A. 已从当前 HEAD 确认的问题

- 根目录缺少 `robots.txt`。
- sitemap 指向 Pages 域名，没有真实文章，却包含 `admin.html`、`login.html`、`search.html` 和重复首页 `index.html`；其中 admin/login 原始 HTML 已有 `noindex`。
- feed 指向 GitHub Pages，列出的四篇文章均不是当前 `js/posts.js` 中的文章。
- `js/sitemap.js` 只在浏览器内构造 XML 字符串，从未写出部署的 `sitemap.xml`。
- `post.html?slug=post-austria-history` 原始 HTML 只有通用 title/description，`#postTitle` 和 `#postContent` 为空；文章正文由 JS 注入。
- 首页、归档和时间线原始 HTML 都没有文章直达链接，链接由 JS 注入。
- 公开页面缺少 canonical；多数页面也缺少完整 OpenGraph 元数据。
- 当前仓库只有一篇真实文章，限制了多文章验证。

## B. 高度可疑、仍需线上证实的问题

- 两个 host 的链接和 sitemap 混用可能使搜索引擎聚合信号困难。是否都可访问、是否互相重定向尚未核实。
- JS 执行与抓取调度可能降低文章正文被发现的机会；不能仅凭这一点断言它是 Bing 未收录的唯一原因。
- 线上是否已部署当前 HEAD、MIME 类型是否正确、验证文件能否被 Bing 读取、响应是否有 `X-Robots-Tag`、CDN 缓存是否陈旧，均未核实。

## C. 只能通过 Bing Webmaster Tools 确认的问题

- Bing 是否发现、抓取、索引首页、归档和文章，以及最后抓取时间与抓取错误。
- Bing 选定的 canonical 是否与本站声明一致；是否报告重复页面、软 404、内容质量或站点级警告。
- 验证文件/`msvalidate.01` 的站点所有权状态、sitemap 处理状态、URL 提交或 IndexNow 接收状态。

## 发布后复查

确认正式域名后，检查首页、`robots.txt`、`sitemap.xml`、`BingSiteAuth.xml`、`feed.xml`、`archive.html`、旧 `post.html?slug=post-austria-history` 和静态 `posts/post-austria-history.html` 的状态码、最终 URL、Content-Type、title、description、canonical、robots/noindex 及原始正文。新增第二篇真实文章后做同样检查。随后在 Bing Webmaster Tools 分别检查首页、归档及至少两篇真实文章的 URL Inspection，并查看 Site Explorer、Sitemaps 和 URL Submission / IndexNow。记录每个 URL 的 discovered、crawled、indexed、Bing 选定 canonical、robots/noindex 与 warning 状态。

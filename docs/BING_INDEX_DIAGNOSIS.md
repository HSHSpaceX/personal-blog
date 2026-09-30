# Bing 收录诊断（2026-09-30）

## 核查范围与正式站点选择

检查的基线是 `f42ec9e`（`main` 的当前检出内容）。仓库没有 `CNAME`、Cloudflare Pages 配置或 GitHub Pages 部署工作流。两个站点在 2026-09-30 都返回了相同的旧首页，但**没有相互重定向**。原 `sitemap.xml` 使用 `https://hsh-personal-blog.pages.dev/`，而 README、feed 和旧 `js/sitemap.js` 使用 `https://hshspacex.github.io/personal-blog/`。站长已确认正式站点和 canonical 域名为 `https://hsh-personal-blog.pages.dev/`；`SITE_BASE_URL` 固定使用这个地址。GitHub Pages 的同内容副本仍需站长检查是否可以关闭或重定向，避免重复页面。

首次请求在云环境出站代理 CONNECT 阶段被 403 拒绝；在环境草稿加入两个域名并重试后，使用浏览器 User-Agent 成功取得以下源站 GET 响应。状态与内容均为**修复部署前**的线上结果，不能代替部署后的复查。

| 路径 | Pages 域名 | GitHub Pages 域名 | 原始 HTML / 内容要点 |
| --- | --- | --- | --- |
| `/` | 200, `text/html` | 200, `text/html` | 首页 title 和 description 正常；无 canonical、robots/noindex；无文章 `<a href>` |
| `robots.txt` | 200, **`text/html` 首页内容** | 404 | Pages 把缺失文件当作 SPA 回退；实际没有可用 robots 文件 |
| `sitemap.xml` | 200, `application/xml` | 200, `application/xml` | 均为旧 sitemap，列 10 个 Pages URL，没有文章，却列 admin/login/search |
| `BingSiteAuth.xml` | 200, `application/xml` | 200, `application/xml` | 验证文件可取回；所有权状态仍需 Bing 确认 |
| `feed.xml` | 200, `application/xml` | 200, `application/xml` | 四篇旧示例文章，与真实数据不符 |
| `archive.html` | 308 → `/archive`，最终 200 `text/html` | 200 `text/html` | title/description 存在，无 canonical；原始 HTML 无文章链接 |
| `post.html` | 308 → `/post`，最终 200 `text/html` | 200 `text/html` | 通用 title/description，无 canonical；原始 h1 和正文为空 |
| `post.html?slug=post-austria-history` | 308 → `/post?slug=...`，最终 200 | 200 | 原始 h1 和正文仍为空，无 canonical |
| `posts/post-austria-history.html` | 200, `text/html` **首页回退内容** | 404 | 新静态文章尚未部署；Pages 对缺失路径给软 404 内容 |
| `js/posts.js` | 200, JavaScript MIME | 200, JavaScript MIME | 与当前 HEAD 同样只有 1 篇文章 |

另外，Pages 域名的 `admin.html` 与 `login.html` 均最终返回 200、`text/html`、meta `noindex`；`search.html` 最终返回 200、`text/html`，没有 noindex。三者的 `.html` 请求也被 Pages 308 到无扩展名 URL。

这些响应没有 `X-Robots-Tag`；检查到的公开 HTML 也没有 meta noindex。Pages 已确认使用 clean URL：旧 `.html` 请求会 308 到无扩展名路径。因此生成的 `.html` 文件保留供静态托管和本地预览，sitemap、canonical、feed 改用 Pages 最终的无扩展名 URL。

当前 HEAD 的 `js/posts.js` 只有一篇真实文章：`post-austria-history`。尝试访问其两种可能的线上旧 URL：

- `https://hsh-personal-blog.pages.dev/post.html?slug=post-austria-history`
- `https://hshspacex.github.io/personal-blog/post.html?slug=post-austria-history`

这两项均已请求，上表给出了响应。**无法请求两篇真实文章**：线上和当前 HEAD 都只有一篇；旧 feed 中的四个 slug 不存在于当前文章数据，不能充作真实文章。新增第二篇真实文章后，应复查两篇静态文章的线上原始响应。

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

- 两个 host 都可访问且不互相重定向；原有链接和 sitemap 混用可能分散搜索引擎信号。是否因此影响具体 URL 的索引，需要 Bing 证据。
- JS 执行与抓取调度可能降低文章正文被发现的机会；不能仅凭这一点断言它是 Bing 未收录的唯一原因。
- 当前请求证实站点仍在提供旧文件；修复后 Cloudflare Pages 是否成功部署、Bing 能否读取验证文件、CDN 缓存是否及时更新仍需复查。

## C. 只能通过 Bing Webmaster Tools 确认的问题

- Bing 是否发现、抓取、索引首页、归档和文章，以及最后抓取时间与抓取错误。
- Bing 选定的 canonical 是否与本站声明一致；是否报告重复页面、软 404、内容质量或站点级警告。
- 验证文件/`msvalidate.01` 的站点所有权状态、sitemap 处理状态、URL 提交或 IndexNow 接收状态。

## 发布后复查

正式域名已确认为 `https://hsh-personal-blog.pages.dev/`。部署后检查首页、`robots.txt`、`sitemap.xml`、`BingSiteAuth.xml`、`feed.xml`、`archive.html`、旧 `post.html?slug=post-austria-history` 和静态 `posts/post-austria-history.html` 以及最终无扩展名 URL 的状态码、重定向、Content-Type、title、description、canonical、robots/noindex 及原始正文。新增第二篇真实文章后做同样检查。随后在 Bing Webmaster Tools 分别检查首页、归档及至少两篇真实文章的 URL Inspection，并查看 Site Explorer、Sitemaps 和 URL Submission / IndexNow。记录每个 URL 的 discovered、crawled、indexed、Bing 选定 canonical、robots/noindex 与 warning 状态。

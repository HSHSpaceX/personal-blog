# 拾光手记第一轮本地改进验收

本轮统一管理卡片、目录图标、资源选择器、内容筛选和文章分页，并专项验证现有精选流程。工作只在本地进行；未推送、未合并、未修改生产 Supabase。精选通知缺少文章标题，以及真实同步到 Pages 的验收仍待处理。

## 开发基准与参考资料

- 工作目录：`D:\网站测试\personal-blog`，分支 `main`。
- 起始 SHA：`944ac7b21e72ee93fd8cc8464d69867d3333a69e`。开始时工作区干净；执行了 status、branch、remote、fetch、远端及本地日志检查，确认与最新 `origin/main` 一致。
- 没有使用旧 integration 分支，没有 reset、push、merge、PR 或生产 Supabase 写操作。
- 阅读 `C:\Users\chdxm\Downloads\网站改进内容.docx` 的正文及全部九张内嵌截图，重点对照资源中心、管理卡片、目录和分页。原图提取到证据目录的 `reference`。本机没有 LibreOffice，整页 DOCX 渲染未完成；已直接查看原始内嵌图片，不把该失败记为通过。
- 实现提交：`bd1db112c79107de302d59716aa85eceea08537b`，`feat: unify round1 management cards and resource UI`。测试和本文以第二个本地提交保存；最终交付 SHA 见交付消息及本地 `git log`，避免在文件中自引用自己的 commit SHA。

## 实际修改

管理条目通过 `ContentCards.card()` 使用同一 `.glass-card`：半透明主题背景、细边框、20px 圆角、模糊、柔和阴影，标题、摘要、日期、状态与操作分层。草稿、待审核、已批准待同步、仓库已同步待部署、当前部署已公开、退回和失败分别显示。已公开状态以当前静态快照为依据；不会将数据库批准或仓库同步提前解释为 Pages 已上线。历史内容和精选管理仅补卡片外观，没有重构其权限或操作流程。

目录按钮改成本地线性 panel 图标，17 个普通及管理员板块使用不同语义 SVG。保留名称、`aria-expanded`、Enter、Space、Escape、移动遮罩与焦点约束、深链接、历史导航及展开记忆。修正选中项悬停时浅色文字失去对比的问题；深色选中项使用深色文字和图标以保持对比。

文章、动态和图册共用 `ResourceManager.picker()` 和原来的 `ResourceManager.card()`。三者共享搜索、类型筛选、20 条分页、缩略图、预览、上传、取消和返回。动态只提供 JPG/PNG/WebP/MP4，图册只提供 JPG/PNG/WebP，文章保留图片、视频和 PDF/TXT。现有 RPC 没有组合媒体类型，因此动态的“图片和视频”在合并过滤后分页，避免文档导致空页或错误的下一页状态。未新增第三套资源管理实现。

原来的两个折叠标题已移除。两页都默认“全部公开”，登录后显示“我的创作”，通过同一套胶囊样式和 page-composer 状态逻辑切换。“我的创作”只呈现当前账号同类型且未删除的条目；公开区域与私有区域互斥显示。状态写入 `view=mine`，刷新及浏览器返回可恢复；账号改变或退出即清空旧列表、正文、媒体和弹窗并回到公开。未登录不显示私有胶囊、不查询私有列表。待审核版本可只读查看；草稿和允许修改的版本仍在原页编辑。动态公开卡片原有动作保留，只增删当前作者的编辑操作。

首页最近文章、归档筛选结果及精选专题共用分页函数和胶囊外观，分别按 9、12、12 条分页。当前页与总页数可见，边界按钮禁用，URL 原有分类、标签及精选条件保留。分页与卡片实测间距为首页/精选 36px，归档 48px，按钮高度至少 44px。正文上一篇/下一篇没有复制列表分页逻辑。

资源窗口的请求、预览和上传受到账号、请求代次及编辑会话检查。切账号后的异步结果不回填。没有持久化签名 URL 或私有路径，没有恢复 PAT，没有扩大管理员资源删除权限；历史版本引用保护继续通过旧测试。修复了文章在插入媒体之后继续输入仍落入前半段的问题，恢复真实光标到媒体后的段落。

## 精选专项结论

| 项目 | 本地验证结果 |
| --- | --- |
| 管理员读取已发布文章、设置精选 | 通过实际管理 UI 与隔离数据库验证 |
| 持久保存、重新打开、取消、再次精选 | 通过；UI 重开后仍保留，数据库读回一致 |
| 普通用户或访客调用精选操作 | 拒绝；UI 角色切换清空入口，RPC 实际权限检查通过 |
| 未发布作品提前精选、普通字段注入 | 拒绝；未降低列权限、RLS 或 RPC 权限 |
| 投稿、按现有规则审核、精选通知 | 通过；通知归属、revision、target 和文章 slug 正确 |
| 重复保存相同精选状态 | 不产生额外通知 |
| 取消后再次精选 | 按现有事件规则产生一次新通知，取消本身不发通知 |
| 通知中显示文章标题 | **现有缺陷**：标题和正文为通用文案，没有实际文章标题；版本链接正确 |
| 管理员自己发表 | `admin_auto` 自动批准，无需人工审批步骤；允许精选且无自通知 |
| Publisher 导出 | 通过：精选值保留，修改正文不改变首次发表日期，取消精选导出 false |
| 首页 0/1/2/4/6/14 篇 | 通过；最多最近四篇，零篇隐藏，一篇不会补卡 |
| 横向按钮和触摸吸附 | Chromium 四尺寸及 CDP 真实触摸事件通过，滚动到实际卡片位置 |
| 更多入口及专题 | 进入 `featured.html`，全部公开精选倒序、链接与分页正确 |
| 访客/普通用户访问、排除非精选与取消项目 | 通过使用更新后静态快照的浏览器测试 |
| 真实生产链路 | **尚未验收**，原因见下节 |

数据库用例分别在 PGlite 和原生 PostgreSQL 上执行全部现有迁移后运行，浏览器用例使用同源本地测试替身并拦截外网。它们验证本地行为，不能替代真实 Auth、Storage、邮件或 Pages 发布验收。通知缺标题在测试日志中明确标为已知限制，并没有记成需求已满足。

## 自动发布状态和站长检查步骤

只读检查到最近三次 `sync-community-public.yml` 均失败：2026-10-18 13:03:16、08:31:39、06:53:13（北京时间）。[最近一次运行](https://github.com/HSHSpaceX/personal-blog/actions/runs/39099214007) 在 `Reconcile approved snapshot and validate media` 失败，后面的生成、再次核验、推送、finalize 都跳过。该次日志的两个环境变量为空，输出 `Publication failed: EXPORT_FAILED`。日志中没有读取、保存或输出真实密钥。

当前 workflow 用 `${{ secrets.SUPABASE_URL }}` 和 `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`，没有 `jobs.sync.environment`。据此推断，现有写法需要仓库级 Actions Secrets（或对该仓库开放的组织级 Secrets）。若值仅存在于某个受保护 Environment，job 必须显式引用该 Environment 才能取得；这是待站长确认的配置归属，未通过 Secrets API 枚举线上配置。[GitHub Secrets 说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[Environment 使用方式](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment)。

站长可按顺序自行检查：

1. 仓库 Settings → Secrets and variables → Actions，确认这两个**名称**存在于 Repository secrets；检查 Values 应到可信密码管理渠道，不要粘贴到聊天、前端或日志。Variables 同名条目不能替代 Secrets。
2. 若实际使用受保护 Environment，检查该环境的 Secrets 和部署分支规则；第二轮再明确把 sync job 绑定到哪个 Environment，并评估定时任务的审批规则。
3. 确认 URL 与服务端凭据属于同一个预期 Supabase 项目，且升级状态正确；本轮没有使用生产凭据进行本地测试。
4. 在未来获得线上验收授权后再手动运行同步，确认 export、生成、verify、push、finalize 和 Cloudflare Pages 部署分别成功，并检查实际部署中的文章与通知。本轮没有触发该线上流程。

缺配置的 Publisher 在调用服务适配器之前失败。新增提示只输出缺失配置的名称和检查位置；文件哈希测试确认不会改写公开 JSON、静态快照或站点文案。原先模糊的 `EXPORT_FAILED` 错误码保留，兼容既有错误处理。没有修改 workflow、生产配置或 Publisher 架构。

**本地精选逻辑可测试；真实管理员设置精选 → 通知作者 → 自动同步 → Pages 部署尚未验收。**

## 第二轮事项

- 精选通知加入文章标题，并保持原有事件去重、作者归属及版本链接规则；需要数据库通知实现变更，留在第二轮。
- 按站长确认的方向处理文章编辑器管理员精选开关、文章封面选择和全站用户搜索。
- 站长检查并确定发布凭据的仓库/Environment 归属后，再验收真实自动同步和 Pages 部署。
- 文档原截图出现缺少 `content_items.deleted_at` 的线上 schema 错误；本轮只在隔离环境执行现有迁移进行测试，未修复或宣称验收该生产数据库。

## 回归记录

最终完整回归：**128 项通过，0 失败，0 取消，0 跳过**，耗时 326.7 秒。包含已有适用用例及本轮新增 9 项，执行原生 PostgreSQL 多连接权限/竞争、PGlite、DOM、四尺寸 Chromium、编辑器/私信/审核/资源中心、发布器、供应链字节/许可证等检查。最终日志位于 `D:\网站测试\personal-blog\work\evidence\round1\full-regression-final.log`。第一遍完整回归中三项旧 UI VM 测试缺少浏览器 `location` 及分页节点接口；已补齐替身并保留全部原断言，受影响的 5 项 UI 测试通过，然后重新运行完整套件。旧失败日志保留为 `full-regression.log`，不冒充最终通过记录。

`node scripts/generate-site.mjs`、`node scripts/check-seo.mjs`、`node scripts/check-secrets.mjs`、`node --test tests/*.test.cjs tests/*.test.mjs` 和 `git diff --check` 均已完成。完整测试通过 work 脚本配置本地隔离依赖，并使用 `--test-concurrency=2`；应用没有增加 npm 依赖。旧文章正文、媒体、canonical、robots、feed、生产配置和 SQL migration 没有变更。

实现提交后再次运行生成器，只有 `sitemap.xml` 的首页、归档、精选、画廊和动态五个实际改动页面的 lastmod 从 2026-10-13 更新到 2026-10-18，随验收提交保存。这是对应真实 UI 源文件提交的日期；关于、时间轴和旧文章日期保持不变，没有为了生成器运行而整体刷新日期。SEO、密钥扫描再次通过。

运行环境为 Windows 本机、Chromium 内核的 Microsoft Edge、PGlite 0.3.14、pg 8.16.3、原生 PostgreSQL 平台包 18.4.0-beta.17、jsdom 26.1.0 和 playwright-core 1.56.1，依赖沿用忽略的 work 目录。Node 为 v24.19.0；CI 配置为 Ubuntu / Node 22，未把本地运行写成已在远端 CI 执行。四种尺寸为 Chromium 视口模拟，未声称经过 iPad Safari 真机测试。Windows PostgreSQL 二进制复制到临时 ASCII 路径，临时数据库仅监听 loopback，测试后关闭。

复现入口为忽略目录中的 `work/run-round1.ps1`；CI 现有 test glob 会自动包含 `tests/round1-browser.test.mjs` 和 `tests/round1-featured.test.mjs`。旧测试只补共享模块加载或把被移除折叠标题的操作改成胶囊；未删除测试或放宽安全断言。

## 截图索引

全部截图根目录为 **`D:\网站测试\personal-blog\work\evidence\round1`**，未提交到 Git。主文件名模式里的宽度为 1440、1024、768、375；尺寸对应 1440×900、1024×768、768×1024、375×812。

| 内容 | 绝对路径或模式 |
| --- | --- |
| 浅色展开目录 | `D:\网站测试\personal-blog\work\evidence\round1\directory-admin-1440-light.png` |
| 深色展开目录 | `D:\网站测试\personal-blog\work\evidence\round1\directory-admin-1024-dark.png` |
| 手机目录 | `D:\网站测试\personal-blog\work\evidence\round1\directory-admin-375-light.png` |
| 管理玻璃卡片 | `D:\网站测试\personal-blog\work\evidence\round1\management-user-1440.png` |
| 动态资源中心 | `D:\网站测试\personal-blog\work\evidence\round1\resources-moment-375.png` |
| 图册资源中心 | `D:\网站测试\personal-blog\work\evidence\round1\resources-album-1024.png` |
| 文章资源中心 | `D:\网站测试\personal-blog\work\evidence\round1\resources-article-1024.png` |
| 动态公开 | `D:\网站测试\personal-blog\work\evidence\round1\filter-moment-public-1440.png` |
| 动态本人 | `D:\网站测试\personal-blog\work\evidence\round1\filter-moment-mine-1440.png` |
| 图册公开 | `D:\网站测试\personal-blog\work\evidence\round1\filter-album-public-1440.png` |
| 图册本人 | `D:\网站测试\personal-blog\work\evidence\round1\filter-album-mine-1440.png` |
| 首页分页 | `D:\网站测试\personal-blog\work\evidence\round1\pagination-home-1440.png` |
| 归档分页 | `D:\网站测试\personal-blog\work\evidence\round1\pagination-archive-1440.png` |
| 精选分页 | `D:\网站测试\personal-blog\work\evidence\round1\pagination-featured-1440.png` |
| 精选管理 | `D:\网站测试\personal-blog\work\evidence\round1\featured-management.png` |
| 精选通知 | `D:\网站测试\personal-blog\work\evidence\round1\featured-notification.png` |
| 首页精选 | `D:\网站测试\personal-blog\work\evidence\round1\featured-home-guest.png` |
| 精选专题 | `D:\网站测试\personal-blog\work\evidence\round1\featured-topic-guest.png` |
| 菜单计算样式 | `D:\网站测试\personal-blog\work\evidence\round1\directory-computed.json` |
| 旧测试其他证据 | `D:\网站测试\personal-blog\work\evidence\round1\regression` |

## 修改文件

- 页面：`account.html`、`moments.html`、`gallery.html`、`index.html`、`featured.html`、`archive.html`（同时更新涉及资源的缓存版本）。
- 样式：`css/community.css`、`css/workspace.css`、`css/style.css`。
- 界面：`js/content-cards.js`（新增）、`js/account.js`、`js/workspace.js`、`js/community-ui.js`、`js/page-composer.js`、`js/management.js`、`js/resource-manager.js`、`js/content-editor.js`、`js/site.js`。
- 数据与诊断：`js/community-data.js`、`scripts/sync-community-public.mjs`。
- 生成产物：`sitemap.xml`（仅五个本轮 UI 页面的真实修改日期）。
- 测试：`tests/round1-browser.test.mjs`、`tests/round1-featured.test.mjs`（新增）；`tests/community-round2-ui.test.mjs`、`tests/community-round5-ui.test.mjs`、`tests/release-browser.test.mjs`、`tests/ui.test.cjs`。
- 本验收报告：`docs/UI_ROUND1_ACCEPTANCE_20261018.md`。

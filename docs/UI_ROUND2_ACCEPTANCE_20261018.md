# 拾光手记 Community V2 第二轮本地验收

**第二轮仅在本地完成，尚未推送 main，尚未修改生产 Supabase。** 没有创建 PR、合并旧分支、操作生产 Secrets、触发线上发布或执行真实历史导入。以下“通过”均指明确列出的本地环境；真实托管 Auth、Storage 与 Pages 不在此次已验收范围。

## 1. 基准、资料与第一轮保护

- 仓库 `HSHSpaceX/personal-blog`，目录 `D:\网站测试\personal-blog`，继续使用本地 `main`。
- 开始重新 fetch 后的远端 SHA：`944ac7b21e72ee93fd8cc8464d69867d3333a69e`，远端没有新增提交。本地起始 SHA：`d03c2f3c945cdf8159f843eb6cc8ad6c0fbe781d`，领先远端 2 个提交；开始时工作区干净。
- 第一轮提交 `bd1db112c79107de302d59716aa85eceea08537b` 与 `d03c2f3c945cdf8159f843eb6cc8ad6c0fbe781d` 完整保留。未 checkout 远端旧文件、reset、rebase 或合并 integration 分支。
- 已阅读第一轮验收报告、两份 Supabase/Community 发布文档、第一轮实现与测试，以及 `C:\Users\chdxm\Downloads\网站改进内容.docx` 的正文和内嵌 UI 截图。文档用于参考，以本轮 prompt 为准。DOCX 原始截图沿用第一轮提取的 `work\evidence\round1\reference`；本机没有 LibreOffice，未声称完成 Word 整页渲染。
- 第一轮 `ContentCards.card()`、共享 `ResourceManager.picker()`、双胶囊、目录 SVG 和插图光标修复全部保留。没有重绘首页、文章正文或私信系统。
- 第二轮代码与测试验收 SHA：`993d42b69bc585c18664fa2df7adf4f0774deac5`。含本报告的最终本地 SHA 记录于 `D:\网站测试\personal-blog\work\evidence\round2\handoff.json` 的 `final_sha`，也在交付回复完整列出；该证据在报告提交后生成，避免在提交内容里循环自引用自身哈希。

## 2. 管理员文章精选

文章编辑器折叠“设置”中增加“设为精选文章”，只有管理员本人编辑文章时显示；动态、图册与普通用户均无此操作。打开已批准版本读取 `content_items.featured`；打开管理员草稿读取单独保存的意图。精选管理改变状态后，重新读取版本并打开编辑器会得到当前状态。

`community_article_preferences` 保存每个草稿版本的管理员意图，不向正文添加 `featured` 字段，也不修改不可变正文。普通用户没有表写权限，RLS 不返回其记录；只有管理员本人文章草稿可经 `community_save_featured_preference()` 保存。缺迁移或读取失败时明确报错，不静默当成 false 后继续提交。

`community_submit_featured_article()` 在同一事务中复用原 `community_submit_revision()`，按现有管理员规则直接批准，再调用原受保护的精选接口并标记意图已应用。草稿预选仅在提交批准后生效；直接调用精选仍必须是当前已批准、未删除的文章。普通用户投稿与已公开作品修改继续遵守原审核周期，精选不替代审核。

事务第二阶段故意制造错误时，第一阶段批准、审核记录和首次发表计数一并回滚。重复或并发提交同一版本只形成一次决策。响应丢失后可重试同一版本，不创建额外文章/revision/通知；已经应用的重试也不会撤销后来精选管理中心的决定。

正文保存成功、设置失败或提交失败分别提示。确认读取也中断时保留已保存版本 ID，再次提交先核对权威版本；后续输入不被错误标成已保存，账号代次和编辑会话检查丢弃旧账号响应。成功文案明确为“文章已批准，精选状态已设置，等待静态同步与 Pages 部署”，没有提前宣布已上线。

## 3. 私有资源封面

选择、更换、清除自定义封面与缩略图位于同一设置区域。点击选择调用第一轮的同一个 `ResourceManager.picker()`，以单次打开的图片模式限制候选、类型控件和上传 MIME 为 JPG/PNG/WebP；普通正文资源入口仍保留图片、视频、PDF/TXT，动态和图册原有独立表单及类型限制不变。

资源来自 `community_assets_page()` 的本人资源页，支持搜索、预览和分页。选择封面只记录 UUID，保存时将其与正文资源 ID 去重合并进 `asset_ids`，不会自动插入正文图片块。更换/清除时只移除封面独占引用；同一图片仍在正文时保留引用。草稿重开、退回修改、已发表版本修改和旧封面均沿用现有验证，不删除历史资源。

后端原有 MIME、所有权、revision 引用和删除保护继续执行。Publisher 仍只导出当前批准版本的资源；未批准封面不能进入快照，公开页面只使用 `published-media` 副本。额外修正了结构化文章渲染：仅用于封面的图片不再作为未使用附件追加到正文，正文明确插入的同一图片仍正常显示。

封面预览使用现有短期签名机制，过期清除后可以点击刷新；正文和本地存储不保存私有 URL。选择封面不会改动正文、光标或资源顺序，账号切换清除预览，延迟签名结果不能回填。

## 4. 精选通知标题

新增 forward migration 替换 `community_set_featured()`；旧 migration 原文不变。通知正文从当前真实批准版本读取标题，形成“你的文章《标题》已被选为精选文章。”，标题仍为“文章已入选精选”。截取最多 160 个数据库字符，正文满足现有 500 字限制，没有浏览器传入标题参数。

保留管理员检查、批准版本限制、非精选→精选事件判断、作者与操作人相同不通知，以及 revision、target 和 slug 关系。重复 true 不发新通知；取消不发通知，再次精选产生一次新事件。标题中的 HTML 特殊字符存为纯文本，通知 UI 继续通过 `textContent` 渲染。旧通知不回填；后续编辑不会改变之前通知记录的标题文本。

通知点击仍进入该次精选对应的账号中心文章版本，保证数据库已批准但静态页面尚未同步时也能查看正确版本。此行为通过真实本地数据库通知与 Chromium 点击验证，不把本地记录生成写成生产已送达。

## 5. 用户搜索及精选筛选

新增“用户”类型。`PublicProfileData.search()` 调用 `profile_search()`，只返回 `id / username / display_name / avatar_url / bio`。服务端按用户名、显示名称、简介递减权重排序；大小写一致，中文可检索。参数绑定与 `strpos` 字面匹配使 `%`、`_` 不成为任意匹配符。没有读取 `auth.users`、邮箱、电话、私信、账号设置或管理员内部字段，也没有下载全部 profiles 在浏览器搜索。

RPC 固定空 `search_path`，关键词 2–80 字，每页 1–20 条，offset 0–200；空关键词与无效页拒绝。anon/authenticated 均可访问相同公开投影，不改变原 profiles RLS/grants。这里限制的是新增搜索接口，不宣称重新设计了原有公开资料表策略。

用户结果使用玻璃卡片，安全文本显示名称、@username 和简介，链接为 `profile.html?username=...`。头像限定安全地址，失败使用默认头像。250ms 防抖；加载、无结果、错误、重试、查看更多及页数上限均有明确反馈。新输入、类型切换、历史导航和账号变化立即作废旧请求。用户显示“已加载 N 位”，与内容索引数量分开；“全部”计数注明“内容”，不把局部用户页伪装成全站总数。

新增“仅看精选”胶囊。开启时切换为文章类型；其他内容类型和用户类型取消该状态。仅信任公开静态文章记录的布尔 `featured === true`，不根据标题猜测。原相关性排序保留，非文章/非精选不会混入。URL 使用 `q / type / featured=1`；深链接、刷新、前进后退、清空、切回普通文章及无结果均通过浏览器点击测试。

Supabase 未配置或新增 RPC 未安装时，用户区提示暂不可用，现有文章、动态及公开评论本地搜索继续工作。远端公开评论读取失败时保留已公开的静态评论索引。精选变化只有在 Publisher 成功同步可信快照后才反映到静态搜索，不提前混入待审版本。

## 6. 精选与安全专项结果

| 验证项 | 本地结果与证据 |
| --- | --- |
| 普通用户/访客调用管理员精选、意图或原子提交 | PostgreSQL 拒绝；UI 隐藏，前端调用也拒绝 |
| 未发表文章提前精选、正文注入精选字段 | PostgreSQL 拒绝，沿用第一轮断言 |
| 管理员本人草稿保存意图、重开 | SQL 读回与四尺寸 Chromium 通过 |
| 管理员首次发布及精选 | `admin_auto` 批准，同事务应用，发布队列待同步 |
| 第二阶段失败 | 整笔提交回滚，原草稿和计数保持，安全重试 |
| 响应及确认读取丢失 | 重试复用同一 revision，浏览器用例通过 |
| 并发精选与并发原子提交 | 原生 PostgreSQL 多连接只产生一个通知/决策 |
| 重复、取消、再次精选 | 同状态去重，取消不通知，再次精选新事件 |
| 管理员自己的文章通知 | 无自通知 |
| HTML 标题、后来改标题、通知点击 | 纯文本显示，旧事件不改写，正确版本链接 |
| 只选封面、封面兼正文、更换、清除 | 资源引用去重，正文块与历史引用保留 |
| 他人图片/PDF 封面、删除历史引用 | 实际 SQL 拒绝 |
| 未批准封面与 Publisher | 只导出当前批准封面，无私有/签名地址 |
| 用户公开字段、anon、中文大小写、特殊字符 | PGlite 与原生 PostgreSQL 均通过 |
| 空搜索、超长输入、超大页、越界 offset | RPC 拒绝 |
| XSS、账号 A→B→A 和延迟资源返回 | DOM/Chromium 拒绝活动节点并清空过期状态 |
| 首页 0/1/2/4/6 精选、最近最多四篇、排序 | 第一轮专项继续纳入完整回归 |
| 首页按钮/真实触摸吸附、专题分页/取消后消失 | 第一轮 Chromium 继续纳入完整回归 |

## 7. 数据库与完整回归

新增 `supabase/migrations/202610180001_article_settings_and_profile_search.sql`，是现有 26 项之后的第 27 项。分别验证已有库升级（含旧通知保留）、兼容全新链、单事务 fresh-install 生成包以及本地原生 PostgreSQL 多连接竞争。已更新两份部署顺序文档。**站长尚未在生产执行这个文件。** 基础能力版本 `20261013` 保留；新增接口缺失时客户端明确失败，不能用旧版本号代替实际新 RPC 验收。

第二轮专项 12 项通过，0 失败/取消/跳过，日志 `D:\网站测试\personal-blog\work\evidence\round2\round2-complete.log`。新增提交与确认同时中断的重试补验通过，日志 `retry-final.log`。最终完整回归 **140 项通过，0 失败、0 取消、0 跳过**，耗时 **399.2 秒**，使用 `--test-concurrency=2`；日志 `D:\网站测试\personal-blog\work\evidence\round2\full-regression-final.log`。通知点击后实际读取作者版本的补强验收另在 `notification-navigation-final.log` 通过（22.6 秒）。

执行入口沿用当前 CI 测试 glob，由忽略目录 `work\run-round2.ps1` 配置 PGlite 0.3.14、pg 8.16.3、原生 PostgreSQL 平台包 18.4.0-beta.17、jsdom 26.1.0、playwright-core 1.56.1 和本机 Edge Chromium。Node 为 v24.19.0；远端 CI 的 Ubuntu/Node 22 没有在本轮触发，不能写成已在远端通过。本机 Edge 版本 155.0.4283.45。四种尺寸为 Chromium 视口模拟，不是 iPad/Safari 真机。完整回归内的 legacy 导入用例只操作临时本地数据库，不是生产旧内容导入。

执行 `generate-site.mjs`、`check-seo.mjs`、`check-secrets.mjs`、全部 `node --test tests/*.test.cjs tests/*.test.mjs` 和 `git diff --check`。旧 128 项保留，新增 12 项，没有删除测试或放宽安全断言；RLS definer 白名单显式加入并审查三个新函数。旧精选测试中的“通用正文已知缺陷”断言强化为真实标题正文断言。

首批定向回归曾有 3 项失败：2 项是新通知测试按随机 UUID 排序后误选了迁移前通知，改为按事件 ID 区分新旧记录；另 1 项揭示普通用户已获保存确认但后续读取失败时，未正确清除已保存正文的脏标记，已恢复准确基线并保留后续输入保护。失败日志 `targeted-first.log` 保留，不冒充通过记录。第一遍完整回归另有 1 项清单断言失败（139 通过、1 失败）：原测试写死迁移数 26。已改为严格检查全部 27 项及新增项位置，保留原顺序与部署验收断言；重新完整执行后 140 项通过。该次失败原始日志保留为 `full-regression-first.log`，不混入最终通过统计。

## 8. 发布工作流的真实阻塞状态

2026-10-18 16:48（北京时间）只读重新检查 GitHub：最新可见的六次同步运行均失败，最新为 [39099214007](https://github.com/HSHSpaceX/personal-blog/actions/runs/39099214007)，创建于 13:03:16，源 SHA 仍为 `944ac7b...`。job `117591834417` 在 Reconcile 步骤失败，生成、verify、push 与 finalize 均跳过。该次公开日志显示 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 环境变量为空，错误为 `EXPORT_FAILED`。只保存了布尔诊断与运行元数据，未读取或输出 Secrets 值。

workflow 读取 `${{ secrets.SUPABASE_URL }}` 和 `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`，没有绑定 `jobs.sync.environment`。因此现有写法需要仓库 Actions Secrets 或允许该仓库访问的组织 Secrets；若只放在受保护 Environment，必须先决定并绑定对应环境。Secret 当前是否已由站长另行配置，不能从旧失败日志推定；本轮未枚举 Secrets，也没有修改 workflow。[GitHub Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[Environment](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment)。

Publisher 缺配置在创建真实服务适配器之前安全中止，文件哈希测试确认不会覆盖公开快照。配置存在后，基础后端能力预检不完整仍会在首次写入前中止。原有全量快照、verify、Git 正常推送后 finalize 和重试策略不变；精选值随当前批准指针导出，失败可按当前权威状态重试。通知由数据库事务直接生成，不以 Publisher 成功为前提。第 27 项仍必须在正式验收前安装，否则新编辑器设置/用户搜索不能完成；旧基础发布契约不自动证明第二轮 RPC 已安装。

## 9. 截图与原始证据

根目录 **`D:\网站测试\personal-blog\work\evidence\round2`**，均为测试账号与测试数据，Git 忽略。共 232 张截图（含完整旧回归证据），绝对路径、像素尺寸和 SHA256 索引见 `work/evidence/round2/evidence-index.json`。宽度 1440/1024/768/375 分别对应 1440×900、1024×768、768×1024、375×812。已直接查看实际截图，且浏览器验证真实点击、可见性与横向溢出，不仅检查 DOM 存在。

| 内容 | 绝对路径 |
| --- | --- |
| 管理员文章设置 | `D:\网站测试\personal-blog\work\evidence\round2\editor-settings-admin-1440-light.png` |
| 普通用户无精选权限 | `D:\网站测试\personal-blog\work\evidence\round2\editor-settings-user-1440-light.png` |
| 手机深色设置 | `D:\网站测试\personal-blog\work\evidence\round2\editor-settings-admin-375-dark.png` |
| 图片封面资源中心 | `D:\网站测试\personal-blog\work\evidence\round2\cover-picker-user-375.png` |
| 独立封面预览 | `D:\网站测试\personal-blog\work\evidence\round2\cover-preview-user-1440.png` |
| 真实本地数据库批准及精选 | `D:\网站测试\personal-blog\work\evidence\round2\database-admin-approved-featured.png` |
| 真实数据库通知含标题 | `D:\网站测试\personal-blog\work\evidence\round2\featured-notification-title-postgresql.png` |
| 用户搜索 | `D:\网站测试\personal-blog\work\evidence\round2\user-search-guest-1440-light.png` |
| 手机用户搜索 | `D:\网站测试\personal-blog\work\evidence\round2\user-search-guest-375-light-viewport.png` |
| 真实匿名搜索 RPC | `D:\网站测试\personal-blog\work\evidence\round2\user-search-anon-postgresql.png` |
| 仅看精选 | `D:\网站测试\personal-blog\work\evidence\round2\featured-search-guest-1440.png` |
| 首页精选 | `D:\网站测试\personal-blog\work\evidence\round2\featured-home-guest.png` |
| 精选专题 | `D:\网站测试\personal-blog\work\evidence\round2\featured-topic-guest.png` |

控件的计算颜色、圆角、尺寸 JSON 使用 `cover-control-* / featured-control-* / search-featured-control-*` 前缀；封面按钮与精选标签点击区实测至少 44px。通知打开真实作者版本的截图为 `D:\网站测试\personal-blog\work\evidence\round2\featured-notification-opened-version.png`。其他角色/尺寸/主题使用同名前缀保存；原有完整 GUI 回归额外截图位于 `round2\regression`。工作流无凭据元数据为 `publisher-status.json`；兼容安装包为 `compatible-install`，仅本地审阅，不曾用于生产执行。

## 10. 文件、提交与第三轮事项

第二轮修改 29 个文件：

- 页面与样式：`account.html`、`search.html`、`css/community.css`、`css/style.css`。
- 编辑器、资源与搜索：`js/community-data.js`、`js/community-ui.js`、`js/resource-manager.js`、`js/community-public.js`、`js/public-profile-data.js`、`js/search-core.js`、`js/search.js`。
- 共享脚本缓存版本：`index.html`、`archive.html`、`featured.html`、`moments.html`、`gallery.html`、`post.html`、生成的 `posts/post-austria-history.html`。逐文件比较确认这些页面只有缓存键变化，旧文章正文不变。
- 新 SQL：`supabase/migrations/202610180001_article_settings_and_profile_search.sql`。
- 新测试：`tests/round2-browser.test.mjs`、`tests/round2-settings.test.mjs`、`tests/round2-ui.test.mjs`。
- 旧测试及替身：`tests/helpers/release-browser.mjs`、`tests/release-docs.test.mjs`、`tests/rls-postgres.test.mjs`、`tests/round1-featured.test.mjs`。
- 文档：`docs/COMMUNITY_V2_RELEASE.md`、`docs/SUPABASE_RELEASE_20261013.md`、本报告。

本地第二轮提交：`993d42b69bc585c18664fa2df7adf4f0774deac5`，`feat: add article settings and public search`；其后的报告提交为 `docs: record round2 local acceptance`，完整哈希在交付消息与忽略的 handoff 证据中记录。第一轮两次提交仍在同一 main 历史中，最终本地 main 领先 origin/main 4 个提交。

收尾检查包括 status、diff --check、diff --stat、log 以及提交后再次静态生成、SEO、密钥扫描。最终已跟踪/未跟踪工作区保持干净；截图、日志、测试依赖与临时脚本均在忽略的 work 中，没有提交临时文件。`preservation.json` 记录了 9 个第一轮关键源文件以及全部 26 个历史 SQL 未变。关于/时间轴页面保持原缓存键，避免无关 sitemap 日期变化；最终 sitemap、feed、robots、原文章日期、媒体和生产配置均无差异。


第三轮须由站长确认项目、备份和迁移边界，再安排第 27 项及尚缺的历史迁移；核对两个 Actions Secrets 的名称、项目归属和 Repository/Environment 选择。之后在独立 RC 验证真实邀请 Auth、PostgREST schema cache、私有 Storage HTTP/签名/大文件、普通账号与两管理员，再验证真实“管理员精选→作者通知→Publisher→Git→Pages”全链。记录 Pages 实际部署 SHA 和完成状态；本轮不能替代该步骤。

真实历史导入仍待单独授权和审阅摘要，不执行、不自动重跑。生产通知是否送达、托管 Storage 是否按预期执行、Cloudflare Pages 是否部署均明确为**未验收**；无新增已知本地功能缺陷作为通过项掩盖。

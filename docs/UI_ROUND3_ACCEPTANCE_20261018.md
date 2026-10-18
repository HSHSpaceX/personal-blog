# 第三轮最终验收与部署交付记录

操作日为 2026-10-18～19（Asia/Shanghai），文件名沿用任务指定日期。正式操作入口：[站长完整部署手册](FINAL_DEPLOYMENT_GUIDE_20261018.md)。生产数据库升级、Secrets 配置、真实历史导入及托管 Auth/Storage 由站长执行；本地开发没有执行这些生产操作。

## 1. 接管状态与版本

起始远端 `944ac7b21e72ee93fd8cc8464d69867d3333a69e`；本地起始 `f38df26334b0cf1c43d0c2b2a63a42d780b45a5e`，分支 main、工作区干净、领先远端 4 个提交，无 merge/rebase。第一轮 `bd1db112c79107de302d59716aa85eceea08537b`、`d03c2f3c945cdf8159f843eb6cc8ad6c0fbe781d`；第二轮 `993d42b69bc585c18664fa2df7adf4f0774deac5`、报告 `f38df26334b0cf1c43d0c2b2a63a42d780b45a5e` 完整保留。

三轮发布后的精确 main SHA、推送时间、CI/Cloudflare 链接与 HTTP 结果，由最后提交后生成的 `work/release/final/release-manifest.json` 和同目录四份文档副本绑定，避免在自身提交内伪造自引用 SHA。当前仓库副本的推送后记录见本报告末尾；准备阶段不代表已经推送或部署。

## 2. 三轮成果及本轮修复

第一轮：管理内容玻璃卡片及状态层次、目录语义 SVG 与移动抽屉、共享 `ResourceManager.picker()`、动态/图册独立表单、“全部公开 / 我的创作”胶囊、分页、精选首页横向四卡与专题。第二轮：管理员精选草稿意图与原子批准/精选、独立私有图片封面及 revision 引用、通知真实标题、受限公开用户检索、精选搜索与 URL 恢复。

本轮没有重写这些功能，没有更改旧文章正文/媒体、生产配置、审核规则或历史 migration。新增/修改：

- `supabase/preflight.sql`、`supabase/postflight.sql`：安全的只读对象/权限诊断；缺表、缺函数或部分升级也返回报告，区分基础后端和第 27 项。
- `js/community-data.js`、`account.html`、`moments.html`、`gallery.html`：上传登记与清理同时失败时不再在用户错误中输出私有对象路径；更新脚本缓存键。
- `scripts/legacy-community-import.mjs`、`.github/workflows/import-legacy-community.yml`：导入增加 `source_sha` 审阅门禁，校验 checkout HEAD/GITHUB_SHA/输入一致，缺服务器配置安全中止。
- `scripts/build-final-operator-pack.mjs`：纯离线生成四文档副本、27 项原始 SQL、preflight/postflight、兼容安装包、最新导入计划和实际 Git SHA manifest，不访问生产。
- `.github/workflows/community-checks.yml`：拉取完整历史，让 CI 实际验证 27 项既有 SQL 未被重写，避免浅克隆缺少第一/二轮提交造成审计失败。
- `tests/round3-deployment.test.mjs`、`tests/round3-legacy.test.mjs`、`tests/round3-browser.test.mjs`：升级分流/ACL、导入重试与冲突、最终四尺寸/五身份页面以及数据库未升级时保留编辑内容。
- 四份本轮正式文档及旧发布/Auth/Supabase 文档的当前操作入口和过期指令。

## 3. 数据库兼容性与权限

实际枚举 27 项；第 27 项为 `202610180001_article_settings_and_profile_search.sql`，LF SHA256 `d812f8e534f46d94693806558baa0fc4842c067930871dabc4220a7062bc1ead`。本轮无第 28 项，既有 27 文件保持原内容。

| 场景 | 本地结论 |
| --- | --- |
| A 全新兼容安装 | 单事务生成包覆盖完整 27 项；隔离数据库初始化验证由完整回归执行。 |
| B 原版完整旧库 | PGlite/原生 PostgreSQL 均从第 22 项升级至 27，关键结构/权限 ready。 |
| C 删减版私信 | 两引擎均移除已知一个索引和三个托管触发器后正常升级，不重跑私信建表，不改托管所有者；RESTRICT 引用保护保留。 |
| D 文件内部分安装 | 诊断返回 incomplete/STOP；不自动覆盖未知生产残缺结构。仍需人工比对完整目录和备份。 |
| E 第 23～27 项边界 | 两引擎逐项执行，22～25 基础 incomplete，26 基础 ready/新增 missing，27 两者 ready；篡改 RLS、anon EXECUTE 或移除搜索 RPC 均转 incomplete。 |

基础 capability 仍为 20261013，不能据此推定第 27 项安装。postflight 检查新增表、列/主外键、RLS/policy、EXECUTE/表写权限、固定 search_path 和通知函数体；目录证据不是整份 migration 执行证明。生产历史不明时停止，不能仅补 CLI history 后重跑 SQL。

周期 N=1/2/3、三类型独立计数、修改已发表、失败回滚、必审并发、双管理员审批、精选事务/去重、私信和资源 RLS、引用/删除竞争，继续由原有 PGlite/原生 PostgreSQL 全套验证。托管 Storage/TUS、真实 Auth/Pages 业务链没有被本地引擎替代。

## 4. 数据库后升级时的保护

新增 Chromium 实际点击验证：管理员正文保存后，新精选 RPC 缺失会提示数据库升级，登录和正文保留，dirty 仍为 true；升级后重试复用同一 revision，不重复创建文章，也不声称 Pages 已部署。既有测试继续检查公开快照、缺基础 capability 的 Publisher 在写文件前中止、匿名公开读取、用户搜索降级、封面引用、签名失败和账号 A→B→A 的异步污染防护。

## 5. 历史内容导入最终预演

从当前实际源码生成 `work/release/legacy-plan.json`。内容摘要（JSON 内容 SHA256，不是格式化文件字节）：`c94fc3510bcc7e9f9cd92a7783b7cb6c27734d44d13d0ffd0e0002ad37c087b2`。当前 1 篇文章、2 条动态、0 个公开旧图册，6 个唯一媒体。

原文章 slug `post-austria-history`，日期 2026-09-20；两个动态保留原 target ID 与 UTC 对应原发布时间。清单含分类/标签/精选、HTML、路径、字节摘要与真实 MIME。`assets/moments/m-20260926-184012-5b8g.jpg` 实际 PNG，明确标记扩展名不符；私有导入按真实 MIME 登记，不改原公开文件。

原生 PostgreSQL 预演：第一次媒体中途中断，没有内容记录被误建；原清单重试完成导入；再次完整导入结果 ID 完全相同，3 条内容/revision/映射和 6 份媒体无重复。首次日期、作者、精选、slug 保留；作者修改旧文章后原批准版继续导出，审核新 revision 后原 URL/日期/映射仍保持。公开合并不会重复旧静态文章。

失败场景：改清单摘要/错误 UUID、媒体缺失、MIME 异常、缺失引用在写入前失败；服务适配器拒绝配置作者不符、slug 冲突和既存媒体字节不符；新增 Git SHA/main/manual 门禁验证；网络中断可用原清单重试。既有 SQL 测试继续覆盖来源摘要冲突及互动 target 映射。真实 Storage 上传和生产 import 均未执行。

## 6. Chromium 与证据

浏览器为本机 Microsoft Edge Chromium，真实 headless 运行；测试服务仅本机，身份/媒体 API 替身明确隔离，部分浏览器流程桥接实际原生数据库。不是生产 Supabase，也不是 iPad Safari 实机。

| 尺寸 | 最终 GUI 专项 |
| --- | --- |
| 1440×900 | 游客、普通 A/B、管理员 A/B；两主题目录、公开页面与账号模块通过。 |
| 1024×768 | 同上，无页面横向溢出、目录 SVG 有实际尺寸/计算颜色。 |
| 768×1024 | 同上，目录开关及 Escape、独立内容模块正常。 |
| 375×812 | 同上，触摸布局、缺 RPC 保存/安全重试正常。 |

新增矩阵覆盖首页、归档、精选、搜索、旧文章、动态、画廊、个人主页，以及文章/动态/图册、资源、通知、私信、回收站、审核、周期、精选管理、站点文案模块；角色与尺寸全组合，公开页面主题交错覆盖，目录每组两主题。第一/二轮旧测试还覆盖编辑、资源选择/预览/上传/搜索/分页/取消、正文/公式/附件、封面、精选通知跳转、双胶囊、历史导航、失败重试、账号隔离和轮播吸附。本轮未做 WebKit 或 Safari 实机验收。

证据绝对目录：`D:\网站测试\personal-blog\work\evidence\round3`。包含 `round3-matrix.json`、`legacy-native-rehearsal.json`、`final-directory-角色-宽度-主题.png`、`final-backend-upgrade-required.png`、`final-backend-retry-approved.png`，以及完整回归重跑的第一/二轮各专项截图。截图和依赖均在忽略的 work 内，不推送。

## 7. 测试记录与发布门禁

本轮新增：部署包/诊断/配置门禁 7/7、历史导入 3/3、最终 GUI 2/2，均 0 失败/0 跳过。首次沙箱运行 native initdb 被文件权限阻止（WAL 重命名），未计为通过；随后以本机隔离运行重新执行，上述数据库专项全部通过。没有连接外部数据库。

完整回归结果：**152 项通过，0 失败，0 跳过，0 取消**，497234.8063 ms，退出码 0；包含第二轮全部 140 项及本轮新增 12 项，没有删除或放宽旧断言。日志位置 `work/evidence/round3/full-regression-final.log`。Node 24.19.0、本机 Edge Chromium、PGlite 0.3.14、原生 PostgreSQL 18.4.0-beta.17、pg 8.16.3、jsdom 26.1.0、playwright-core 1.56.1；远端 CI 另用 Node 22/Linux Chrome，结果推送后单独记录。

生成器、SEO（8 个 canonical URL）、Secrets 检查、供应链字节/许可证 3 项、`git diff --check` 均通过。重复生成器的全部生成文件字节变化为 0；既有 27 项 SQL 与第二轮提交逐文件 LF 内容一致。未删除文章、媒体、旧测试或引入生产密钥。公开页缓存更新属于实际脚本修复；提交后会再次核对由真实页面提交日期产生的 sitemap 变化及生成幂等。

实现提交 `2e2968d84a7d573645973732e38fb9c3d1d24f68` 后再次生成，仅 gallery/moments 两个实际更新脚本缓存的页面 lastmod 变为 2026-10-19；旧文章 lastmod 仍为 2026-10-05，其他 URL 不变。这两处按真实页面提交日期生成并单独提交，不手工刷新旧文章日期。再次生成和 SEO/Secrets 校验保持通过。

## 8. Publisher 真实状态与后续阻塞

本轮重新查询到起始最新运行 [39131784521](https://github.com/HSHSpaceX/personal-blog/actions/runs/39131784521)，2026-10-18 21:29:45（上海），head 944ac7b。失败在 Reconcile，后续生成/verify/push/finalize 未执行。该次实际日志中的两个环境变量为空，`EXPORT_FAILED`；只记录是否为空，不输出真实密钥，也没有读取 Secrets 值。

当前 sync workflow 只 main schedule/manual、无 Environment，需可用的 Repository/Organization `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`；导入绑定 `community-release`，同名 Environment 值优先。现状为生产配置阻塞，自动发布业务链未验收。不能由日志推定项目匹配、权限、审批或分支保护已经正确；这些由站长核对。

缺配置 CLI 在适配器和公开文件写入前失败，基础能力缺失在 export/上传/写文件前失败。verify 对比当前批准指针/内容/精选/媒体；push 失败不 finalize，重试可修复中断。数据库通知不依赖 Publisher，公开精选变化仍等静态同步。三个会写仓库的 workflow 共用 concurrency group；外部 push 仍可导致普通 push 拒绝，需基于新 main 重验后重试。

## 9. 交付与仍未验收事项

四份正式文档：本报告、`FINAL_DEPLOYMENT_GUIDE_20261018.md`、`SUPABASE_OPERATOR_PACK_20261018.md`、`PRODUCTION_ACCEPTANCE_TEMPLATE_20261018.md`。离线完整包 `D:\网站测试\personal-blog\work\release\final` 包含实际最终 SHA、全部 SQL/校验和、兼容 fresh-install、最新导入清单和回执。老说明改为指向正式入口，历史 PR/分支背景保留但不再作为执行指令。

站长第一件事：阅读正式指南第 1～3 步，确认实际 Git SHA并备份生产数据库与 Storage，运行两份只读诊断确认完整边界。未备份、对象不完整、作者不符、权限/媒体/旧 URL 异常时停止。代码正常 revert/Cloudflare 回退不能回滚数据库，SQL/Storage 恢复需独立备份或审阅补偿事务。

生产迁移、Secrets 项目/作用域、真实邀请/重置/SMTP、Storage HTTP/TUS、真实精选通知、历史导入和自动同步→Pages 完整链仍未验收。不得因为本地或代码部署成功将它们标为通过。

## 10. 推送后核对

待全部本地门禁通过、普通 fast-forward 推送以及远端实际检查后更新。当前准备版本不能作为已推送回执。

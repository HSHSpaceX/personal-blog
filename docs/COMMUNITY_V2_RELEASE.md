# Community V2 最终发布 / RC 清单

这是 operator 执行手册，不是已经完成的生产操作。Community V2 统一 GUI 已整合，本轮完成统一管理与周期审核的 forward 改造。最终待合并分支为 integration/community-v2，对应现有 PR #4；不得在未验收前自动合并或执行生产 SQL。相关设计见 [Round 5](COMMUNITY_V2_ROUND5.md)、[Auth](AUTH_SETUP.md)、[Supabase](SUPABASE_SETUP.md)。记录环境、时间、操作者、commit、实际 HTTP 状态与截图，失败项必须关闭再继续。

## A. migration 正式顺序

当前共 22 个 migration。先备份数据库/Storage 配置，核对 schema_migrations 已执行记录；已有 migration 不重写、不重复执行。新测试/RC 项目按下列顺序完整执行；生产库只执行尚未应用的 migration，不能重新运行已经执行过的历史 migration。

1. 202609300001_invite_auth.sql
2. 202609300002_private_reactions.sql
3. 202610010003_security_hardening.sql
4. 202610050001_notifications.sql
5. 202610050002_admin_comment_bypass.sql
6. 202610060001_community_v2.sql
7. 202610060002_social_notifications.sql
8. 202610060003_submission_policy_and_schema.sql
9. 202610060004_private_assets.sql
10. 202610060005_content_review_notifications.sql
11. 202610060006_public_profiles.sql
12. 202610060007_comment_edits.sql
13. 202610060008_resource_center.sql
14. 202610070001_notifications_v2.sql
15. 202610070002_direct_messages.sql
16. 202610070003_publication_bridge.sql
17. 202610070004_category_raw_length.sql
18. 202610100001_safe_content_document.sql
19. 202610110001_periodic_review_and_management.sql
20. 202610110002_private_media_and_legacy_bridge.sql
21. 202610110003_site_settings.sql
22. 202610110004_idempotent_messages.sql

第 18 项必须在 202610070004_category_raw_length.sql 之后执行，用于统一富文本编辑器的安全结构化正文 `body.document = { version: 1, blocks: [...] }`。未应用时，新版 Community 富文本保存可能失败；前端错误提示不能代替迁移，也不能通过放松 RLS 修复。

在独立 RC 项目实际检查文档结构白名单验证、链接协议限制、封面资源归属与图片 MIME 验证，并确认旧纯文本 revision 仍兼容。使用普通用户测试投稿、管理员审核、拒绝重编和静态发布，再核对资源引用与公开版本。CI 全绿不代表真实 Supabase Storage/Auth 已验收；真实 HTTP、邀请登录与 Cloudflare 配置仍须按以下步骤验收。service_role 凭据不得放进前端、公开仓库或日志。

检查 function 固定 search_path、表/列 grants、RLS、restrictive policies。service_role 是 Supabase 已有数据库角色。不要开启客户端 service_role 权限。

## B. 正式 Supabase Auth

关闭公开 sign-up，使用邀请制；guest/user/admin 从 verified Auth session 与 user_roles 判断，metadata 不赋权。Site URL 为正式 `https://hsh-personal-blog.pages.dev/`；redirect allowlist 明确覆盖正式 login reset 地址和受控 Preview 地址。核对 SMTP、邮件模板、token 过期；前端只配置 public publishable key。RC 使用独立 Supabase 项目，Preview public config 必须对应 RC 项目，不能让 Preview 的写操作落入生产。

## C. 创建正式 admin

用 Dashboard/受信任服务器邀请或创建账号，确认 profiles/user_roles 已生成，再由 operator SQL 将明确 UUID 的 user_roles.role 改为 admin。配置至少两个管理员，不从 email 字符串、username 或 raw metadata 推断权限；网站客户端不能提权。验证 admin 拥有全部普通社交能力。

## D. legacy_author_id

确认真实站长 Auth UUID 与 profiles.id 后，operator 执行带自己核实 UUID 的 SQL（示例值不是真实账号）：

```sql
update public.community_publication_config
set legacy_author_id = '00000000-0000-4000-8000-000000000000'::uuid
where singleton;
```

替换示例前必须核对账号；FK 会拒绝不存在的 profile。username 改名不重映射 owner。用 service publisher 同步目录，测试 known legacy 内容的点赞/评论通知归属；未配置 owner 时不得通知任意猜测用户。

## E. GitHub Repository Secrets

在 Repository Actions Secrets 安全配置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY；不要粘贴聊天、提交 Git、写日志、Cloudflare 前端变量或 site.config。项目 URL 必须与正式前端 public config 一致。Git 写权限使用 workflow GITHUB_TOKEN(contents:write)，核对仓库 Actions 写入权限/branch protection bot 规则。先在独立 RC 仓库 main 与 RC Supabase 验证 workflow，不在 feature/PR 强行绕过 guard。

## F. buckets / policy

核对 community-assets=false、dm-media=false、published-media=true。后者允许 guest public read；user/admin/anon 对 object 的 INSERT/UPDATE/DELETE 全拒绝，包括意外宽泛 policy 存在时。只有 service publisher 可上传/清理公开副本。登记必须 UID 路径、不可覆盖；检查 Storage 实际 MIME/size、Content-Type（TXT=text/plain）、浏览器下载行为。校验是基础格式检查，不是服务器内容扫描。被任何私有历史 revision 引用的原件禁止删除。

## G. Cloudflare Preview

部署 integration/community-v2 / PR #4 commit 到独立 Preview，前端采用 RC public config。人工核对正式 canonical（Preview 不生成自己的 SEO canonical）、noindex 功能页、375px 与 desktop、JS cache version、CORS、公用媒体可读取。fixture 可生成测试站，真实 RC approved 数据仅经 RC 仓库 main publisher。核对 GITHUB_TOKEN bot push 是否触发 Pages 部署及部署完成时间；published 状态不替代 Cloudflare build success。

## H. A/B/C + 两 admin

邀请 A/B/C 和两个 admin；游客另开无痕窗口。A/B 社交、投稿、修改、驳回重编；C 持他人 revision/edit/thread/message/asset UUID 深链接全部越权失败。user 不能提权或改 rules；两 admin 并发审核只能决定一次，自己的内容直接 approved。admin 不是 DM 参与者时与 C 一样拒绝；管理员个人通知只能本人读，审核队列独立。验证退出、A→B、降级、线程切换及延迟请求不会复现旧内容/签名 URL。

## I. Community Storage HTTP

用真实 anon/A/B/admin JWT 分别通过 Storage HTTP upload/read/sign/list/update/remove。A 私有原件由 A 读取；管理员仅可读取提交审核版本实际引用的资源，不能列出他人未提交资源，B/guest 拒绝；目录伪造、覆盖、他人引用、referenced 删除、registration/delete race 拒绝。orphan cleanup 只清自己 uid 且无 registry。记录状态码；不只用浏览器 UI 判断。对公开副本 user/admin PUT/DELETE 拒绝；已发布图像 guest 200；旧副本全量清理后不存在，私有原件仍存在。

## J. DM Storage HTTP

未发送 dm-media 图片仅 sender 可签发/读取/删除，recipient/C/非参与 admin 拒绝；发送后仅 thread 两方可读且不可删，第三方/admin UUID 深链接仍拒绝。SVG/HTML、错误 MIME/size/path、别人 asset 绑定均拒绝；单条≤4 图、单图≤8 MiB。签名 URL 短期失效；注销清 DOM 不代表服务端提前撤销已签 URL。publisher 从不读/copy dm-media。

## K. Invite

正式邮件从邀请链接进入允许的 login/reset 流程，完成设密码并登录；邀请过期/重复使用正确失败。不出现 signUp，游客不能投稿、评论写入或 DM。核对邮箱不进入 public profile/导出文件。

## L. Forgot Password

正式 reset 邮件及手机浏览器回跳正确，token/password 不进日志或 URL 以外公共文件；Auth session 验证及账号切换安全。检查 site URL、redirect allowlist 与邮件投递，不用生产用户密码做自动化测试。

## M. Community 投稿 → 静态发布

A 分别 article/moment/album；draft/pending/returned/trashed 不能出 snapshot/Storage/SEO/search。默认 N=1，每次首次发表须人工审核；配置 N=3 时依次自动、自动、人工，三个类型分别累计所有首次批准，包括自动批准。普通用户修改公开内容始终人工审核，不重复计数；admin 自己直接 approved。退回和回收站原因只作者/admin 看，恢复不等于重新发布。

批准 → state pending → main publisher 完整 snapshot/media → offline generate/SEO/security → verify → bot push → finalize CAS → state published。等待 Pages build 完成，检查正式文章/动态/图册媒体与评论点赞通知。 pending 修改保留旧版本，新 approved 替换；历史不导出；item/账号删除后下轮删除页面/公开副本。模拟媒体失败、Git 非 fast-forward、回写失败、重复 schedule，下一次收敛且无空 commit。观察 publication errors 固定代码，不含 credentials。

## N. legacy admin 发布

网站已停用全部 PAT 输入和 GitHub Contents 写入，旧 admin 入口转到统一账号中心。按下文 legacy dry-run 审阅清单后，由受控 main workflow_dispatch 导入；不由本机执行生产迁移。旧公开路径和互动标识由映射保留，未导入前仍可公开阅读。

## O. sitemap / feed / Bing / IndexNow

所有公开文章正式 canonical、OG、article:published_time、description 25–160 Unicode、图片 alt。首页/归档分类与标签/时间线/搜索找到 Community article；legacy 作者保持 HSH，新作者真实身份。login/admin/account/messages/profile（及其功能入口）保持 noindex、适当 nofollow、不进 sitemap/search。公开页 footer 无管理登录链接，admin 登录后动态生成。

核对正式 sitemap/feed/robots，Bing live inspection 抓取无 internal noindex 警告来源；搜索平台刷新有延迟。Pages 部署完成后手工运行既有 IndexNow workflow，仅提交 sitemap 正式 URL。静态 generator 不调用搜索引擎。

## P. 验收 integration/community-v2 / PR #4 → main

RC A–O 记录完成且负责人确认后才审查现有 PR #4；检查 migration 历史 hash 和完整 CI 全绿、配置备份、回滚点。该开发任务不执行 merge。正式 secrets/迁移/配置就绪后，由操作者按发布窗口合并；main schedule 从此激活，每 5 分钟只是兜底频率，GitHub schedule 可能延迟。

## Q. Production smoke

确认生产 Pages commit、部署成功、Auth/邮箱、游客公开内容、A 普通账号投稿/社交/消息、两个 admin 审核、Storage HTTP 授权、通知/DM isolation、375px、sitemap/feed/IndexNow。核对 service key 未出 HTML/JS/JSON/log，检查 publication_state failed/pending 队列并记录缺项。不要用“Git push 成功”宣称 Pages 已可访问。

## R. rollback / 重试

先暂停 sync schedule/workflow（或禁用该 workflow），避免恢复代码马上被自动发布覆盖；备份当前 DB 和 snapshot/公开媒体。代码问题通过新的 revert commit/Pages 已知安全部署回滚，不 force push、不改已执行 migration；数据库修复新增 migration。

普通同步失败：修 Secret/URL/安全文件名/MIME/格式/冲突/branch protection/网络后 main dispatch，下次全量导出恢复。Git 已推送而 state/cleanup 失败：同 revision 没有 diff 仍 finalize，补状态并清理 public prefix。回滚页面若引用已清理旧公开副本，必须由 operator 从仍保存的私有原件准备受控恢复，或优先重新发布当前 approved snapshot，不能直接把历史 revision 当当前版本导出。

若误公开敏感内容，先受信任 SQL 移除 authority 公开指针/删除 item，再 full sync 并清 Pages/Storage CDN 缓存；互联网副本不能保证撤回。疑似密钥泄露立即轮换 Repository Secret / Supabase service key 并审查日志及 Git 历史，不将旧密钥留在回滚文件。重试只针对当前 authority，禁止为重试开放 private bucket、扩大客户端 grants 或让 admin 查看别人 DM。

## S. 本轮 forward migrations 与统一管理验收

第 19–22 项严格按清单顺序接在第 18 项后，只执行尚未应用的文件。旧 18 个 SQL 文件保持原始内容。19 为每用户、每类型正整数周期（默认 N=1）、首次发表账本、三种审核结果、回收站和精选；20 为仅限审核引用的管理员媒体读取、90 MiB、受控历史映射；21 为验证管理员身份后的安全站点文案；22 为私信发送重试幂等键。

旧累计信任门槛不能翻译为新周期：迁移审计旧规则并设安全默认 N=1，首次发表账本从所有已批准首次版本回填，包括自动发表。N=3 时自动、自动、人工；文章/动态/图册分别计数，修改始终人工审核。退回不计数，回收站只软删除拒绝版本；已经公开的旧安全版本继续可见。未处理的第 N 次关口阻止后来投稿自动通过，管理员恢复后仍须重审。评论与回复保留独立审核。

资源中心和编辑器共用 main 的卡片/工具栏。文件上限恢复为 90 MiB，超过 6 MiB 使用 Supabase TUS 6 MiB 分块上传；RC 必须真实测试边界、断网、账号切换、MIME 验证和 Storage 的限制，修改 bucket 限额不能代表项目套餐允许对应大小。引用中资源不可删除；清理失败保留对象供本人重试。签名仅显示 60 秒，正文只记录 UUID，不持久存储私有正文或签名。

站点文案保存后进入服务端发布队列，发布器同时生成安全的 js/content.js 和静态 about/index。保存成功不等于审核或 Cloudflare 已部署；发布失败展示可重试状态，Git push 冲突不得强推。精选管理只允许管理员操作已发表文章；重复设置不重复通知，取消后重新精选形成新事件。featured.html 为公开专题页。

## T. Legacy 预检、导入与回滚

1. 在明确的候选 main commit 上执行 `node scripts/legacy-community-import.mjs --output <私有审阅目录>/legacy-plan.json`。此命令没有网络和数据库写入；保存打印的 SHA256、commit 与操作者，核对全部公开文章/动态/图册及文件字节摘要。私有图册不会进入清单。预检发现原 main 中一个 .jpg 文件实际为 PNG；清单显式记录 extension_mismatch，新增私有副本按真实 MIME 使用 .png，不改原文件字节或公开路径。原文件全部保留，不能删除 assets 或改原 slug、日期、分类、标签、精选、点赞/评论目标。
2. 在独立 RC 环境完整应用迁移，配置真实 legacy_author_id。审阅安全 HTML 到结构化正文的转换；脚本先验证所有正文、文件 MIME/magic/90 MiB 边界，再执行全量 slug/source 冲突预检，任何不安全或不支持内容都停止，不静默丢弃。
3. 为 `community-release` GitHub Environment 配置审核人并限制 main。使用受控 server secrets，不把任何 service_role 放进前端或清单。由站长在 main 的 Reviewed legacy Community import 手工输入已审 SHA256 与核实的 owner UUID；脚本再次生成和比较同一 commit 清单，生产导入必须经过该流程审批。本任务没有实际运行它。先将服务器配置指向 RC 测试同一流程。
4. 上传使用只新增对象和确定性文件摘要路径；已有文件只读并比较字节，不覆盖。登记 RPC 从真实 Storage 元数据验证 owner/MIME/size。导入按来源映射幂等，每项事务创建安全 revision、审核审计、首次发表账本；中断后同清单可安全重试。不要修改历史映射来绕过摘要或 slug 冲突。
5. 运行现有 main 静态发布 workflow，核对映射条目只替换一个原卡片、旧 URL/评论/点赞 ID、原日期、精选与个人主页，以及 owner 在唯一编辑器中的修改/审核。后续修改重新审核，拒绝时旧公开版本继续存在。未迁移内容由界面明确标记等待导入。
6. 回滚先停止 publisher/import workflow，备份映射、审核账本和 Storage，使用原 `pre-community-v2-20261007` tag 审阅并正常创建恢复提交；不删除 tag，不 reset/force push。数据库和对象不能直接删除，按审计记录由站长制定补偿迁移。已发布资源清理必须在 Git push 成功后进行，私有原件和私信对象永不由发布器清理。

## U. 实际 RC 与 Pages 验收

本机 fixture、PGlite、Chromium 及 CI 原生 PostgreSQL不能替代真实部署。独立 Supabase/Cloudflare RC 要验证邀请/邮件回跳、两个普通账号和两个管理员、RLS 与签名 HTTP、90 MiB TUS 中断恢复、三种审核/周期并发、精选通知、历史导入、资源删除保护、私信双人权限/已读/失败重试，其他用户与非参与管理员均不能读取私信。消息仅在站内刷新/轮询，无离站推送承诺。

Cloudflare Preview 使用 RC 公共配置，production branch=main；核对最新候选 SHA、实际部署 URL、Auth redirect allowlist、noindex/sitemap/canonical、缓存更新和静态发布实际延迟。PR #4 保持 open，确认以上记录后由用户决定正式合并与部署。

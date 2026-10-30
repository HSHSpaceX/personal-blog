# Supabase 专项升级包

执行入口为 [正式部署操作手册](FINAL_DEPLOYMENT_GUIDE_20261018.md)。这里给出数据库分流、文件顺序、权限证据和停止条件。**生产 SQL、真实导入和 Secrets 尚未由本地开发执行。**

2026-10-30 更新：[Storage 兼容修复操作单](STORAGE_COMPATIBILITY_20261030.md) 指定当前候选第 22 项的唯一升级路径：生成包只读诊断 → **生成的兼容第 23 项** → 历史原文第 24、25、26、27 项。下面列出的 27 份是不可改写的历史源文件清单，第 23 项执行时必须用生成副本。已经应用旧 23 的环境使用独立 `repair-applied-23.sql`，不能重跑第 23 项。

当前包为 revision 2：只读诊断新增已有登记与残留删除预约检查，登记/删除检查原生 owner 一致性。若已使用提交 `98cf633` 的兼容 v1，使用 `repair-compatible-23-v1.sql` 单独前向补丁；不要使用面向历史原版的 `repair-applied-23.sql`，也不要重新执行兼容第 23 项。两条补丁均核对准确目录并拒绝重复执行。

## 1. 完整迁移顺序：实际枚举 27 项

下列文件均位于 `supabase/migrations/`。历史文件不改写；生产只执行确认尚未应用的完整事务。迁移不是可随意重跑的幂等安装脚本。

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
23. 202610130001_storage_compatibility.sql
24. 202610130002_release_contract.sql
25. 202610130003_review_queue.sql
26. 202610130004_moment_deletion.sql
27. 202610180001_article_settings_and_profile_search.sql

第 27 项为第二轮新增，站长尚未在生产执行。本轮没有新增第 28 项，也没有重写任何 migration。第 27 项 LF SHA256 为 `d812f8e534f46d94693806558baa0fc4842c067930871dabc4220a7062bc1ead`；全部文件与兼容副本摘要见交付包 manifest。不同平台 CRLF 字节摘要可能不同，规范化 LF 后核对来源；不能修改 SQL 后继续使用旧摘要。

## 2. 第 27 项的依赖与权限

| 对象 | 用途与约束 |
| --- | --- |
| `community_article_preferences` | `revision_id` 主键与 RESTRICT 外键，管理员本人文章的草稿精选意图，字段 `featured`、`applied_at`；不是正文属性。 |
| `community_save_featured_preference(uuid,boolean)` | 只允许 authenticated 中真实管理员操作本人未删除文章草稿；周期锁 → item 行锁 → revision 行锁。 |
| `community_submit_featured_article(uuid)` | 同样身份/所有权约束；调用既有批准规则，再调用受保护精选，在同一事务完成，失败一起回滚；重复已应用版本安全返回。 |
| `community_set_featured(uuid,boolean)` | 替换函数体，仍仅管理员、已批准当前公开文章；不创建正文 revision。非精选→精选才通知，自己文章不自通知。 |
| `profile_search(text,integer,integer)` | anon/authenticated 可调用；关键词 2–80 字，limit 1–20，offset 0–200，仅 id/username/display_name/avatar_url/bio，`%`、`_` 是字面字符。 |

依赖前 26 项中的 `is_admin()`、`auth.uid()`、不可变 revision、周期锁、既有提交/精选、通知、发布状态与审核结构。不能跳过前置文件单独安装。所有新 SECURITY DEFINER RPC 固定空 `search_path`，撤销 PUBLIC/anon 管理写权限；preferences 启用 RLS，仅 authenticated 管理员本人文章可 SELECT，客户端没有直接写表权限。

精选通知从当前已批准版本读取标题，最多 160 字，存储纯文本；旧通知不回填、不随新标题改写。重复 true 不通知，取消不通知，再次 false→true 生成一次事件。封面 UUID 纳入 revision 资源引用，历史引用继续保护删除；Publisher 仅导出已批准版本引用，签名 URL 不写正文。

## 3. 只读检查与五种数据库状态

在 SQL Editor 新建独立查询，依次运行仓库 `supabase/preflight.sql` 和 `supabase/postflight.sql` 全文。两者均 `BEGIN ... READ ONLY` 后 `ROLLBACK`，不建业务对象、不读消息正文、不改变账号或配置。postflight 用事务局部设置暂存 JSON 报告，回滚即清除。

preflight 给完整目录证据：托管所有者/RLS、原生 Storage 唯一索引、外键、列、函数签名/ACL、触发器、策略、角色授权和 bucket。postflight 对缺对象先判断存在性，捕获版本函数诊断错误码；空库和部分升级也能返回结果。

| `installation_status` | 解释/操作 |
| --- | --- |
| `base_state=ready, round2_state=missing` | 基础 20261013 发布检查通过；第 27 项表/三个新增 RPC 全缺。仍须核对前 26 项完整定义与历史，再执行 27 一次。 |
| `ready / ready` | 基础对象与第 27 项关键结构、RLS、ACL、固定 search_path 和精选通知函数检查通过；继续真实 HTTP 验收。 |
| `not_installed / missing` | 未发现内容/私信业务安装；仍检查是否存在其他局部对象，确认完全空业务库后才可 fresh-install。 |
| 任一 `incomplete`，或与已确认边界不符的缺失/异常授权 | 停止。报告只说明对象证据，不证明某个 migration 曾完整提交；不能自动补 SQL 或伪造 history。 |

五种安装状态：

| 状态 | 安装/恢复路径 |
| --- | --- |
| A 全新 | 离线运行 `node scripts/build-compatible-install.mjs --output work/release/compatible-install`，审阅 manifest，在空业务库运行生成的 `fresh-install.sql` 单事务一次。 |
| B 原版完整 | 对照成功记录和实际对象；未应用旧 23 先运行候选 22 只读诊断，再用兼容 23；已应用旧 23 的已知边界先运行独立修复，再续接缺失文件。原历史触发器保留。 |
| C 删减版私信 | 不重跑第 15 项建表 SQL。运行生成的 `diagnose-boundary-22.sql`，完整边界及 Storage 校验成功后，使用生成的兼容第 23 项和历史原文 24～27。 |
| D 文件内部分安装 | 停止，备份并保存全部对象目录、错误、SQL 执行文本；在隔离副本逐语句找出缺口，由维护者审阅补偿事务。不能 fresh-install 覆盖。 |
| E 第 23～27 项部分安装 | 完整事务之间的已知边界可继续后续文件；文件内残缺按 D。基础版本 20261013 不能证明第 27 项完成。 |

边界证据：23 增加 tombstones/业务登记保护及删除完成；24 引入 release preflight 和 capability（当时 version=0）、原子草稿与文案版本；25 引入统一审核队列/首次发表时间；26 完成动态删除/图册容器并启用 version=20261013；27 是本节新增结构。必须结合完整函数/触发器/约束定义核对，单个标志不够。

SQL Editor 不自动写 `supabase_migrations.schema_migrations`。CLI `migration list` 与实际结构不一致时，不直接 `db push`，也不先用 `migration repair` 标成 applied。由维护者在已证实完整边界后审阅 history 对齐；history repair 只改记录，不执行缺失 SQL。参考 [官方 migrations 文档](https://supabase.com/docs/guides/deployment/database-migrations)。

## 4. 原版、删减版与托管 Storage

删减版第 15 项缺少一个 `storage.dm_media_object_path` 局部唯一索引，以及 `dm_media_immutable`、`dm_media_orphan_guard`、`dm_media_delete_cleanup` 三个 storage.objects 触发器。其他 RLS、私有 bucket、参与者策略、业务外键仍需完整；不能将“删减版”理解为任意残缺库。

兼容第 23 项不修改托管表所有者、不新增托管索引/触发器。它将 `dm_assets`、`user_assets` 到 `storage.objects` 的 CASCADE 外键改为 RESTRICT；业务登记触发器、对象行锁、删除预约与 tombstones/显式完成清理保证原子保护。restrictive UPDATE 策略仍禁止改路径/覆盖元数据；已发送私信与历史 revision 引用不允许删除。支持旧版原生全局 `(bucket_id,name)` 唯一约束，或新版精确 `WHERE archived_at IS NULL` 的原生当前行唯一索引；核对实际定义和状态，不能仅看索引名。新版两个私有 bucket 必须保持 `DISABLED`，有效文件还须排除删除标记。归档行和标记不参与登记、孤儿列表和完成清理检查。

生成器只为全新安装移除三份历史 SQL 中受限的托管索引/触发器 DDL，源摘要锁定，不改变原文件。`manifest.json` 列出每项移除对象和替代保护。不要手工再删 RLS、业务外键、登记触发器或把 Storage 改公开。若托管平台拒绝 bucket/标准策略安装，停止并按 [官方 Storage schema](https://supabase.com/docs/guides/storage/schema/design) 核对权限。

| Bucket | 可见性与限制 |
| --- | --- |
| `community-assets` | 私有，90 MiB，image/jpeg、image/png、image/webp、video/mp4、application/pdf、text/plain；本人所有权/审核引用边界。 |
| `dm-media` | 私有，8 MiB，JPEG/PNG/WebP；只有会话参与者可读已发送引用，非参与管理员也不可读。 |
| `published-media` | 公开读取；只有服务端发布器写批准资源，浏览器角色不能写。 |
| `avatars` | 公开读取，2 MB，JPEG/PNG/WebP，用户只改自己的头像。 |

## 5. 管理员与历史作者 UUID（站长显式执行）

先在 Authentication → Users 核对站长真实身份，复制 UUID。正式指南第 4 步提供只读核对。以下是可审阅的写事务模板，**仅站长确认后执行**；占位符必须换成同一个真实 UUID。若现有配置正确，不执行。

```sql
begin;
do $$
declare confirmed_owner uuid := 'REPLACE-WITH-VERIFIED-OWNER-UUID';
begin
 if not exists(select 1 from auth.users where id=confirmed_owner)
  or not exists(select 1 from public.profiles where id=confirmed_owner)
  then raise exception 'Verified Auth user and profile required';end if;
 update public.user_roles set role='admin' where user_id=confirmed_owner;
 if not found then raise exception 'Existing role row required; stop and diagnose';end if;
 if exists(select 1 from public.community_publication_config where singleton
  and legacy_author_id is not null and legacy_author_id<>confirmed_owner)
  then raise exception 'Existing legacy owner differs; stop';end if;
 update public.community_publication_config set legacy_author_id=confirmed_owner where singleton;
 if not found then raise exception 'Publication config missing';end if;
end $$;
commit;
```

不按邮箱前缀/metadata 批量授权；不更改其他用户角色或已导入内容作者。邀请制、重置回跳、SMTP 步骤见正式指南。迁移成功后单独运行 `NOTIFY pgrst, 'reload schema';`，然后 postflight 和真实网页/RPC 检查。

## 6. 真实托管 HTTP 验收，尚未执行

在生产验收模板记录每项“已通过/未通过/未测试/不适用”，保存时间、角色、请求状态码与遮密截图：

1. 游客可读公开首页/旧 URL，不能读两个私有 bucket 的对象或私有列表；anon 可检索受限公开用户。
2. 普通 A 上传图片、视频、附件；资源登记、签名预览/过期刷新、删除未引用资源正常。B 和非引用管理员不能读 A 的资源；A 的管理员不因管理身份获得任意删除权。
3. 图片作为仅封面保存、重开、换封面、正文复用、清除，引用集合去重且不插正文图片块；历史版本仍引用的文件不能删除。
4. >6 MiB 使用 TUS 上传，验证中断/恢复、账号切换取消、90 MiB 上限及超限拒绝；不要用本地模拟结果代替这些 HTTP 检查。
5. A→B 发送私信图片，参与者可读，第三人及非参与管理员不可读；已发送图片不能删除。清理与登记竞争不出现同路径复用。
6. 普通用户三种内容分别按 N=1/2/3 审核，草稿/失败不计数，修改已发表不增加首次计数；管理员直接发表不自审，两个管理员不能重复处理同一 revision。
7. 管理员文章精选原子提交、普通用户越权拒绝；用户文章精选通知带真实标题、链接正确、重复 true 不重复通知。未批准稿不能提前精选。
8. 用户搜索仅返回公开字段，空关键词不能枚举；新 RPC 缺失明确提示，原静态内容搜索可用。

## 7. 发布配置与可重试边界

`sync-community-public.yml` 当前无 Environment，两个同名 Secrets 应在 Repository（或允许该仓库使用的 Organization）作用域：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。历史导入 job 绑定 `community-release`；其 Environment 同名值会覆盖 Repository 值，站长需核对。不要在本地测试使用生产服务密钥。

Publisher 基础契约仍为 20261013，缺配置/基础能力在公开文件写入前中止。第 27 项是编辑器/搜索新增能力，不能仅凭 Publisher 基础检查证明其安装。无数据库写入的静态阅读继续使用现有快照。通知由数据库精选事务生成，与 Publisher 成功无关；取消精选等公开列表变化要等待后续同步/Pages。

同步、生成与导入共用 Actions `generate-static-site` concurrency group。正常 push 受分支保护约束；外部普通提交竞争可能使 push 被拒，届时保留旧公开状态，重新基于最新 main 校验后重跑。verify 在提交前复查权威指针，finalize 在 push 后执行且可重试；生产目录清理只涉及发布派生媒体，不能清掉私有源文件。

GitHub 的 `GITHUB_TOKEN` 推送通常不触发新的 Actions push 运行，不能假定 bot commit 有新一轮 CI；需核对原同步工作流内的验证、最终部署 SHA，必要时站长手动运行 regression。不要引入 PAT 规避该规则。见 [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。Cloudflare 作为 Git 集成应用的部署需单独检查。

## 8. 失败恢复和停止条件

未提交的单文件事务发生错误，先 ROLLBACK 并保存结果；已成功的历史事务不反复运行。部分安装、所有者/约束/ACL 异常、UUID 不匹配、媒体字节冲突、私有泄漏、旧 URL 或内容丢失均停止后续写入。先在隔离备份验证补偿方案，再由站长操作生产。

代码回退用普通审阅提交或 Cloudflare 已知版本，数据库/Storage 使用独立备份与前向补偿。代码 revert 不会还原数据库；删除 migration 文件也不是回滚。Secrets 修正后可重试 Publisher；同 SHA/清单/作者的历史导入可重试，绝不能用换作者、改映射、覆盖旧对象来“修复”。

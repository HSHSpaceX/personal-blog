# 2026-10-31 生产修复执行记录

> 22:25 更新：经过集中批准，第 18 项专用前向修复及兼容版第 23～27 项已在正式项目全部提交，完整第 22 项边界曾在修复后通过，升级后 postflight 为 ready/ready，原有数据和托管 Storage 结构保全检查通过。最新执行记录见 [PRODUCTION_MIGRATION_20261031.md](PRODUCTION_MIGRATION_20261031.md)。下文保留升级前的审计证据与当时状态；Publisher、真实账号验收及历史导入仍未完成。

以下为升级前采集的审计记录。目标项目仅为 `hscqeswnscnvkdthhlfp`，站点为 <https://hsh-personal-blog.pages.dev/>。没有连接或使用旧测试项目。本文不包含密钥或数据库备份。采集当时生产数据库尚未升级；当前数据库执行结果以上方更新及最新迁移记录为准。

## 已核实的安装边界

MCP `get_project_url` 返回正式项目 URL。生产为 PostgreSQL 17.11，本机隔离测试为 PostgreSQL 18.4 和 PGlite。实际完整目录对比只有以下八项不一致：

- `community_validate_inline(jsonb)`：函数及 EXECUTE ACL 两项缺失。
- `community_validate_document(jsonb,uuid[],integer,text)`：函数及 EXECUTE ACL 两项缺失。
- `community_check_document_cover()`：函数及 EXECUTE ACL 两项缺失。
- `community_validate_body(text,jsonb)`：保留 `202610070004_category_raw_length.sql` 中的旧实现。
- `content_revisions.community_document_cover`：触发器不存在，没有可检查的启用状态。

旧 body 函数 owner 为 postgres、IMMUTABLE、SECURITY INVOKER、空 search_path，ACL 为 postgres/service_role。普通角色无 EXECUTE 权限。其规范化摘要 `f2c93cab10136fef4b8a3891a82a4d6f` 已由本地执行原始历史 SQL 独立复现。三个新函数和触发器实际不存在，故不是 PostgreSQL 版本、换行或哈希算法问题。证据支持“第 18 项未生效/遗漏”；无法仅凭目录确定是当时跳过、回滚还是事后撤销。

旧 validator 不允许 document/cover_asset_id 字段，富文本保存会失败；独立封面归属及图片类型检查缺失。不能把当前状态加入正常边界白名单。其余第 22 项目录与基线一致，生产 seed/backfill 不变量及 Storage/登记完整性检查通过，但完整第 22 项尚未成立。

修复生成器只提取三个缺失函数、一个 validator 替换和一个缺失触发器，保留原始迁移文件不变。前置状态由历史基线推导，严格拒绝额外差异；修复后重新执行完整边界检查。整个修复为单事务，设置 10 秒锁等待，并验证已有 revision 的文档与封面。重跑会被拒绝。正常第 23 项入口仍只接受完整第 22 项。

## Storage 和数据保全

生产 `dm-media` 与 `community-assets` 均为私有，versioning_status 为 DISABLED。关键索引与新版 fixture 一致：版本唯一索引含 NULLS NOT DISTINCT、当前对象部分唯一索引、未版本化对象部分唯一索引、删除标记索引。未修改托管表、索引或 owner。

采集时：3 个用户/资料、1 个 content item、0 个 revision、2 条评论、0 条私信、1 个 dm_asset、0 个 user_asset；删除预约为 0。Storage 有 25 个头像和 1 个私信对象，无历史版本或删除标记。私信对象登记、owner、路径和 metadata 一致。现有业务外键为 ON DELETE CASCADE，兼容第 23 项将安装引用及删除保护。

现有测试覆盖原版/删减版安装、新旧 Storage、已发送图片、历史 revision 引用、跨用户与管理员隔离、当前/历史对象、tombstone、预约失败恢复、并发锁顺序和回滚。托管 HTTP/TUS 不以 SQL fixture 替代。

备份位于仓库外 `D:/personal-blog-backups/20261031-pre-migration/`：

- `database-rows.json`：同一次 repeatable-read 只读事务导出的 public/auth/storage 68 张表、281 行。
- `database-catalog.json`、`database-sequences.json`：函数、表列、约束、索引、策略、触发器、权限及序列资料。
- `storage-manifest.json`、`storage-files/`：25 个公开头像实际文件，大小与 SHA256 已校验。
- `application-rows.sql`、`local-restore-evidence.json`：33 张业务表的恢复材料与本地恢复证据，数据比对和外键检查通过；恢复副本升级后 base_state/round2_state 都为 ready。

**备份仍不完整**：1 个私有 Storage 文件尚缺下载权限，没有数据库原生 pg_dump 归档，也未证明整个托管 Auth/Storage 可恢复。上述材料不能当作完整 Supabase 灾备。数据库备份不包含 Storage 文件，参见 [Supabase 官方说明](https://supabase.com/docs/guides/platform/backups)。备份含私人数据，仅保存在 D 盘，不可提交 Git。

## 头像修复

站长已纠正原反馈：普通用户上传正常，是操作误会。本次没有修改用户角色、头像 bucket 策略或资料更新 RLS。

旧内容固定使用 assets/icon.jpg，Community 静态快照也保留发布时的头像。现在作者图像携带既有用户标识，页面批量读取公开 profiles 的 avatar_url，优先使用已有 UUID，否则使用原有 username。只更新图像，不改变作者姓名、内容归属或 URL，不根据昵称/管理员角色推断作者。UUID 缺失的历史内容仍沿用既有 hshspacex 关联；历史导入归属需要另外确认。

刷新不依赖登录或新 RPC：仅带公开 apikey，credentials=omit，不传当前用户 JWT；最多每批 50 个标识，页面内去重缓存，网络失败保留静态图。拒绝脚本、含凭据 URL、私有签名 URL 等；本地相对图像尊重文章页 base URL。动态新增卡片也会刷新。发布快照及原始静态内容仍能离线显示。

已覆盖首页、文章、动态、时间线、归档列表、画廊桌面与移动浏览器测试，以及普通成员 UUID、恶意 URL、后插入卡片、请求去重与离线回退 DOM 测试。个人主页、评论/用户卡片复用 PublicCards；用户搜索头像携带用户 UUID。未做真实账号上传操作。

静态生成额外修复了 Windows CRLF 输入导致后续 HTML 标签被误删的问题。生成器先将输入规范化为 LF；专门测试确认两种换行生成完全相同的文章，保留浅色/深色 favicon 与主题初始化脚本。生成器、Publisher 与头像浏览器相关 9 项测试全部通过。

## 生产只读 HTTP 与发布器

`/auth/v1/settings` 返回 200：disable_signup=true、mailer_autoconfirm=false、email 登录开启。公开 profiles 返回 3 个用户，三个当前头像 HTTP HEAD 均为 200/image/jpeg。邀请投递、重置邮件、SMTP、登录退出、跨账号 Storage HTTP 和 TUS 尚未验收。

[核查的 Publisher 失败](https://github.com/HSHSpaceX/personal-blog/actions/runs/41185794406) 因 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 缺失。初查 Repository Secrets 为空；随后通过本机既有 Git 凭据与 GitHub sealed-box 加密 API 设置并核验 `SUPABASE_URL`，仍缺 `SUPABASE_SERVICE_ROLE_KEY`。工作流没有绑定 Environment，故其他 Environment Secrets 不会自动注入。没有创建或读取 Supabase 服务端密钥，没有触发 Publisher 写入生产。

## 生产执行清单（尚未授权执行）

先补齐并验证备份、确定维护窗口，然后申请一次生产迁移批准。由以下命令生成绑定实际提交的包：

```powershell
node scripts/build-final-operator-pack.mjs --output work/release/final
```

按 manifest 校验源文件及安装文件 SHA256。执行顺序：

1. `compatible-install/diagnose-missing-document-18.sql`（只读，已在生产通过）。
2. `compatible-install/repair-missing-document-18.sql`。
3. `compatible-install/diagnose-boundary-22.sql`（完整边界必须通过）。
4. `compatible-install/202610130001_storage_compatibility.sql`（只用兼容版）。
5. `supabase/migrations/202610130002_release_contract.sql`。
6. `supabase/migrations/202610130003_review_queue.sql`。
7. `supabase/migrations/202610130004_moment_deletion.sql`。
8. `supabase/migrations/202610180001_article_settings_and_profile_search.sql`。
9. `NOTIFY pgrst, 'reload schema';`；运行 preflight/postflight、RPC 权限、Storage 完整性与数据保全对比。

每步保存开始/结束、SQL 摘要和结果。失败即停止后续写入，失败事务回滚；不可通过重放 1–22 或放宽 RLS 绕过。已提交步骤不自动反向拆除：保留现场与备份，设计新的前向修复；涉及恢复覆盖生产数据必须另行审批，并处理备份之后的新数据。

## 后续验收与历史导入

受控真实 HTTP 验收还需批准专用账号、测试路径、数量、清理方式。不得公开发布测试内容，除非另获批准。完成数据库/Auth/Storage 验收后，才能确认历史作者 UUID、最终清单并申请真实导入授权。

本次 dry-run：1 篇文章、2 条动态、0 个图册、6 个独立媒体文件；摘要 `c94fc3510bcc7e9f9cd92a7783b7cb6c27734d44d13d0ffd0e0002ad37c087b2`。媒体 MIME、SHA256、日期、slug 与旧链接由现有生成器审计；未导入生产。生产 legacy_author_id 仍为空。不得自动将任何管理员认定为历史作者。

最终验收必须包括创建/审核/Publisher/GitHub/Cloudflare 整条链路；仅前端部署成功不代表全部业务上线。

## 本地验证结果

完整回归命令 `node --test --test-concurrency=2 tests/*.test.cjs tests/*.test.mjs`：179 项，178 PASS、0 FAIL、1 SKIP，用时约 588 秒。SKIP 为缺少真实托管 Auth/Storage 验收凭据，未使用旧测试项目。后续 Windows 换行修复追加运行生成器、Publisher 与头像浏览器 9 项，全部 PASS。本地 PostgreSQL 测试使用独立临时集群并在测试后清理；PGlite 不替代并发测试。

站点生成、SEO、Secrets 扫描、diff 空白检查通过。兼容包具有 7 个带摘要的 SQL 产物和 27 个未改动历史迁移，生成 SQL 不包含托管 storage.objects 表/索引/触发器 DDL。正式网站 13 个页面只读 HTTP 检查均为 200；这不证明其登录后的业务功能可用。

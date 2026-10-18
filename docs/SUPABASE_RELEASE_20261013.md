# 拾光手记 · 2026-10-13 站长执行手册

> 2026-10-18 第二轮本地补充：完整应用下述四个增量文件后，还需单独执行 `supabase/migrations/202610180001_article_settings_and_profile_search.sql`，只执行一次。该文件**尚未在生产执行**；本轮没有推送、历史导入或生产 Secrets 操作。部署窗口及托管验收由第三轮统一安排。

本手册描述待站长执行的生产操作。开发期间只使用本地隔离数据库和浏览器替身，未执行生产 migration、历史导入或 Storage 删除。最终交接副本另附已推送 SHA、脚本校验和、CI/部署状态；请以该副本为准。不要把密钥发到聊天或复制进前端。

## 1. 先备份并确认项目

在 Supabase Dashboard 确认项目名称及 project ref 与网站 `js/config.js` 一致；在 Database / Backups 确认可恢复备份，另行保存 Storage 文件备份及 bucket/策略设置。数据库备份不等于 Storage 实际文件备份。记录操作者、时间、项目、代码 SHA。保留已有内容与 migration 执行日志。

打开 SQL Editor，新建查询，复制 `supabase/preflight.sql` **纯文本全文**运行。文件为只读，可重复运行；不输出私信正文或 token。保存所有结果页。不要从网页富文本复制 SQL，不要携带 `<span>`。

预检必须确认：Storage 原生有效、非局部 `(bucket_id,name)` 唯一索引；`storage.objects` 的托管所有者、RLS 和原有策略；业务表、函数签名、GRANT/REVOKE、外键和触发器定义；私有 bucket；历史 migration 记录与实际结构是否一致。函数存在不代表对应触发器已安装。无法确认任何一项时先停止。

## 2. 根据实际对象分流

| 当前状态 | 执行入口 |
| --- | --- |
| A：全新 Supabase，未安装本站业务表 | 本机执行 `node scripts/build-compatible-install.mjs --output work/compatible-install`。审阅 `manifest.json` 后，在 SQL Editor 一次运行生成的 `fresh-install.sql`。该文件单事务、只允许空业务库，不可重跑。 |
| B：原版私信 migration 完整，后续至 `202610110004` 已完整 | 依次运行下面四个 forward 文件。保留原触发器，不删除它们。 |
| C：私信 migration 删掉一个索引和三个触发器后安装 | 不重跑私信建表文件。确认余下 RLS、业务外键、函数和后续 migration 完整后，同 B。 |
| D：SQL 曾分段执行，表/函数/策略只出现一部分 | 停止，不能运行 fresh-install，也不能盲目执行 `CREATE TABLE`。将只读预检与原纯文本对照，在隔离副本确定最后完整边界；对不完整文件逐语句审计并制作补偿事务。未知生产残缺状态无法用一个通用脚本安全覆盖。 |
| E：后续 migration 部分执行 | 若是完整文件之间的边界，仅按顺序补齐缺少的文件；若文件内部部分完成，按 D 处理。四个新文件各自事务，成功一次后不能重跑。 |

旧文件执行顺序见 `COMMUNITY_V2_RELEASE.md` 的 1–22 项。全新路径保留原文件，生成兼容副本只移除三份历史 SQL 中受限的托管索引/触发器 DDL；原始 LF SHA256 被脚本锁定，若不同则中止。`manifest.json` 记录来源、安装副本摘要及移除项。旧 RLS 和 bucket 设置仍然安装，若平台拒绝其标准策略安装，应停止并通过 Supabase 支持/Storage Policies 官方入口核对权限，不能改托管表所有者。

四个增量文件，**每个只执行一次，按顺序**：

1. `supabase/migrations/202610130001_storage_compatibility.sql`：业务外键改 RESTRICT，登记保护、删除预约与显式完成清理。
2. `supabase/migrations/202610130002_release_contract.sql`：九分类、原子首次草稿、站点文案版本隔离；此时能力版本仍为 0。
3. `supabase/migrations/202610130003_review_queue.sql`：首次发表时间、分页审核、评论回收记录。
4. `supabase/migrations/202610130004_moment_deletion.sql`：动态软删除、图册容器、审核计数和最终能力版本。

每个事务正常完成才进入下一步。遇到 `Incomplete installation`、`Unexpected asset FK`、唯一索引不符、权限错误、已有对象或任何 SQL 错误，停止并保存错误及预检结果。不要删除约束后继续，不通过 `migration repair` 伪造记录。SQL Editor 执行不会自动补 CLI migration 历史；保留操作清单和成功记录。

第二轮追加文件在上述四项全部完成之后执行，不能改写旧函数所在的历史 migration。它在一笔事务内安装：管理员本人文章的草稿精选选择（不属于正文）、批准与精选原子提交、包含已批准版本标题的精选通知、`profile_search(text,integer,integer)`。搜索仅返回公开资料字段，关键词 2–80 字、每页最多 20、offset 最多 200，匿名与登录访问相同；`%`、`_` 按字面匹配。普通用户不能读精选意图或调用管理员写接口。

运行生成器得到的全新兼容安装包会包含全部 27 项，不向已安装库重新执行 fresh-install。第二轮 SQL 已在本地原生 PostgreSQL/PGlite 验证现有库升级和兼容空库初始化。升级不回填旧通知，旧事件保留原文；新增精选事件保存当时已批准标题，后续编辑不会改写旧通知。精选通知在数据库事务中生成，不等待 Publisher 或 Pages；静态公开精选列表仍须 Publisher 同步成功。

## 3. 私信删减版与原版的准确差异

删减版仍有参与者 RLS、私有 bucket、业务约束和外键，并非没有保护。缺少的触发器使数据库级元数据不可变保护、孤儿登记竞争和删除意图自动清理失去原有绑定；若平台已有全 bucket 原生唯一索引，删掉局部唯一索引本身不减少唯一路径约束。

修复不改 `storage.objects` 所有者、索引、触发器、RLS 或策略，不新增普通角色权限。只将两个业务登记表的级联删除外键改为 RESTRICT：绕过 UI 的直接删除也不能移除已登记文件。现有 restrictive UPDATE 策略仍禁止用户覆盖/改路径。删除 RPC 先锁对象，再检查引用；只为未引用对象移除业务登记，写入不可复用的路径预约。并发登记必须等锁，随后被业务表触发器拒绝。已发送私信图片和 revision 引用保留，禁止删除。

Storage HTTP 删除成功后客户端调用 `private_object_finish_deletes()`，只清理本人的、对象确已不存在的意图；响应丢失可以重试。预约长期保留。客户端可以重新上传一个**未登记**文件到废弃路径，但该路径不能再次登记到内容或私信，应使用新 UUID 路径。孤儿清理仍只能处理本人资源。超级用户/服务角色能绕过 RLS，修复不声称能防御泄露的服务器密钥，也不等同于保留所有原版对高权限 Storage 元数据 UPDATE 的触发器限制。

本地验证包含原版、删减版、全新兼容链、部分安装中止、重复修复拒绝、非托管表所有者角色执行，以及原生 PostgreSQL 多连接竞争。受限角色用既有业务管理员权限模拟迁移执行者；测试创建的角色不应复制到生产。托管 Storage HTTP 文件行为仍须第 7 节实测。

官方依据（2026-10-13 核对）：[Storage schema](https://supabase.com/docs/guides/storage/schema/design) 建议将 Storage 元数据视为只读并通过 API 操作实际文件，同时允许为策略优化添加自定义索引；它并不保证所有 SQL 角色拥有 DDL 权限。[托管权限](https://supabase.com/docs/guides/platform/permissions) 要求保留 `supabase_storage_admin` 所有权。[Storage RLS](https://supabase.com/docs/guides/storage/security/access-control) 是客户端访问的授权边界。本修复沿用现有 RLS，并把新增约束放在业务表。

## 4. 升级后预检与作者身份

运行 `supabase/postflight.sql`，只读且可重复。预期 `community_release_preflight()` 和 `community_capabilities()` 的 version 都是 **20261013**。anon/authenticated 不可执行 service-only 导出、导入、发布结果接口。迁移末尾包含 `NOTIFY pgrst, 'reload schema'`；若 REST 仍提示缺函数，可在 SQL Editor 单独重发此通知，再用登录测试账号检查。不要把缺函数当成功。

核对 dm-media 私有、8 MiB、JPG/PNG/WebP；community-assets 私有、90 MiB、JPG/PNG/WebP/MP4/PDF/TXT；published-media 公开但只含批准内容。核对普通用户 A/B、第三人 C、非会话管理员 D。核对 `user_roles` 管理员和 `community_publication_config.legacy_author_id`，历史作者必须是站长本人已确认的 UUID，不能从显示名称猜测。若尚未配置，用现有发布手册的管理员配置步骤，记录变更前后；本轮未替你写入。

## 5. 历史内容真实导入（当前尚未执行）

在最终 SHA 的干净 checkout 运行：

```powershell
git rev-parse HEAD
node scripts/legacy-community-import.mjs --output work/legacy-plan.json
```

审阅完整清单：标题/正文、日期、slug、旧目标 ID、作者 UUID、精选、媒体字节 SHA256 与 MIME。脚本只读本地，输出用于 Actions 的清单摘要。当前本地预演统计见最终交接报告，不把数量写死在导入逻辑里。私密图册跳过，原 Git 文件保留。

在 GitHub → Actions → **Reviewed legacy Community import** → Run workflow，选择 main，输入清单摘要 `plan_digest` 和已核对的 `owner_id`。仅在代码源与生成清单时一致、受保护的 `community-release` 环境已审核时执行。密钥使用该环境/仓库已有 Secrets，不能贴到输入框或聊天。运行日志的 checkout SHA 必须与交接 SHA 对上；若 main 前进，重新生成清单并审阅。此工作流不会因 push 自动导入。

导入先验证全清单、字节及后台能力，再读取全部目标条目/映射做冲突预检。源摘要变化、同名冲突、作者不匹配时在上传前停止。媒体路径由字节摘要稳定生成，已存在文件逐字节摘要核对，禁止覆盖；登记和导入 RPC 幂等。中途失败保留合法已完成项，用同一源/作者/摘要重试，不删原文件、不从头换作者。旧 URL、评论/点赞 target 和精选映射保留；公开合并只显示一份，软删历史动态使用 tombstone 禁止旧文件回流。

## 6. about 文案和发布

无当前后台文案时，权威初始源为 `data/site-settings-initial.json`，从站长最新 main 正文提取，包含共同搭建说明和链接。`generate-site.mjs` 同时生成 `about.html` 正文和 `js/content.js`，不要分别手改输出。首页短摘要独立保留。

旧后台文案的 `source_version` 为 NULL，不会覆盖新初始正文。管理员登录账号中心 → 站点文案，用富文本正文核对最新内容并保存，才生成 `source_version=20261013` 的新版本。发布器读取新版本，写入 `data/site-settings-public.json`，生成器以此为已发布权威源。保留外链、CSDN、贡献图和年份选择。没有后台新版本时不自动迁用旧文字。

升级与导入完成后，Actions → **Sync approved Community public state** → Run workflow。检查快照、媒体、生成器、正常 Git push、finalize 各步；再确认该次 bot 提交的 Cloudflare Pages 部署。界面的“已批准”“已同步仓库”“已部署”是不同状态。编辑已公开内容在批准和部署前不替换原公开版本。

代码先部署、数据库后升级期间：新写入能力检查失败会显示服务器待升级；Publisher/Import 在任何远端写入前中止，保留旧公开快照。现有每五分钟 Publisher 可能报待升级失败，这是阻断状态，不是内容丢失。纯静态生成工作流不连接数据库，不自动迁移/导入。

## 7. 真实验收与停止条件

使用 A/B 会话、C 第三人、D 非会话管理员和退出状态分别验收，并保存实际 HTTP 状态、截图、时间、发布 SHA：

- A 发私信图片给 B，A/B 可读，C/D/游客不可读或签名；已发送图片不能由客户端删除、覆盖或换路径。过期签名不继续展示。既有签名在 TTL 内的行为按平台实际结果记录。
- 各自资源只读自己的；管理员只能读取允许审核的引用。资源上传后登记、删除未引用资源、HTTP 失败重试、孤儿清理、并发登记/删除；验证字节确实存在/删除，不能只查 SQL 元数据。
- A/B 分别发表文章、动态、画册；普通用户默认 N=1 审核，N=2/3 仅对应用户/类型；草稿/退回/重试不增加首次发表数，修改已公开作品始终重审；管理员作品按既有规则批准。
- 动态原页文字框、资源图片/视频、修改/删除；画册先创建再插图，重开空画册标题保留；失败保留编辑内容，切账号清空私有预览。
- 九分类；旧分类版本可读，重编明确转换。文章安全源码、公式、插图光标、预览。危险 HTML 和越权资源在服务端被拒绝。
- 审核分页、作者/类型/状态筛选、原版对照、通过/退回/回收站，后两种必须有理由；两个管理员同时审核不能重复决策。
- 作者不可自行精选；新入选通知只发一次。首页按首次发表倒序最多四篇，独立精选页全量分页，左右按钮及触摸吸附。
- 头像总未读=通知+私信，通知排除私信，审核角标单独；读后、退出、A/B 切换、暂时网络失败状态正确。
- about JS 开/关文字一致；贡献图、年份、外链保留；访客不闪现私有入口。四尺寸、浅/深色、目录首次/反复/滚动/切主题、Safari/iPad 实机。
- 真实邮件登录/重置、托管 DDL、Storage HTTP、90 MiB 上传、Cloudflare 源 SHA 与部署须由站长记录。本地模拟不能替代这些项目。

任何权限泄漏、文件消失、重复计数、内容覆盖、对象定义不一致时停止后续步骤和发布。不要为继续执行而移除保护、放宽权限、强推或删除历史。

## 8. 恢复

代码用经过审阅的正常 `git revert` 提交，或恢复 Cloudflare 已知部署；不可 force push。数据库变更不可仅删除 migration 文件“回滚”。保留四个事务执行日志及备份；升级失败未 COMMIT 的事务原子回滚，已成功事务保留，先在隔离备份验证补偿方案再执行。

历史导入失败优先同源幂等重试，原始 Git 与私有媒体保留；源摘要冲突先人工核对，不改映射骗过预检。误删动态为软删除，保留 revision 和 `community_management_audit.previous_revision`；恢复需站长依据审计记录在隔离副本验证 `deleted_at`/公开指针及导出后再制作单条补偿事务，不能批量清表。

Storage 删除只走 API。删除意图完成清理可由原账号重复调用 RPC；预约路径不要删除或复用。若真实平台执行条件与本地不符，保留最后公开部署，向 Supabase 支持核对受限权限，而不是修改 managed schema 所有权。

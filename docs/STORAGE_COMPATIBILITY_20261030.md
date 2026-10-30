# Storage 兼容修复与第 22 → 27 项操作单

本修复只交付代码、离线安装包和测试，不执行生产 SQL、导入、Publisher 或 Secrets 修改。**当前生产仅为“候选第 22 项”；已有诊断不足以确认可以直接开始写入。** 站长完成备份、下述只读诊断且核对无误后，才可以执行兼容第 23 项及第 24～27 项。不要使用历史原版第 23 项代替生成副本。

## 原因与官方依据

旧 fixture 的 `unique(bucket_id,name)` 掩盖了两个问题：原第 23 项只认可无条件两列唯一索引；登记、孤儿列表和删除完成查询没有区分当前对象与历史行。

本次核对的官方实现固定在 Supabase Storage commit `94e9900d227fb152ad3e66d14cf0a6d3e1901c49`：

| 官方文件 | 关键语义 |
| --- | --- |
| [0062-object-versioning-core.sql](https://github.com/supabase/storage/blob/94e9900d227fb152ad3e66d14cf0a6d3e1901c49/migrations/tenant/0062-object-versioning-core.sql) | `archived_at`、`is_delete_marker`、`is_versioned`，bucket 默认 `DISABLED`。 |
| [0065-objects-key-version-index.sql](https://github.com/supabase/storage/blob/94e9900d227fb152ad3e66d14cf0a6d3e1901c49/migrations/tenant/0065-objects-key-version-index.sql) | PostgreSQL ≥15 的 `(bucket_id,name COLLATE "C",version) NULLS NOT DISTINCT`；旧 PG 用表达式等价方案。 |
| [0066-objects-current-version-index.sql](https://github.com/supabase/storage/blob/94e9900d227fb152ad3e66d14cf0a6d3e1901c49/migrations/tenant/0066-objects-current-version-index.sql) | 唯一 `(bucket_id,name COLLATE "C") WHERE archived_at IS NULL`，包括当前删除标记。 |
| [0067-objects-null-version-index.sql](https://github.com/supabase/storage/blob/94e9900d227fb152ad3e66d14cf0a6d3e1901c49/migrations/tenant/0067-objects-null-version-index.sql) | 唯一同路径 `WHERE NOT is_versioned`；不是“当前有效文件”的判据。 |
| [0071-objects-delete-marker-index.sql](https://github.com/supabase/storage/blob/94e9900d227fb152ad3e66d14cf0a6d3e1901c49/migrations/tenant/0071-objects-delete-marker-index.sql) | `WHERE is_delete_marker` 是普通索引，不提供路径唯一性。 |
| [0072-drop-bucketid-objname-index.sql](https://github.com/supabase/storage/blob/94e9900d227fb152ad3e66d14cf0a6d3e1901c49/migrations/tenant/0072-drop-bucketid-objname-index.sql) | 删除旧全局两列唯一索引。 |
| [数据库实现 pg.ts](https://github.com/supabase/storage/blob/94e9900d227fb152ad3e66d14cf0a6d3e1901c49/src/storage/database/pg.ts) | `findObject` 区分当前行/删除标记；`deleteObjects` 在 DISABLED 按路径删除当前行，可留下归档记录。 |

这些是已核对的官方实现，**不是生产索引定义的替代证据**。生产真实定义由 `preflight.sql` 输出。兼容判定检查列类型、非空标志、RLS、私有 bucket 状态、索引实际键/谓词、btree/text_ops、有效性、就绪状态及即时唯一性；不按名称放行。旧版完全无版本化列时接受原生全局两列唯一约束。新版接受全局约束或精确 `archived_at IS NULL` 的当前行唯一约束；只按版本唯一、只覆盖某 bucket、排除删除标记的谓词、无效/延迟唯一索引均不能代替这一保证。

历史版本/删除标记可以存在；它们不是可登记、可列为孤儿或可预约删除的当前文件。安全性所需的是每路径至多一个当前行，不依赖其他两个版本索引的名字或顺序。版本字段不完整、不同类型、bucket 非 DISABLED 或已有登记与对象不一致时完整回滚。

## 生成与校验

```powershell
node scripts/build-final-operator-pack.mjs --output work/release/final
```

全部 27 份 `supabase/migrations/*.sql` 保持历史原文与 LF SHA256。第 23 项通过校验原文后生成兼容副本，移除的仅是旧唯一索引判断，由更严格的当前行合同与边界检查替代；原 FK/重复执行防护保留。`compatible-install/manifest.json` 记录原文/安装文本摘要；`storage-compatibility-manifest.json` 另记录生成代码、SQL 片段、目录基线、生成文件及全部历史源摘要。上层 `release-manifest.json` 同时校验所有生成 SQL，绑定实际 Git SHA 和工作区状态。

已有环境的迁移编号与历史文件校验值不变；兼容副本校验值与历史原版不同，必须保存 manifest 和实际执行文本。不能将兼容副本当作原历史 SQL 的相同字节，也不能因 source hash 未变就漏掉兼容包升级。未来 CLI history 对齐需人工审阅成功记录，不能直接 `db push` 或伪造 applied。

`boundaries.json` 来自隔离 PostgreSQL 顺序执行历史文件后的目录快照，22 为完整清单，23～27 为差量；不是生产数据。其更新脚本为 `scripts/refresh-storage-boundaries.mjs`，仅维护者在隔离引擎中复核后使用。正常站长无需运行它。目录比对涵盖函数体/签名/安全配置、客户端函数/表/列权限、表列和 RLS、外键/索引、策略、业务及 Auth 触发器；不依赖所有者名称、数据行数或 CLI history。PG18 的独立 NOT NULL 约束条目不作为跨版本键，仍逐列核对非空性。

## 候选第 22 项的唯一执行路径

1. 保存可恢复数据库备份、Storage 文件备份与 bucket/策略配置。进入维护窗口，暂停网站写入与 Publisher/导入，确认 SQL Editor 指向正确项目。
2. 运行仓库 `supabase/preflight.sql`、`supabase/postflight.sql`，保存全部结果。查看两个私有 bucket 的 `versioning_status=DISABLED`、真实索引定义、归档/删除标记计数。`base_state=incomplete` 在候选 22 阶段并不自动表示可补装。
3. 在新 SQL Editor 查询运行生成的 **`work/release/final/compatible-install/diagnose-boundary-22.sql`** 全文。它是 `BEGIN READ ONLY ... ROLLBACK`，不创建对象、不修改数据。必须出现 `Verified historical application boundary: 22` 并且 Storage 合同也无异常。目录不一致、部分安装、bucket 状态异常或权限不足均停止，保存错误键列表、preflight/postflight、当前文件与摘要，由维护者在隔离备份核对。不要从相近函数名/空 mappings 表推断成功。
4. 只有上述检查无误，按下表逐份运行全文事务；每份提交成功才执行下一份：

| 顺序 | 交付包中的 SQL |
| --- | --- |
| 23（兼容副本） | `compatible-install/202610130001_storage_compatibility.sql` |
| 24 | `supabase/migrations/202610130002_release_contract.sql` |
| 25 | `supabase/migrations/202610130003_review_queue.sql` |
| 26 | `supabase/migrations/202610130004_moment_deletion.sql` |
| 27 | `supabase/migrations/202610180001_article_settings_and_profile_search.sql` |

兼容 23 在事务内再次校验边界和 Storage，替换 FK 为 RESTRICT、安装 tombstones/业务登记保护及当前对象函数。旧删除预约非空或旧登记关联了错误对象时中止，不猜测清理已有数据。10 秒锁超时也属于停止条件，保留证据后选择新的维护窗口，不能删锁或删保护绕过。

5. 每份失败均停止；若会话显示事务中止，先 `ROLLBACK;`。不要继续粘贴后续文件。记录“最近成功提交的完整文件”，不要重新执行第 15 项或已提交的第 23 项。恢复后仅续接确证尚未执行的事务。
6. 全部完成后执行 `NOTIFY pgrst, 'reload schema';`，重跑 preflight/postflight，应为 `base_state=ready`、`round2_state=ready`，`storage.current_object_helper=true` 且两个 bucket 仍为 DISABLED。再次保存目录与摘要；这些还不是 HTTP 验收。

完全新装只在确认空业务库时执行生成的 `fresh-install.sql` 一个事务，不能再逐项重跑。已经完整应用**旧原版** 23～27 中某个边界的其他环境，单独运行生成的 `repair-applied-23.sql`，它只接受该历史目录，安装同一套修复且不重建表、不再次改 FK。之后接续已确认缺少的 24～27。已经应用兼容第 23 项/本修复的环境禁止再跑该修复；目录检查会拒绝。未知或定制目录差异一律停下审阅，本包不自动“修正”生产目录。

## 业务保护及恢复

登记继续校验 owner 路径、bucket、对象 ID、MIME、大小和不可变登记身份。旧版和新版均使用相同的对象先于业务登记的锁顺序；发送图片与保存 revision 保留对象锁和引用外键。新 helper 不开放给客户端，全部 SECURITY DEFINER 固定空 `search_path`。普通用户只操作自己的路径；私信参与者可读已发送图片，其他用户及非参与管理员不可读；社区管理员只能在原有审核引用权限内读取；匿名不能读私有资源；历史导入登记仅授予 service_role。

删除始终先预约（检查所有历史 revision/已发送引用）→ Supabase Storage API → `private_object_finish_deletes()`。失败保留 intent，tombstone 永不自动过期。未删除的当前对象会重新出现在本人孤儿列表，走同样预约/API 重试；API 已成功而完成 RPC 失败时可用本人会话重试完成 RPC。禁止 SQL 直接删除生产 Storage 文件。

完成 RPC 只在路径没有当前有效文件时清理本人意图，归档版本和删除标记不阻塞清理；原安装残留的 Storage AFTER DELETE 触发器保留，但其业务清理函数改为不清理意图，避免删除一条历史行就误清预约。所有清理统一经显式 RPC。重新上传同一路径仍不能登记，必须用新 UUID 路径。浏览器遇到登记响应丢失时保留上传供本人在资源中心确认，避免未预约的自动删除。

平台服务身份可以绕过 RLS，因此本方案依赖两个 bucket 持续 DISABLED 和正常受支持的 Storage API；不能把服务密钥交给浏览器、手工覆盖已登记对象或启用版本化。新业务写操作会再次检查 bucket 状态。历史版本不会由本修复擅自清理。签名 URL 仍由原 RLS 边界授权且短时有效，数据库测试不能证明托管下载与签名端点的行为。

## 站长真实验收清单

- Auth：用实际邀请/密码重置邮件登录 A、B、非参与管理员、审核管理员，验证回跳、会话切换；游客拒绝私有读写。
- Storage：A 分别上传两个私有 bucket，登记和签名预览成功；B/非参与管理员不能获取 A 私信图片，收信参与者可以。过期 URL 刷新、超过 6 MiB 的 TUS 中断恢复与账号切换都须实测。
- 引用：已发送图片不能删；文章换掉图片后，旧 revision 仍引用时不能删；本人未引用资源可删除，其他用户/管理员不能代删。
- 恢复：预约后模拟网络失败，确认文件仍在、意图保留；重试 API 和完成 RPC；同一路径重传不能登记，新 UUID 路径可用。不要为验收在生产手工写入历史版本或删除标记。
- Publisher：先核对 Repository/Environment 的配置作用域与相同项目 URL，完成数据库与 Auth/Storage 验收后由站长明确触发一条新测试内容发布；确认只导出已批准资源、无私有路径/密钥进入公开快照。禁止运行历史导入验证本修复。
- GitHub/Cloudflare：核对被审阅提交的 CI 与 Pages SHA。修复分支推送、静态部署、SQL Editor 手工安装、Actions Publisher 是独立步骤，互不证明成功。

离线测试使用 PGlite 与真实 PostgreSQL 两类引擎，旧版/新版 Storage、原版/删减版/新装、跨用户隔离、历史引用、删除恢复、并发、事务回滚及不兼容结构拒绝均有覆盖。新版 fixture 不创建生产缺失的全局两列唯一索引。无隔离 Supabase HTTP 凭据，HTTP 用例明确跳过；生产 Auth/Storage/TUS/Publisher 仍未验证。实际命令与统计见本次交付报告。

## 本次交付报告（2026-10-30）

修改文件与用途：

| 文件 | 关键差异 |
| --- | --- |
| `scripts/storage-compatibility.mjs` | 校验历史摘要，生成边界检查、兼容 23 和已应用 23 的前向修复，集中替换当前对象查询。 |
| `scripts/build-compatible-install.mjs` | 新装/升级包复用相同修复；生成只读诊断和兼容 manifest，显式标记第 23 项 overlay。 |
| `scripts/build-final-operator-pack.mjs` | 打包修复操作单，校验生成文件，写入唯一候选 22 路径。 |
| `scripts/refresh-storage-boundaries.mjs` | 只在隔离本地 PostgreSQL 生成已审阅历史目录基线。 |
| `supabase/compatibility/storage-contract.sql` | 依据实际定义检查新旧 Storage 当前路径唯一性、列类型与 bucket 状态，不增加托管索引/触发器。 |
| `supabase/compatibility/current-object-helpers.sql` | 内部当前对象谓词、DISABLED 检查、既有登记一致性拒绝逻辑。 |
| `supabase/compatibility/boundary-inventory.sql`、`boundaries.json` | 原版/删减版业务目录对照，包含客户端权限、Auth 触发器，未知边界拒绝安装。 |
| `supabase/preflight.sql`、`postflight.sql` | 只读输出版本化字段、真实索引状态、bucket 状态及历史行统计，兼容缺少后续业务对象。 |
| `js/community-data.js` | 登记结果不确定时保留文件，后续使用本人预约删除流程。 |
| `tests/helpers/storage-fixture.mjs`、`postgres.mjs`、`native-postgres.mjs` | 官方关键字段/部分索引 fixture；原生引擎接入新版环境，Windows 后台子进程不弹窗口。 |
| `tests/storage-version-compatibility.test.mjs` | 升级/新装/前向修复、归档/标记、越权/引用/重传、真实并发、回滚、错误结构、既有数据保全与 manifest 测试。 |
| `tests/release-compatibility.test.mjs` | 原版/删减版升级改测兼容副本，真实 PostgreSQL 验证非托管所有者权限。 |
| `tests/community-round2-ui.test.mjs` | 更新失败登记断言，并新增提交成功但响应丢失时不能自动删除的测试。 |
| 本文、`FINAL_DEPLOYMENT_GUIDE_20261018.md`、`SUPABASE_OPERATOR_PACK_20261018.md` | 清晰区分候选 22、旧 23 已应用、新装、未知部分安装，以及 SQL/静态部署/Publisher/HTTP 验收。 |

全部 27 份历史迁移保持不变；未改变页面视觉或生产配置。现有第 22 项用户、私信、revision、资源登记与 Storage ID 的前后快照一致性已实测。

本机使用已有隔离依赖：`PGLITE_MODULE`、`PG_TEST_BIN`、`PG_TEST_MODULE`、`COMMUNITY_DOM_MODULE`、`BROWSER_TEST_MODULE`、`BROWSER_TEST_EXECUTABLE`；浏览器为本机 Edge 的无头 Chromium。Windows PostgreSQL 二进制复制到 ASCII 临时路径运行，避开含中文安装路径的 initdb 编码错误；数据库集群均为临时隔离实例并在测试后关闭。无生产数据库连接。

| 实际命令 | 结果 |
| --- | --- |
| `node --test --test-concurrency=2 tests/*.test.cjs tests/*.test.mjs` | 全量 167 项：165 通过、1 旧断言失败、1 HTTP 跳过。唯一失败是旧断言要求“登记失败自动删文件”；更新为保留不确定登记并测试响应丢失后复测通过。其余 RLS、社区/私信、浏览器、Publisher 模拟、文档/生成器回归通过。 |
| `node --test --test-concurrency=2 tests/storage-version-compatibility.test.mjs tests/release-compatibility.test.mjs tests/round3-deployment.test.mjs tests/community-round2-ui.test.mjs tests/release-docs.test.mjs` | 最终集中复测 41 项：40 通过、0 失败、1 HTTP 跳过。未将这次复测冒充另一轮全量运行。 |
| `node --test --test-name-pattern="Existing boundary-22 users" tests/storage-version-compatibility.test.mjs` | 随后补充的既有数据保全用例：1 通过、0 失败。 |
| `node --test --test-name-pattern="Generated fresh\|operator pack" tests/storage-version-compatibility.test.mjs tests/round3-deployment.test.mjs` | 生成包与 manifest 独立复测 2 通过；全体历史文件与原提交逐项比较未变。 |
| `node scripts/build-final-operator-pack.mjs --output work/release/storage-final` | 离线生成成功；提交后再次生成以绑定最终 SHA。 |
| `node scripts/check-seo.mjs`、`node scripts/check-secrets.mjs`、`git diff --check` | 通过。 |
| `node scripts/check-supabase-rls.mjs` | 未运行真实 HTTP 检查：缺少 URL、公开 key 及隔离测试账号，按脚本约定退出 1；这是环境阻塞，不是通过记录。没有索取或使用生产服务密钥。 |

本机完整日志在 `work/storage-full-suite.log`、`work/storage-final-validation.log`、`work/storage-preserve-data.log` 和 `work/storage-manifest.log`。它们属于本地交付证据，不进入网站公开目录。已修复测试开发过程中发现的问题，没有尚未处理的本地测试失败；仍未验证生产真实索引、Auth/Storage/TUS HTTP、远端 CI/Cloudflare 或正式 Publisher。

结论：**修复与离线交付已完成，可以让站长开始备份和只读诊断。只有实际生产候选第 22 项边界、Storage 合同和执行记录全部核对成功，才达到开始执行兼容 23 → 24 → 25 → 26 → 27 的条件。** 若诊断有目录差异、残留删除意图或旧登记异常，必须停止，不能将本地测试替代生产证据。

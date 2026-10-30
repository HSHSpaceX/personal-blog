# 拾光手记正式部署操作手册

这是第三轮后的正式操作入口。旧版说明保留作历史审计，执行顺序以本文件和 [Supabase 专项包](SUPABASE_OPERATOR_PACK_20261018.md) 为准。操作者为站长；本地开发没有执行生产 SQL、生产导入或 Secrets 修改。

2026-10-30 Storage 兼容修复补充：[第 22 → 27 项操作单](STORAGE_COMPATIBILITY_20261030.md)，当前为 **revision 2**。历史 SQL 原文不变，候选第 22 项必须先运行生成的只读边界/登记数据诊断，再执行生成的兼容第 23 项，不能直接运行历史原版第 23 项。以下分流已按此更新。

先区分三件事：A 为本地代码测试；B 为 GitHub/Cloudflare 代码部署；C 为生产数据库、Auth、Storage、历史导入和实际发布链。A、B 通过不能代替 C。实际 Git SHA、检查链接和推送回执见最终交付目录 `work/release/final/release-manifest.json`，其中每份文档副本也注明实际 SHA。仓库文档与自身提交 SHA 无法互相包含，交付包在最后一次提交后离线生成，避免写入虚构 SHA。

## 1. 保存记录，确认代码版本

1. 打开 [GitHub 仓库](https://github.com/HSHSpaceX/personal-blog)，选择 `main`，点击最近提交，复制完整 40 位 SHA，填入 [生产验收模板](PRODUCTION_ACCEPTANCE_TEMPLATE_20261018.md)。
2. 打开仓库 **Actions → Community permissions and regression**，确认该 SHA 的运行成功。打开该提交的 **Checks → Cloudflare Pages**，核对部署的完整 SHA，不凭首页看起来正常判断新版本已上线。
3. 本地目录运行 `git status`、`git rev-parse HEAD`，应是干净工作区且与审阅版本一致。若 Actions 又产生 bot commit，先检查差异并重新生成导入清单。不要使用旧压缩包直接导入。
4. 从当前代码运行以下纯离线命令，审阅生成的文件；它们不访问数据库：

```powershell
New-Item -ItemType Directory -Force work/release | Out-Null
node scripts/legacy-community-import.mjs --output work/release/legacy-plan.json
node scripts/build-final-operator-pack.mjs --output work/release/final
```

保存 manifest、旧内容清单摘要、27 项 SQL 摘要。没有远端回执参数的离线生成不会证明线上已验收。

## 2. 备份，执行只读检查

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard)，进入正式项目。核对项目 URL 与仓库 `js/config.js` 的公开 URL 一致；不能只凭项目显示名称确认。不要复制 service_role 到聊天、截图或前端。
2. 进入 **Database → Backups**，确认可恢复备份及保留时间；另行备份 Storage 实际文件及 bucket/策略设置。数据库备份不能代替媒体文件备份。无可用恢复方案即停止。
3. 打开 **SQL Editor → New query**，从当前 Git SHA 的 `supabase/preflight.sql` 复制纯文本全文，点击 **Run**。保存所有结果页，包含表、函数、索引、策略、外键、触发器和 migration history。
4. 新建查询，复制 `supabase/postflight.sql` 全文运行。查看 `installation_status`：记录 `base_state`、`round2_state`、缺失对象和 `operator_action`。
5. `base_state=ready` 只代表基础发布对象/版本检查通过；`round2_state=ready` 才表示第 27 项关键结构与权限也符合检查。二者都不是托管 HTTP 验收。任一 `incomplete`，或执行日志与实际对象对不上，停止并保存诊断，不连续点击运行旧建表 SQL。

## 3. 选择唯一的数据库安装路径

| 生产现状 | 站长操作 |
| --- | --- |
| 完全没有本站业务表 | 审阅生成包 `compatible-install/manifest.json`，在 SQL Editor 一次运行 `compatible-install/fresh-install.sql`；只运行一次。该文件包含全部 27 项，不能再逐项重复安装。 |
| 候选第 22 项（原版或删减版） | 先运行生成的 `compatible-install/diagnose-boundary-22.sql`，边界与 Storage 检查全部成功后，运行生成的 `compatible-install/202610130001_storage_compatibility.sql`，再按原文 24、25、26、27 顺序各运行一次。 |
| 旧原版第 23～27 项某个边界已完整 | 按补充操作单运行一次生成的 `compatible-install/repair-applied-23.sql`，其目录校验必须成功；再续接尚未安装的后续文件。 |
| 已应用 98cf633 的兼容 v1（含当时独立修复） | 核对旧包摘要和成功记录，执行本包 `compatible-install/repair-compatible-23-v1.sql` 一次；它验证 v1 完整目录，再补充 owner 一致性，不重建表、不重跑第 23 项。 |
| 已应用兼容 v2 或本次独立补丁 | 保存成功记录，核对安装边界，仅续接缺失的 24～27；不得重跑兼容第 23 项或独立补丁。 |
| 分段执行过 SQL、文件内对象只装了一部分、或边界不明 | 停止。导出只读诊断，在隔离备份重现并审阅补偿事务；本包不自动覆盖未知残缺库。 |

完整顺序、原版/删减版差异见专项包。每份 SQL 应从仓库 **Raw** 纯文本或本地编辑器复制，不能带网页 `<span>` 标记。看到 `Incomplete installation`、`Unexpected asset FK`、已有对象、权限错误、缺少依赖、唯一索引不符等任何错误，保存错误与当前 SQL 文件名后停止。不要删约束、关闭 RLS 或修改 `storage.objects` 所有者继续安装。

SQL Editor 手工执行不会自动登记 CLI migration history。若以后改用 CLI，先比对实际对象与成功记录，确认后才能由维护者处理 history；不要直接 `db push` 重跑所有历史文件。

## 4. 确认管理员、历史作者及缓存

1. **Authentication → Users**：找到站长账号，核对邮件归属后复制 UUID。不要从显示名称猜 UUID，也不要填写本地测试账号 UUID。
2. SQL Editor 运行以下只读查询，保存结果（公开交接前遮住个人信息）：

```sql
begin transaction read only;
select user_id, role from public.user_roles where role='admin';
select id, username, display_name from public.profiles where id in
 (select user_id from public.user_roles where role='admin');
select legacy_author_id from public.community_publication_config where singleton;
rollback;
```

3. 若需要首次赋管理员或设置历史作者，先确认确切 UUID，再按专项包的显式事务操作；不能批量给用户加管理员。现有正确配置无需重写。
4. 所有迁移成功后，在新查询运行 `NOTIFY pgrst, 'reload schema';`。重新运行 `postflight.sql`，应为 `base_state=ready` 且 `round2_state=ready`，同时 `storage.current_object_helper=true`、`storage.owner_consistency_helper=true`，两个私有 bucket 均为 DISABLED，没有异常权限。标志存在仍须对照成功记录与完整目录，不证明 HTTP 验收。REST 仍提示缺函数时先核对项目、签名和缓存，不能默认当作成功。

## 5. 检查邀请制登录和 Storage

1. **Authentication → Sign In / Providers（或当前界面 Email/设置页）**：保留 Email 登录，关闭 **Allow new users to sign up**。当前 Dashboard 菜单可能调整，以该开关名称为准。不要启用网页公开注册。
2. **Authentication → URL Configuration**：Site URL 为 `https://hsh-personal-blog.pages.dev/`，Redirect URLs 包含 `https://hsh-personal-blog.pages.dev/login.html?reset=1`（使用无扩展名路由时同时核对 `/login?reset=1`）。按正式邮件服务配置 SMTP，测试邀请和重置邮件实际回跳。
3. **Authentication → Users → Add user / Invite user**：邀请两个普通测试账号和两个管理员测试账号，记录角色。真实账号测试完成后按站长策略保留或清理。
4. **Storage → Buckets**：核对 `community-assets` 私有、90 MiB、JPG/PNG/WebP/MP4/PDF/TXT；`dm-media` 私有、8 MiB、JPG/PNG/WebP；`published-media` 公开只读且客户端不能写入；`avatars` 公开、2 MB、三种图片。不要把两个私有 bucket 改公开解决预览问题。
5. 用网页实际上传、预览、取消、失败重试和跨账号测试。原生 PostgreSQL 模拟不能验证托管 Storage HTTP/TUS；完整步骤见专项包。失败时不要继续历史导入。

## 6. 配置 GitHub Publisher（由站长操作）

1. 仓库 **Settings → Secrets and variables → Actions → Repository secrets → New repository secret**。
2. 分别添加 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`。值从同一个 Supabase 正式项目取得；server service_role 只放 Actions，不能填 publishable/anon key 冒充。两者不能来自不同项目。不要截图密钥内容。
3. 当前 `sync-community-public.yml` **没有 job environment**，读取 Repository/可用 Organization secrets。单独放到 `community-release` Environment 不能供这个 sync job 使用。历史导入 job 则绑定该 Environment；同名 Environment secret 优先于 Repository secret，必须核对仍是同一个项目。
4. 若站长决定将 Publisher 也移到 Environment，需另行审阅 workflow 添加 `environment`、main 保护及审批规则后再启用；定时任务可能停在等待审批。不要本轮临时绕过审批。
5. 仓库 **Settings → Actions → General → Workflow permissions** 核对允许 workflow 的 `contents: write` 按分支保护正常提交。需要额外批准时遵守保护，不能 force push 或引入 PAT。
6. 在 **Actions → Sync approved Community public state → Run workflow**，选择 `main`，手动运行一次。此步骤会写生产公开派生状态，必须由站长在数据库、媒体和配置检查后执行。
7. 正常应依次看到：读取批准快照/校验媒体 → 离线生成并验证 → verify 复核当前批准版本 → 普通 Git push（无变更可不创建提交）→ finalize。最后确认 Cloudflare 实际部署对应 SHA。数据库已批准、仓库已同步、Pages 已部署分别记录。
8. 若失败，保存 run URL、失败 step 名、首个错误码、前后少量已遮密日志。`EXPORT_FAILED` 不能当成已发布。配置缺失会在公开文件写入前失败；保留旧快照，修正配置后可重试。未完成 finalize 可在同一权威版本重试，不删除私有原文件。

## 7. 历史导入，仅受控 Actions 执行

1. 必须先完成备份、27 项迁移、真实 UUID、Auth/Storage 验收和 Secrets 项目归属核对。
2. 在最终 `main` 干净版本重新生成 `legacy-plan.json`，逐条审阅原 slug、日期、作者、分类、标签、精选、HTML、图片视频、字节 SHA256、真实 MIME 和映射。当前候选为 1 篇文章、2 条动态、0 个公开图册、6 个媒体；以后以新清单为准，不能硬填这些数量。
3. 当前一个 `.jpg` 的真实 MIME 为 PNG；清单显式标记 `extension_mismatch`。私有登记使用真实 MIME/扩展名，旧公开文件不被覆盖。站长应确认这正是原图片。
4. **Settings → Environments → community-release**：核对 main 部署限制、审批人及该 Environment 中同名 Secrets。需要审批时由有权限的站长批准。
5. **Actions → Reviewed legacy Community import → Run workflow**，分支 `main`，填写 `source_sha`（当前完整 40 位 Git SHA）、`plan_digest`（dry-run 打印的 JSON 内容摘要）、`owner_id`（已确认的历史作者 UUID）。审批后再执行。
6. 源 SHA、GITHUB_SHA 或清单摘要不一致会在任何导入写入前中止。若 main 变动，重新审阅和生成清单，不能随意修改参数跳过检查。相同清单的网络中断可原样重试；既存媒体字节不同、slug/来源/作者冲突必须停，不允许覆盖。
7. 导入成功后，再由站长运行 Publisher，记录导入数量、映射及实际旧文章 `posts/post-austria-history.html`，旧动态锚点、评论/点赞和编辑入口；确认页面不重复。真实导入尚未由开发环境执行。

## 8. Cloudflare 与完整业务验收

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → hsh-personal-blog → Deployments**，核对 Production branch 为 `main`、本次部署 SHA、成功状态和生产域名。记录当前实际 build command/output directory，不盲目改成其他框架配置。
2. 打开生产首页、归档、精选、搜索、旧文章 URL、动态、画廊、个人主页和账号中心，检查浏览器 Network 的实际 JS/CSS 缓存键。检查 sitemap、canonical 仍指向正式域名，功能私有页继续 noindex。
3. 用游客、普通 A/B、管理员 A/B 在四尺寸与两主题执行模板：文章/动态/图册草稿、重开、提交、周期审核、退回、重提、封面、精选标题通知、用户搜索、私信参与者隔离、账号切换清空私有数据、历史引用删除保护。
4. 管理员直接批准并精选属于数据库原子事务；精选通知在该事务发生，不等待 Publisher。但只有 Publisher 成功并且 Pages 部署确认后，才能在记录中勾选“公开上线”。
5. 任何账号越权、私有媒体可匿名访问、内容丢失、旧 URL 失效或发布快照被清空，立即停止写入和导入，保存证据。用已审阅的正常代码 revert/Cloudflare 已知部署恢复代码；数据库和 Storage 恢复必须按备份/补偿事务独立处理，代码回退不会回滚数据库。

## 官方说明

SQL/CLI 历史核对见 [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations)；托管 Storage 对象见 [Storage schema](https://supabase.com/docs/guides/storage/schema/design)。Secrets 作用域见 [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)，部署 SHA 查看见 [Cloudflare Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)。

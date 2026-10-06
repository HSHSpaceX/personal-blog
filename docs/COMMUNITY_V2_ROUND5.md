# Community V2 Round 5：静态发布桥

本轮基于 `ca6b9c5deb3a5b4326bd5ce122b23df146b48471`。只新增 `202610070003_publication_bridge.sql`；未连接生产 Supabase、执行生产迁移或合并 main。RC 操作见 [最终发布清单](COMMUNITY_V2_RELEASE.md)。

## 权威源与状态

`content_items.published_revision_id` 与 `content_revisions.status='approved'` 同时满足才能导出。`community_publication_export()` 是单 SQL statement 的一致快照，包含当前版本、公开作者字段、该版本真实 `revision_assets` 对象元数据。它不遍历历史，不返回 Auth/email/role，不读取 DM 表或 dm-media。仅 service_role 可执行；作者/admin 浏览器也不能调用。

`community_publication_state` 每个 item 一行：desired_revision_id、pending/published/failed、上次成功 published_revision_id、last_attempt_at、published_at、last_error、commit_sha。批准新指针时 trigger 自动 pending；pending/rejected 编辑不改变旧公开指针。作者只能 SELECT 自己，admin SELECT 全部，client 没有 DML/RPC 写权限。账号中心显示审核中、已审核等待同步、已发布、发布失败等待重试。

`community_publication_result()` 锁 authority item 并 CAS 检查 revision；旧 worker 不能覆盖更新后的指针。错误是六个固定代码之一，不保存远端响应、URL、JWT 或密钥。published 必须带 40 位 commit SHA。Git 推送之前不回写 published。

## 全量 reconciliation 与恢复

`scripts/sync-community-public.mjs` 导出整个期望状态，验证所有 schema/slug/media 后上传稳定公开副本，原子替换 `data/community-public.json`。无随机生成时间；排序、路径和正文确定性，相同内容不产生 Git diff。legacy/community article slug 冲突 fail closed，不覆盖 legacy 文件。

Actions 随后离线 generate → SEO/secrets/security tests → diff check → `--verify` 重新核对当前 authority → 有变化才 bot commit/push → `--finalize` 清理无引用公开副本并 CAS 回写状态。即使无 diff 也执行 finalize，修复“Git 已成功但回写失败”。中途失败下一次全量重试，不依赖 webhook 或恰好一次。

复制媒体后 Git 失败：不删除旧公开副本，不提交半生成文件；下次复用相同路径。指针在运行中变化：verify/finalize 拒绝，保留可重试状态。Git/数据库/Cloudflare 不是跨服务事务；最后复核与 Git push 之间仍可能有新批准，下一轮 reconciliation 收敛，CAS 不会误确认较新的 revision。published 表示已推送的静态 Git 快照，不是 Cloudflare build/边缘缓存已完成的证明，必须执行 RC 中的部署验证。

删除 item/作者或移除公开指针：下轮 snapshot 删除对应项，generator 删除带自身标记的文章，成功 push 后 Storage API 删除过期 published-media 副本。私有原件、私有历史、DM 永不删除。公共副本及边缘缓存不是撤回机制，敏感内容不应通过公开审核。

## 私有原件与公开媒体

`community-assets` 和 `dm-media` 保持 private。新增 **public read / service write** `published-media`；anon/authenticated（包含 admin）INSERT/UPDATE/DELETE restrictive guards 即使存在宽泛 permissive policy 也拒绝。

只有当前 approved revision 的实际引用允许复制，路径固定：

```
community/<item UUID>/<revision UUID>/<asset UUID>.<safe ext>
```

复制前验证 registry bucket、UID 路径、MIME/size/扩展名、Storage 实际 metadata、下载字节数，JPEG/PNG/WebP/PDF/MP4 magic bytes。拒绝 SVG/HTML/JS/未知 MIME、路径穿越、双扩展、超过 20 MiB。TXT 仅接受有效 UTF-8、无 NUL/尖括号的纯文本，以 text/plain 附件链接交付。资源名须为单安全扩展（例如 `photo.jpg`）；历史资源被重命名成无扩展或双扩展时发布会失败，可在资源中心改回安全名称后重试。这些是基本格式检查，**没有实现病毒扫描或完整媒体解析**。

快照只保存 stable public URL、公开文件名/MIME/asset UUID，绝无 private object_path、owner_id、Storage metadata 或 signed URL。清理仅调用 published-media Storage API，并限定生成路径；不会 SQL DELETE storage.objects。未知格式的手工对象需要 operator 检查，不静默删除。

## 数据/页面集成

`data/community-public.json` 是唯一仓库快照；`generate-site.mjs` 验证它并生成转义后的 `js/community-published.js`，不访问 Supabase 或搜索引擎。JS 字符串转义 `<`/`>`/U+2028/U+2029，无法关闭 script 标签。`js/community-public.js` 合并展示数据并全部转义用户正文，按段落/换行构建安全文章；不解析 Markdown/用户 HTML，也没有自制 sanitizer。

- article → `posts/<slug>.html`；分类纯文本 1–40 字，旧数据默认“用户投稿”，readingTime 派生，featured 固定 false。首页/归档分类与标签/时间线/搜索合并 legacy，作者保持实际公开 profile。canonical 始终正式 pages.dev，含 OG、article:published_time、25–155 Unicode description、合理 alt；sitemap/feed/IndexNow 目录自然包含新文章。
- moment → `moments.html#community-<item UUID>`；作者、正文、图片/视频/附件，与 legacy 合并显示。
- album → `gallery.html?community=<item UUID>`；作者、描述、照片/caption、lightbox、分页评论/回复、点赞。
- 三类的评论统一 `community-<item UUID>`，点赞统一 `content/<item UUID>`，revision 改变不丢社交关联。审核通知/最近点赞/评论 context 由类型、slug、UUID 白名单构建真实目标，不保存 action URL。

`js/posts.js` / `js/moments.js` / `js/albums.js` 不接收 Community 写入。legacy 管理器继续仅序列化各自 legacy 数组，Community 没有 legacy 编辑/删除按钮。按请求第 17 条保留原管理员 PAT 工作流；**新的 Community 发布完全不需要前端 GitHub 写凭据**，与该独立 legacy 管理入口分离。

## legacy 自动目录

publisher 从可信仓库数组生成当前 post/moment/public album 目录，service-only `community_sync_legacy_targets()` 全量 upsert/update/remove（private album 排除）。保留 about 评论上下文。`community_publication_config.legacy_author_id` 由 operator/service 一次设置真实 UUID，客户端无权读写；username 修改不改变 owner。未配置 owner 时公开 target 仍存在，owner notification fail closed。

## workflow 与安全边界

`.github/workflows/sync-community-public.yml` 只在 main schedule（5 分钟）/workflow_dispatch 运行；feature/PR 不绑定生产 Secrets。仅三个服务步骤使用 Repository Secrets SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY；生成/测试步骤无 secret。CLI 同时检查 Actions/ref/event；本地与 feature 只通过 fixture 注入 adapter/fetch。

checkout main、Node 22、自带 GITHUB_TOKEN 推送；与原 generate-site workflow 共用 concurrency group，不删除旧工作流。外部 legacy 提交导致非 fast-forward 时 push 失败，下次重新 checkout/reconcile。bot GITHUB_TOKEN 的 push 不触发普通 push Actions，防循环；Cloudflare Git 集成实际触发行为需 RC 验证。

## 验证

完整 Community CI glob 自动覆盖 Round 1–5：PGlite、独立 native PostgreSQL、多连接并发、jsdom、真实 Chrome 375px、搜索/Auth/供应链/SEO/secret scan。本地最终完整回归为 80 项通过、0 失败、0 跳过；该结果不代表生产验收。Round 5 fixture 位于 `tests/fixtures/community-publish/`，包括 article/moment/album、PNG/JPEG/WebP/MP4/PDF/TXT、恶意正文、私有 pending/rejected/history、替换/删除/中断重试。HTTP adapter 测试检查凭据不进入快照、bucket 边界、公开清理及非生产 CLI guard。

```bash
node scripts/generate-site.mjs
node scripts/check-seo.mjs
node --test tests/*.test.cjs tests/*.test.mjs
node scripts/check-secrets.mjs
git diff --check
```

真实 Auth、Storage HTTP、邀请/密码邮件、Actions Secrets 与 main schedule、Cloudflare Preview/正式部署以及 SEO 平台需按 release 清单人工验收。开发测试不等于生产已部署。

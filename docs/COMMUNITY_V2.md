# Community V2 Round 1

本页保留 Round 1 历史语义；当前投稿、审核规则及私有 Storage 以 [Round 2](COMMUNITY_V2_ROUND2.md) 为准。

本轮只建立数据与权限底座、账号中心入口及通知修正。现有静态文章、评论、点赞、关注、邀请制 Supabase Auth 和 GitHub 发布路径继续使用原实现。没有文章/动态/图册投稿、资源上传或私信 UI；现有静态内容也不会自动导入新表。

## 权限模型

- `guest`：没有 Supabase session，只读取公开内容。它不是 `user_roles` 中的数据库角色。
- `user`：由 Dashboard 邀请创建的登录用户；无公开注册。新账号始终由已有 Auth trigger 赋予 `user`，不信任用户 metadata 的角色。
- `admin`：`user` 加管理权限，可有多个。与普通用户一样可以编辑自己的资料、评论、点赞、关注、投稿数据和接收个人通知。角色只能由可信数据库管理员在 Dashboard/SQL Editor 分配，客户端不能更改 `user_roles`，包括 admin 客户端。

## 新增迁移

在独立测试 Supabase 项目应用所有旧 migration 后，依次执行：

1. `supabase/migrations/202610060001_community_v2.sql`
2. `supabase/migrations/202610060002_social_notifications.sql`

旧迁移完全保持原样。两份新迁移各自使用事务；记录成功应用的迁移编号，不重复执行创建新表的 001。此分支不执行生产迁移、不修改生产 Supabase 设置。

## 模型与发布语义

| 表 | 用途 | 读取范围 |
| --- | --- | --- |
| `content_items` | 作者、类型（article/moment/album）、slug、`published_revision_id` | 已发布条目公开；未发布条目仅作者/admin |
| `content_revisions` | 不可变 title/body JSON 快照、递增 revision_no、draft/pending/approved/rejected、拒绝原因及时间 | 仅当前发布指针指向的 revision 公开；全部历史和未公开版本仅作者/admin |
| `content_reviews` | 每个提交版本一个审核队列/结果记录，审核人、决策来源、规则快照及拒绝原因 | 始终仅作者/admin；已发布内容的审核记录也不公开 |
| `review_policies` | 按内容类型配置 `requires_review`，记录更新人和时间 | 仅 admin；提交时作者能在自己的 review 中读取规则快照 |
| `user_assets` | 所有者、固定 bucket 名、UUID 目录路径、文件名、MIME、大小等资源元数据 | 所有者/admin；仅所有者可登记、重命名、删除元数据 |

公开读取 `content_items` 后只使用其 `published_revision_id`，或直接从受 RLS 保护的 `content_revisions` 查询公开快照。新版本 pending/rejected 时旧版本保持可见；批准新版本会原子切换指针，旧版本随即仅作者/admin 可读。知道其他版本的 URL/UUID 不赋予访问权限。拒绝理由在 revision 和 review 两处保存，不能为空；拒绝内容不能直接重提，作者应建立新版本。body 限为 JSON 对象、最多 1 MiB；title 1–160 字符。后续 UI 必须验证各类型 body schema 并安全渲染，数据库本轮不负责 HTML 清洗。

`content_items`、`content_revisions`、`content_reviews`、`review_policies` 不开放客户端直接 DML，包括 admin。通过以下 RPC 完成操作：

| RPC | 调用者 | 行为 |
| --- | --- | --- |
| `community_create_item(p_content_type, p_slug)` | 登录用户（包括 admin） | 从 auth.uid() 固定作者，返回 item UUID |
| `community_save_revision(p_item_id, p_title, p_body)` | 仅条目作者 | 建立新 draft 快照、返回 revision UUID；不会修改任何已有 body |
| `community_submit_revision(p_revision_id)` | 仅作者 | 提交比当前公开版本更新的 draft；同一 item 最多一个 pending |
| `community_review_revision(p_revision_id, p_decision, p_rejection_reason)` | 任意 admin | 审核任意作者的 pending（包括 admin 作者和自身）；approved 原子发布，rejected 必须带理由 |
| `community_set_review_policy(p_content_type, p_requires_review)` | 任意 admin | 设置此类型以后提交的版本是否需要审核 |

默认三个类型都需审核，admin 作者也遵守规则。明确关闭某类型审核时，提交会自动发布并生成 `decision_source='policy'` 的审核记录；没有伪造审核人。已经 pending 的版本不受随后规则修改影响。审核记录不可由客户端重写，已决定版本也不能再次审核。每个写入操作先锁 item，避免版本编号、提交和审核的竞争；FK 保证发布指针不能指向其他 item 的 revision。所有 SECURITY DEFINER 函数固定空 search_path，显式验证身份，撤销 PUBLIC/anon 执行权。RLS 与显式最小 GRANT 同时使用，客户端没有 TRUNCATE/TRIGGER/REFERENCES 权限。

账号删除目前随作者删除其 Community items/revisions/reviews/assets；对其他作者的审核记录保留、reviewer_id 变 NULL。不可直接删发布快照或转移作者。软删除、撤回、保留审计及账号删除产品策略留待后续轮次明确。

`user_assets` **只是私有元数据表**，不是上传成功凭据；不创建 Storage bucket、不授权文件访问、不产生公开 URL。路径必须处于 owner UUID 目录，禁止 `.`/`..` 路径段；客户端不能更改所有者、对象路径、大小或时间，只可重命名。Round 2 需要独立实现私有 Storage policies、签名 URL、上传验证、资源与 revision 引用关系及清理策略。

## 通知与账号中心

新通知迁移替换函数，移除 admin 发送方/接收方过滤。user/admin 都能收到关注、评论点赞、回复及他人审核通过的结果。自己的点赞、回复、自我审核不会产生 self-notification；自身关注仍由已有约束拒绝。普通用户的 pending/rejected 回复不会通知，变为 approved 后才通知作者，重复设置 approved 不重复通知。

`notifications` 仍只允许本人读取和更新 read，admin 不能浏览其他人的私有收件箱。审核工作保存在 `content_reviews`；新 V2 审核操作不写个人社交通知。现有评论审核结果通知保留给作者。

`account.html` 包含概览、我的资料、我的内容、我的资源、通知、私信占位、关注与粉丝、账号安全；admin 动态增加审核中心/审核规则入口。现有评论审核可从审核中心进入，V2 审核和规则编辑 UI 尚未开放。登录默认返回账号中心；login/profile/messages/admin 及公开页登录菜单都有账号中心入口。角色变化/退出会立即移除动态管理链接及个人概览，并忽略旧请求结果。

所有公开页（包括生成文章的 post.html 模板）移除 footer “管理”登录入口和静态 admin 链接。确认 DB admin 后 JS 才动态创建管理入口，功能型链接标记 nofollow。login/admin/account/messages 的 noindex 保留，也不进入 sitemap；这属于正确的功能页面索引策略。Bing 旧诊断需重新抓取后复查，不能保证警告即时消失。

## 回归测试

仓库没有 npm 应用依赖。使用 Node.js 22，现有完整检查：

```bash
node scripts/generate-site.mjs
node scripts/check-seo.mjs
node tests/search.test.cjs
node tests/ui.test.cjs
node tests/auth-policy.test.cjs
node tests/supply-chain.test.mjs
node scripts/check-secrets.mjs
node tests/community-ui.test.cjs
git diff --check
```

PostgreSQL 真执行验收（本地引擎，不连接生产）：

```bash
npm install --prefix /tmp/blog-rls --ignore-scripts --no-save @electric-sql/pglite@0.3.14
export PGLITE_MODULE=file:///tmp/blog-rls/node_modules/@electric-sql/pglite/dist/index.js
node --test tests/rls-postgres.test.mjs tests/community-v2-postgres.test.mjs
```

未设置 `PGLITE_MODULE` 会明确跳过数据库测试，不能算验收通过。helper 模拟 Supabase Auth/Storage 表及宽默认 GRANT，运行全部迁移后以 anon/authenticated 实际身份验证 RLS、RPC、状态机、已发布/pending 共存、已知 UUID 越权、拒绝原因、禁止角色提升、多个 admin 审核/社交、私有资源、通知和最低权限。PGlite 内置 UUID 生成，不加载 pgcrypto，不模拟真实 SMTP/Storage HTTP。

既有测试已跟进当前 main：GitHub PAT 的同账号 sessionStorage 恢复逻辑保留，测试使用实际存储 mock 验证同账号恢复和跨账号/退出清除；不再断言已经被 main 改变的 memory-only/pagehide 行为。主题 SVG 比较规范化换行；数据库安全函数检查改为显式名称集合，保留 search_path 与权限断言，没有放宽断言来掩盖越权。

## Round 2 前人工验收

- 独立测试项目应用旧迁移和上述新增迁移；用两个普通账号和至少两个 admin，通过真实 Supabase REST/RPC 复测所有权限与版本切换。重点携带另一用户的 revision/review UUID、深链接及真实 JWT 进行读取和写入攻击验证。
- Dashboard 确认公开注册关闭、邀请制正常、角色只能由可信渠道授予，测试 Auth 的邀请、登录、恢复 session、密码重置邮件/回调、退出和实时角色降级；SQL 不替代 Auth 服务设置。
- 浏览器实际验证 admin 的点赞/关注/回复、普通用户回复审核后通知、self-notification 抑制、收件箱隔离以及审核中心与个人通知入口的区分。
- 验证账号中心移动端导航、登录重定向、密码重置邮件、动态 admin 链接及退出/账号切换过程中旧请求结果不泄露。
- 独立测试项目做并发提交/多 admin 同时审核测试；本地单连接测试未覆盖跨连接锁等待/死锁和生产吞吐。
- 在后续 Storage 开发前确定私有 bucket 与签名 URL 策略、MIME/大小与对象真实性验证、删除及引用策略；不能把本轮 asset 元数据当作文件访问控制。
- 回归现有文章、评论、点赞、关注、静态生成与 GitHub 发布；发布操作只在授权测试仓库验证，生产不受本轮任务修改。
- 部署后用 Bing URL 检查重新抓取公开页，确认功能型 noindex 页仍不进 sitemap、公开 HTML 没有静态 admin/footer 管理链接。无需删除 login/admin 的 noindex。

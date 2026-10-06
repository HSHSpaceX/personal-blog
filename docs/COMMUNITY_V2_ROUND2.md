# Community V2 Round 2

本页保留 Round 2 交付说明；已完成的后续个人主页、评论编辑与资源管理见 [Round 3](COMMUNITY_V2_ROUND3.md)。

基于 `feature/community-v2` 的 Round 1 HEAD `3e8c5adedc905daed1bbdcfd61e3e1cdd433944f`。本轮完成邀请制登录用户的文章、动态、图册投稿和管理员审核，以及基础私有资源上传。没有合并 main，没有执行生产 Supabase 操作，也没有将 Community 内容写入静态 posts、sitemap 或现有 GitHub 发布流程。

## 迁移与审核语义

在独立测试 Supabase 项目应用所有既有迁移后，按顺序应用以下新增文件；所有旧迁移保持原样：

1. `202610060003_submission_policy_and_schema.sql`
2. `202610060004_private_assets.sql`
3. `202610060005_content_review_notifications.sql`

| 场景 | 提交结果 |
| --- | --- |
| guest | 无投稿权限 |
| 普通 user，无用户/类型规则或 N=NULL | 每次人工审核 |
| 普通 user，新条目，人工通过的新条目数小于 N | pending |
| 普通 user，新条目，人工通过的新条目数达到 N | 自动 approved 并切换 published_revision_id |
| 普通 user，新条目，N=0 | 自动发布 |
| 普通 user，已经公开过的条目产生修改 | 始终 pending，旧公开指针不变 |
| admin 自己的新建或修改 | 直接发布，正常 revision 和 admin_auto 审核记录 |

规则独立绑定 `user_id + content_type`，三种类型及不同用户互不共享信任。计数由 `content_approval_credits` 记录：每个 item 的首次人工批准发布只计一次；拒绝不计，修改不计，自动发布和自我审核不计。003 从 Round 1 历史审核中回填可确认的首次人工批准，不能确认审核人时不给信用。N 是累计门槛，不会在设置规则时重置计数；已 pending 的版本不会被规则更新自动处理。达到门槛后，已被拒绝且从未公开的 item 重新建稿仍属新内容；默认 NULL 规则仍会再次人工审核。

废弃全局 `community_set_review_policy` RPC，撤销客户端调用权；Round 1 `review_policies` 保留为历史表，不再参与提交决策。新增 `community_set_user_review_threshold` 和 `community_review_policy_status` 只开放 admin。任何客户端（包括 admin）都不能修改 `user_roles`，Auth metadata 不能提权；多个 admin 都能审核任意 pending。

提交保存规则快照，人工决策锁住 item 和 revision，只有 pending 能决策；并发两个 admin 只有第一个成功。发布和结果通知处于同一事务。拒绝必须提供 1–2000 字原因，写入 revision/review；内容审核通知保留完整原因及 revision UUID，收件人仅作者。自我审核和自身自动发布不产生 self-notification。审核队列仍是 `content_reviews`，不是个人收件箱；既有社交通知和 admin 普通用户能力保留。

## 账号中心与正文安全

`account.html` 的“我的内容”支持三类内容、状态列表、安全预览、保存草稿、继续编辑、提交审核、修改发布版本和驳回重编。每次保存都建立不可变新 draft，原版本保持不变；重新编辑从原 body/title 建立并预填 draft。若提交失败，已保存的草稿 UUID 保留，可以从版本预览重新提交。“我的内容”显示最新版本及当前发布版本入口。

管理员在同页的审核中心预览待审版本、通过或填写原因拒绝；审核规则区通过用户名/UUID 查询目标，为具体类型设置 N 或留空。个人通知链接到 `account.html?revision=<uuid>#content`；该链接读取数据库 revision 后才预览，UUID 不赋予权限。退出、切换账号/降级时清空私有 DOM、编辑字段和签名资源，旧响应不会恢复内容。

前后端均校验 schema：

| 类型 | 允许字段和限制 |
| --- | --- |
| article | text 必填 ≤100000 字符，summary ≤500，tags ≤10 个、每个 1–30 字符，asset_ids ≤20 |
| moment | text 必填 ≤2000，asset_ids ≤9 |
| album | description ≤2000，photos 1–100 个，每项只有 asset_id 和可选 caption ≤200；资源须为支持的图片 MIME |

标题必填 ≤160；body 对象 ≤1 MiB。资源 UUID 必须有效且不重复，不支持用户 URL/HTML/event 字段。允许 text 中包含 HTML 字样，但全部通过 `textContent`/DOM 文本节点展示，不能执行；不提供富文本或 Markdown HTML 渲染，也不做自制 sanitizer。附件地址只从 Storage 签名接口取得并检查 HTTPS 和配置的 Supabase origin，禁止正文提供资源地址。现有 js/posts.js、js/moments.js、js/albums.js 和管理员 GitHub 发布代码保留。

## 私有资源与权限

`community-assets` bucket 为 private，20 MiB 上限，允许 JPEG/PNG/WebP/MP4/PDF/TXT，不允许 SVG/HTML。路径固定为 `auth.uid()/随机UUID.扩展名`，前端不传 owner，登记 RPC 从当前 auth.uid() 及真实 storage.objects 元数据固定 owner/MIME/size；上传后登记失败时尝试删除本次未引用对象。

- Storage SELECT：owner/admin；INSERT/DELETE：owner；禁止客户端 UPDATE/覆盖已登记文件。额外 restrictive policies 防止既有宽松 Storage policy 绕过此 bucket 的隔离，avatars 行为保留。
- `user_assets` 元数据仅 owner/admin 读取，不允许客户端直接 DML；`community_register_asset` 是登记入口。
- `revision_assets` 建立 revision→user_assets→storage.objects 外键。保存时校验所有资源归该作者，锁住对象和 registry；提交时再次核对 body 与关系，旧稿也不能绕过引用保护。
- 被任何 revision 引用的文件禁止删除（比 draft/pending/published 的最低要求更严格，历史 rejected 也保留）；对象删除通过 FK 级联 registry，引用 FK 延迟检查阻止提交。数据库测试覆盖保存引用与删除并发，支持完整账号数据级联删除。
- 当前发布指针对应的文本 revision 可公开；其他 revision 仅作者/admin，review 永远仅作者/admin。资源仍为私有，不因内容 approved 转成公开资源，静态发布桥在 Round 5 处理。
- 前端使用 60 秒 signed URL；过期移除预览地址，不生成 getPublicUrl。签名 URL 是限时 bearer 凭据，获得 URL 的人可在有效期内使用；RLS 约束未签名访问和签名创建，无法把已签 URL 绑定浏览器身份。

## 完整本地 Community CI

Node.js 22，Linux x64。依赖放在 checkout 外，不增加应用 npm 依赖。原生 PostgreSQL 只监听临时 Unix socket，不读取 Supabase 生产凭据。fixture 模拟 Auth/Storage 表，执行实际迁移和真实 PostgreSQL RLS；Supabase HTTP 服务另行人工验收。

```bash
npm install --prefix /tmp/blog-rls --ignore-scripts --no-save --no-audit --no-fund @electric-sql/pglite@0.3.14 pg@8.16.3 @embedded-postgres/linux-x64@18.4.0-beta.17 jsdom@26.1.0
(cd /tmp/blog-rls/node_modules/@embedded-postgres/linux-x64 && node scripts/hydrate-symlinks.js)
export PGLITE_MODULE=file:///tmp/blog-rls/node_modules/@electric-sql/pglite/dist/index.js
export PG_TEST_BIN=/tmp/blog-rls/node_modules/@embedded-postgres/linux-x64/native/bin
export PG_TEST_LIB=/tmp/blog-rls/node_modules/@embedded-postgres/linux-x64/native/lib
export PG_TEST_MODULE=file:///tmp/blog-rls/node_modules/pg/lib/index.js
export COMMUNITY_DOM_MODULE=file:///tmp/blog-rls/node_modules/jsdom/lib/api.js
node scripts/generate-site.mjs
node scripts/check-seo.mjs
node scripts/check-secrets.mjs
node --test tests/*.test.cjs tests/*.test.mjs
git diff --check
```

数据库/DOM 依赖缺失会明确 skip，不能当作完整 CI 通过。GitHub Community workflow 安装和配置全部测试依赖。`community-v2-postgres.test.mjs` 固定运行到 002，保留 Round 1 历史规则回归；Round 2 原生 PostgreSQL 套件执行全部新迁移、RLS、直接 DML、schema、Storage、两独立连接竞争。DOM 测试使用真实 jsdom DOM，数据库接口用 mock，验证投稿流程、恶意内容不执行、拒绝必填、阈值 UI、签名过期和账号切换；不声称替代真实 Supabase HTTP。

## Round 3 前验收和未完成项

在独立 Supabase 测试项目应用迁移，使用 guest、两个 user、两个 admin 的真实 JWT 验证 REST/RPC、已知 UUID、Storage 上传/签名/下载/删除/覆盖、真实元数据 MIME/size、FK 错误传播以及两个管理员并发决策。尤其核对实际 Storage HTTP 在引用删除失败时没有删除物理文件；本地 SQL 验证不替代 Storage 服务验收。确认 Auth 禁止公开注册、邀请/恢复/密码重置和实时降级正常；移动浏览器验证上传、编辑、审核及签名到期。不要将这些人工验收指向生产项目。

Round 3 尚需完整资源管理、孤儿对象清理（包括上传中断/账号切换）、容量配额、文件内容嗅探/扫描、历史版本和引用回收、分页/搜索/筛选（当前最多 50 内容、100 资源、100 待审）、撤回/删除与账号删除的保留策略。旧 Round 1 非本轮 schema 的稿件不能直接提交，需按新格式重建；资源元数据没有真实 object 绑定的旧记录不能用于新版本引用。私信和完整公共个人主页仍未实现；静态发布桥留 Round 5。

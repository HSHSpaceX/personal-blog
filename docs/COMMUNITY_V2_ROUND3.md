# Community V2 Round 3

本页保留 Round 3 交付状态；当前通知/私信/初次评论审核行为见 [Round 4](COMMUNITY_V2_ROUND4.md)。

基于 feature/community-v2 HEAD `ec702d5f4569b5698382011d277ecab462fa1fba`。已完成公开个人主页、公开社交/个人内容分页、独立评论编辑审核和个人资源管理。没有 merge main，没有连接或修改生产 Supabase；全部旧 migration 保持原样。私信留 Round 4，GitHub/静态 SEO 发布桥留 Round 5。

## 新迁移

在独立测试项目已有 001–005 及更早迁移的基础上，依次应用：

- `202610060006_public_profiles.sql`
- `202610060007_comment_edits.sql`
- `202610060008_resource_center.sql`

新增表：`legacy_public_targets`（受信任的公开静态目标目录，无伪造的数据库作者）、`comment_edits`（私有编辑/审核历史）、`community_asset_delete_intents`（Storage 删除时复查孤儿清理意图）。客户端不能直接修改这些表。函数固定空 search_path，显式白名单 GRANT；不改生产角色或 Auth 设置，无 signUp。

## Profile 与公开 RPC

profile.html 保持 noindex、不进 sitemap。guest/user/admin 都可通过 `?username=...` / `?id=...` 查看公开字段。顶部只有头像、显示名称、@username、简介、粉丝/关注数；自己的主页有账号中心/资料编辑入口，登录后别人主页有关注及 Round 4 私信占位。管理员与普通用户的公共主页行为相同，不显示特殊管理权限。

五个内容页签：动态、文章、评论/回复、图册、最近点赞。粉丝/关注按钮打开用户卡分页。默认 20 条，RPC limit 必须 1–50，offset 必须 0–100000，稳定排序；不一次读取全部 DB 内容。所有用户文字使用文本节点；链接使用固定本地路由/已编码标识，头像只允许安全来源。作者卡统一显示头像、display_name/@username，指向 profile.html?username=...。legacy 站长卡标记 HSH(站长)/hshspacex；Community 作者从公开 profiles 读取，不硬编码站长。

| RPC | 可调用身份 | 投影与限制 |
| --- | --- | --- |
| profile_followers / profile_following | guest/user/admin | 仅 id、username、display_name、avatar_url、bio；id 是已有公开 profile 身份，用于关注动作；无 email/role/Auth metadata/关系内部字段 |
| following_count | guest/user/admin | 仅公开关注总数；粉丝数沿用 follower_count |
| profile_content | guest/user/admin | 只取 published_revision_id 指向的 approved Community 版本；评论必须 approved 且目标上下文公开，parent 正文也必须 approved |
| profile_recent_likes | guest/user/admin | 重新检查每个目标，仅返回公开内容卡和点赞时间；没有点赞者内部字段、私有 revision/review 或原始关系行 |

原始 follows/likes 仍无 guest 读取权限，登录用户仍只读自己的原始关系。新增 likes 类型 album/content，content 目标为 Community item UUID；旧 post/comment/moment 插入与计数兼容。新 album/content 插入和计数要求目标公开，评论点赞仍要求 approved。最近点赞每次解析当前发布指针；旧的点赞记录不是公开性凭据，私有、拒绝、删除目标不会成为 Community/评论公开卡。公开主页即使由作者/admin 自己查看也不返回私有稿件；私有工作留账号中心。

为兼容没有数据库所有权的旧内容，前端在 hshspacex 主页分页追加当前 BLOG_POSTS、BLOG_MOMENTS/SITE_MOMENTS、公开 SITE_ALBUMS。没有向 content_items 伪造作者，没有自动导入原始文章 HTML。旧静态评论没有 user_id 时不伪造个人归属，原评论页面继续显示。recent likes 的 legacy 投影仅允许受信任目录中已确认公开的目标，并在前端再次用实际静态数组检查存在性/visibility，显示实际正文预览。006 目录只登记本轮基线的公开文章、两条动态及 about；不存在的/未登记的旧目标默认不展示。未来 legacy 内容删除/转私有必须同步清退目录，新增公开目标需经可信 SQL 更新目录；自动同步是 Round 5 发布桥工作，当前不声称 SQL 能自行获知 GitHub 文件变化。

Community 图册卡显示已公开的描述、图片数量等文本；附件仍遵循 Round 2 私有 Storage 权限，公共主页不签发其他作者资源的 URL。公开资产交付/静态发布在后续发布桥中明确，不能通过个人主页偷开 private bucket。

## 评论编辑状态机

comment_edits 保存不可变 previous_content/proposed_content、按 comment 递增 edit_no、pending/approved/rejected/superseded、reviewer、决策来源及拒绝原因。唯一 partial index 保证每条 comment 最多一个 pending edit。客户端无任何 comments UPDATE（包括旧 status 列授权）；管理员旧审核 UI 已改用 RPC，delete 仍遵循原 admin policy。

| 操作 | comment 公开正文 | edit |
| --- | --- | --- |
| user 编辑 approved 评论/回复 | 原正文、approved 状态保留 | 新 pending；已有 pending 时拒绝再建 |
| admin 编辑自己的评论 | 即时替换并 approved | admin_auto approved，正常历史 |
| user 编辑未公开 pending/rejected 评论 | 更新未公开正文并保持/恢复 pending | 新 pending；旧候选若 pending 则 superseded，保留原快照 |
| admin 通过 edit | proposed_content 替换正文，comment approved | approved |
| admin 拒绝 edit | 已公开正文仍保留；未公开 comment 变 rejected | rejected，必须提供 1–2000 字原因 |

community_edit_comment 只接收 comment UUID 和文本，固定作者且锁住 comment，不能改 parent/目标/作者。community_review_comment_edit 只允许 admin，锁 comment 再锁 edit，只处理 pending；多 admin 竞争只有一次成功。community_moderate_comment 兼容旧评论审核，存在 pending edit 时走相同状态机；旧管理员 UI 传入预览时的正文，若原本 pending 评论在预览后被作者更改则要求重新加载，不批准未看到的新正文。

account.html 新增“我的评论/回复”分页，可从旧文章/动态页本人的“编辑我的评论”链接、通知的 edit 深链接进入。拒绝后展示原因并预填候选正文；管理员在账号中心审核编辑前后的文本。edit UUID 不授予读取权，作者/admin 以外不可读；通知仍仅收件人可读。编辑审核新增 comment_edit_approved/rejected 通知及重编入口，self-notification 不生成；普通社交通知保留。账号删除沿用现有保留旧评论/清空作者的策略，私有 edit 随作者删除；其他作者的审核历史 reviewer 置空。

## 资源中心与孤儿清理

账号中心资源按 20 条分页、文件名搜索（字面子串，不是任意 SQL/wildcard）、图片/视频/文档筛选。展示文件名、MIME、大小、上传时间、短期签名缩略图/查看链接和所有历史 revision 引用数量。可安全重命名 registry 的 original_name，文件路径/owner/MIME/大小不可改。可从任何资源分页选择附件加入当前投稿，已有草稿的分页外引用不会因选择器第一页缺失而丢失。

| RPC | 权限/用途 |
| --- | --- |
| community_assets_page | 只分页当前 uid 的元数据，含引用数量 |
| community_asset_references | 只对 owner 返回引用版本分页，含历史 rejected 和当前公开标记 |
| community_rename_asset | 只改自己 original_name，1–255 字；不可改 Storage object |
| community_prepare_asset_delete | 只给 owner 返回完全无引用资源路径；前端随后 Storage API remove |
| community_orphan_assets | 仅当前 uid 目录、无 object_id 或相同 bucket/path registry 的对象 |
| community_prepare_orphan_delete | 对指定 object UUID 再检查 owner 和无 registry，记录清理意图，再由前端 Storage API remove |

没有 SQL 删除 storage.objects 的业务 RPC。资源和孤儿删除均由前端调用 Storage API；测试直接 SQL DELETE 只是验证 Storage 的数据库约束。任何 draft/pending/approved/rejected/history 引用仍受 Round 2 FK 保护。prepare 是预检查，实际 Storage DELETE 仍检查引用 FK；孤儿清理另在 DELETE trigger 中核对清理意图和 registry，防止准备后并发登记造成误删。registered 删除准备会切换意图；清理意图不超时失效打开竞争窗口，实际删除后清理，Auth 删除时级联。

前端在 RPC 返回后再检查账号未变化、路径在当前 uid 下，再调用 Storage remove；不能通过传 owner 操作别人文件。注册失败/账号切换遗留上传由 owner 登录后的未登记对象列表处理，不能清理别人的目录，admin 也不能以自己的资源中心身份清理他人文件。旧的未绑定真实 Storage object 的 Round 1 元数据不是可签名文件，需在独立测试项目核对后处理，不能当作上传成功凭据。

community-assets 一直是 private、不支持覆盖，签名有效期 60 秒，退出/切换账号清除私有 DOM、表单、缩略图和链接。signed URL 是限时 bearer 凭据，不是绑定浏览器身份的凭据。前端 MIME/大小检查只做 UX；bucket 元数据限制和 RLS 是服务边界，本轮没有服务器端文件内容扫描/嗅探。

## 本地完整 Community CI

Node.js 22，Linux x64 非 root 用户。沿用 Round 2 的 PGlite/pg/原生 PostgreSQL/jsdom，并新增 playwright-core 1.56.1；直接使用环境已有 Chromium/Chrome，不安装浏览器到应用、不连接生产。GitHub Ubuntu runner 使用 /usr/bin/google-chrome，workflow 验证其存在并设置测试环境，不能把 skip 当成功。

```bash
npm install --prefix /tmp/blog-rls --ignore-scripts --no-save --no-audit --no-fund @electric-sql/pglite@0.3.14 pg@8.16.3 @embedded-postgres/linux-x64@18.4.0-beta.17 jsdom@26.1.0 playwright-core@1.56.1
(cd /tmp/blog-rls/node_modules/@embedded-postgres/linux-x64 && node scripts/hydrate-symlinks.js)
export PGLITE_MODULE=file:///tmp/blog-rls/node_modules/@electric-sql/pglite/dist/index.js
export PG_TEST_BIN=/tmp/blog-rls/node_modules/@embedded-postgres/linux-x64/native/bin
export PG_TEST_LIB=/tmp/blog-rls/node_modules/@embedded-postgres/linux-x64/native/lib
export PG_TEST_MODULE=file:///tmp/blog-rls/node_modules/pg/lib/index.js
export COMMUNITY_DOM_MODULE=file:///tmp/blog-rls/node_modules/jsdom/lib/api.js
export BROWSER_TEST_MODULE=file:///tmp/blog-rls/node_modules/playwright-core/index.mjs
export BROWSER_TEST_EXECUTABLE=/usr/bin/chromium # GitHub runner: /usr/bin/google-chrome
node scripts/generate-site.mjs
node scripts/check-seo.mjs
node scripts/check-secrets.mjs
node --test tests/*.test.cjs tests/*.test.mjs
git diff --check
```

Round 1 历史底座的两组测试仍固定到 002；Round 1 社交通知、Round 2 全套及 Round 3 原生 PostgreSQL 运行所有新迁移。因移除了 comments 的直接 UPDATE，原权限/社交测试改用新审核 RPC，并新增直接 UPDATE 拒绝断言，没有放开旧授权来通过测试。SECURITY DEFINER 名称集合继续显式检查，所有空 search_path 断言保留。SEO 同时验证旧站长头像 alt 和新作者身份/个人主页链接，不写新动态 sitemap。

本轮本地完整执行结果：58 项测试全部通过，0 失败、0 跳过；生成、SEO、secrets 与 git diff --check 均通过。GitHub workflow 已配置同样的测试依赖；本地成功不等同于已经观察到远端 Actions 成功。

PostgreSQL 测试执行实际 SQL/RLS，包括私有 UUID、公开投影字段白名单、当前发布指针、点赞失效、编辑私有性、评论正文保留、拒绝/重编、admin 直接发布/社交、资源越权、全部引用保护、孤儿与登记并发、两位管理员并发审核。DOM 使用真实 jsdom，数据接口 mock；Chromium 使用真实 CSS/DOM，在 375px 下验证五页签、三种身份、用户卡、账号编辑器/资源/审核区及 legacy 作者链接，网络只允许测试的临时本地 HTTP 服务，外部请求被拦截。

## Round 4 前人工验收与未完成项

本地数据库模拟 Supabase Auth/Storage 表，不能替代真正 Supabase REST/RPC/Storage HTTP。应在独立测试项目应用新迁移，使用 guest、两个 user、两个 admin 的真实 JWT 复核分页/私有 edit 深链接/直接 UPDATE 拦截、旧评论审核 UI、新编辑审核与通知、真实 Storage upload/sign/download/remove、引用失败与孤儿并发时物理文件不被删除、账号切换和实时降级、邀请/恢复/密码重置。确认公开注册继续关闭，不把验收指向生产。

Round 4 尚未实现私信会话/消息/RLS/通知和收件人入口。Round 5 尚未实现用户内容→GitHub 静态 posts/sitemap/公开资产交付及 legacy 目录自动同步。服务器端内容扫描、容量配额、自动后台孤儿清理、公开内容撤回/账号删除审计保留策略也未实现；本轮提供 owner 主动清理及全部历史引用的保护，不能擅自回收引用。动态主页继续 noindex，不承诺本轮 SEO 索引发布。

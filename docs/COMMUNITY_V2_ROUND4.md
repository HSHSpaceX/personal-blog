# Community V2 Round 4

基于 `feature/community-v2` HEAD `621c177ab1fbe81507f07aee6cd674d0180504f3`。完成个人通知、一对一私信、私信图片及统一消息中心。没有 merge main、没有连接或修改生产 Supabase，13 个旧 migration 保持原样。本地 Auth/Storage 表由隔离 PostgreSQL fixture 模拟；不把本地测试说成真实 Supabase HTTP 验收。

## 新 migrations

- `202610070001_notifications_v2.sql`：通知事件/关联字段、原始评论审核记录、发布后社交通知、分页/已读/计数 RPC，以及公开 Community 评论投影。
- `202610070002_direct_messages.sql`：私信、图片登记/引用、private Storage、参与者 RPC、读取游标、通知关联及安全清理。

迁移只能在独立测试项目按顺序应用。没有公开注册、角色赋值入口或客户端 service_role。

## 通知事件表

| type | 触发条件与收件人 | 白名单 action |
| --- | --- | --- |
| content_approved | 人工通过 revision，通知作者 | 账号中心 revision |
| content_rejected | 人工拒绝 revision，通知作者，完整原因 | 账号中心 revision/重编 |
| comment_approved | 评论首次从未公开变 approved，通知作者 | 账号中心自己的 comment |
| comment_rejected | 初次审核拒绝，通知作者，完整原因 | 账号中心自己的 comment/重编 |
| comment_edit_approved | 人工通过 edit，通知作者 | 账号中心 edit |
| comment_edit_rejected | 人工拒绝 edit，通知作者，完整原因 | 账号中心 edit/重编 |
| content_like | 他人点赞公开 Community/可信 legacy 目标，通知内容作者 | 公开目标 |
| comment_like | 他人点赞 approved 评论，通知评论作者 | 评论所在目标 |
| content_comment | 评论通过后通知公开内容作者 | 公开目标 |
| comment_reply | 回复通过后通知 approved parent 作者 | 回复所在目标 |
| follow | 新关注，通知被关注者 | 关注者主页 |
| direct_message | 原子发送成功，通知另一参与者 | 对应 thread |

user/admin 收件规则完全一致；所有通知均过滤 self-event。若内容作者也是被回复者，只发送 comment_reply，避免同一发布事件重复提醒。`comment_public_events` 为每条评论只记录一次首次公开事件，编辑/重复审核不会重新发送社交通知。pending/rejected 评论不向内容作者/被回复者复制正文。未公开评论的 edit 决策同时保留初次决策记录；首次发布保持原有 comment_approved 以及独立 edit 审核结果，已公开正文的 edit 不再触发首次审核/社交事件。

`comment_review_results` 是私有初次审核历史，保存 author、reviewer、decision、reason 和可选 edit 来源。拒绝原因 1–2000 字且必须有非空白文字；只允许作者/admin 读取。comments 仍无客户端 UPDATE；旧管理员 UI 调用 RPC，拒绝必须填写原因，预览正文发生变化时拒绝陈旧审核。账号中心显示原因，原始 rejected 评论可从旧正文重编，重新提交后仍待审。旧的拒绝记录不伪造追溯原因。

`legacy_public_targets.author_id` 只由可信 SQL 写入：迁移应用时将已存在且具有真实 admin 角色的 hshspacex 映射到当前可信目录；若该用户尚不存在，owner 为 null、通知 fail closed。不会实时从可修改 username 猜测作者；改名也不会转移已有 ownership。新测试项目需先建立站长，再应用迁移，或通过可信 SQL 明确补映射。当前静态图册数组为空，未来 legacy 目标新增、删除、转私有及自动作者同步仍由 Round 5 发布桥处理。

notifications 增加 target_type/target_id、comment_id、dm_thread_id、内部 dm_message_id；沿用 revision_id/comment_edit_id。没有任意 action URL 字段。前端按 type、UUID、受限 slug/username 构建固定本地路由，拒绝路径穿越/非法标识。所有文字使用 textContent/文本节点，头像复用安全 DOM 作者卡。

notifications 原始表 RLS 只允许本人 SELECT/UPDATE(read)，admin 无他人通知读取权；禁止客户端 INSERT/DELETE/其他列 UPDATE。`notifications_page(limit,offset)` 只投影当前收件人，默认 20、最大 50、offset 0–100000，稳定 created_at/id 排序，超过 50 条仍可继续分页。`notification_mark_read(id|null)` 支持单条/全部；`notification_unread_count(include_dm)` 用服务端 count，不依赖客户端分页长度。

## DM 模型与权限

| 表 | 含义与权限 |
| --- | --- |
| dm_threads | UUID 排序的两个参与者，unique(user_low,user_high)，禁止 self；last_no/两个 read_no 由 RPC 管理 |
| dm_messages | thread 内递增 message_no、auth.uid() sender、最多 4000 字，发送后不可客户端修改/删除 |
| dm_assets | sender 登记的真实 Storage object、MIME/大小/文件名，未发送仅 owner 可见，绑定后两方可见 |
| dm_message_assets | 单条最多 4 个图片位置，一张登记图片只能绑定一次；FK 保护所有发送历史 |
| dm_asset_delete_intents | 仅内部使用的注册/孤儿删除意图，实际 Storage DELETE 再检查竞态 |

所有原始 DM 表和 RPC 均拒绝 guest；client 无任何 DM DML。threads/messages/引用的 SELECT 只按两个参与者判断，不调用 is_admin。第三方普通用户和第三方 admin 拿到 thread/message/asset UUID 仍不可读。admin 作为参与者与 user 相同。SQL 管理/service 数据库权限不属于网站 admin 身份。

RPC 固定空 search_path，SECURITY DEFINER 显式 REVOKE/GRANT，无 anon EXECUTE：

- `dm_get_or_create_thread(target_user_id,expected_user_id?)`：稳定唯一 pair，并发创建也返回同一个 thread。
- `dm_threads(limit,offset)`：另一人的最小公开 profile、最近时间及当前用户未读数量，默认 20/最大 50。
- `dm_messages(thread_id,limit,before_no?)`：重新检查参与者，按 message_no DESC keyset 分页。
- `dm_send_message(thread_id,body,asset_ids,expected_sender_id?)`：锁 thread、真实 object、registry；验证自己的尚未发送图片，原子写 message/引用/通知，计算 sender/recipient，不接受客户端 owner/recipient。
- `dm_mark_thread_read(thread_id,through_no?,expected_user_id?)`：只提高当前人的游标，同时标记已展示范围内对应 DM 通知。
- `dm_unread_count()`：只数当前参与者未读的对方消息。
- `dm_register_asset`、`dm_unsent_assets`、`dm_orphan_assets`、`dm_prepare_asset_delete`、`dm_prepare_orphan_delete`：owner 上传登记及分页清理。

前端写操作传入捕获的 expected uid，数据库检查其等于 auth.uid()；这是防账号切换的附加条件，不是可伪造 sender 的授权参数。RPC 默认参数保持 SQL 调用兼容。

## dm-media Storage

bucket 一直 private，最大单图 8 MiB，仅 image/jpeg、image/png、image/webp。路径为 uid/随机 UUID.jpg|png|webp。上传不覆盖，client 无对象 UPDATE，路径唯一索引及已注册对象 trigger 防替换。数据库登记从 storage.objects 实际 metadata 再验证 MIME、size、扩展名；send 再校验一致性。前端 accept/file.type 仅 UX，MIME metadata 并不等于文件内容扫描，本轮没有服务端扫描/嗅探。

未发送/未登记 object 只有目录 owner 可读；发送后的 object 只有 sender + recipient 可读。RLS 不含 admin 例外，restrictive guard 防宽泛自定义 Storage policy 放行；anon 专用 guard 不需要任何 DM helper 执行权。signed URL 60 秒，HTTPS 且 origin 与配置 Supabase 一致，不创建 public URL。限时 bearer URL 在有效期内可被持有者使用；注销不会在服务端提前撤销已签出的 token。

发送过的图片禁止删除，DELETE trigger 与 FK 共同保护；发送锁 object/registry，实际并发删除等待发送提交后仍失败。owner 可删除未绑定 registry 图片或自己的无 registry 孤儿，前端调用 prepare RPC 后再使用 Storage API remove，不使用 SQL DELETE storage.objects 的业务 RPC。孤儿准备后若有并发登记，实际 DELETE trigger 拒绝；注册图片删除必须换成 registered 准备。全部清理只在当前 uid 路径。

上传/登记失败、账号/会话切换后完成的上传可能成为 owner 私有未发送资源或孤儿；清理区分页处理，不拿新账号身份删除旧账号文件。退出/切换立即清空临时附件、文件输入、正文、私信 DOM 和签名链接；不会宣称注销后已自动删除服务器上所有未发送对象。

## 消息中心与 unread

messages.html 两个 Tab：通知/私信。通知分页、未读标记、单条/全部已读、拒绝原因、审核/社交/私信白名单 action。会话卡有头像、显示名/@username、时间、未读数；聊天双方气泡区分、文本和图片、加载更早历史、刷新、文字/纯图片/混合发送。未发送图片可加入当前会话或清理。profile 的私信按钮对登录 user/admin 指向 messages.html?user=UUID，自动创建/打开；guest 指向 login next，自己主页不显示。

账号中心分别展示通知/私信未读数和消息中心入口；消息菜单 badge 为“非 DM 通知未读 + 未读私信”，不把一条私信及其通知重复计数。通知 Tab 的计数包含所有未读事件，包括 direct_message；全部通知已读不意味着私信正文已读。打开 thread 只 mark 已实际加载的最大 message_no，新到但未展示的消息继续未读；DM 通知通过内部 message FK 与同一游标一起读。消息中心每 20 秒刷新计数，聊天内容/会话提供明确刷新按钮，不依赖未实现的 Realtime 订阅。

auth generation、thread generation、请求序号、当前 uid 校验共同丢弃陈旧响应；退出、A→B、admin 降级和换会话立即清空私有状态。历史图片异步返回时同时检查元素仍连接到当前 DOM；签名到期移除 src，可刷新重新签发。Public Community 内容详情另提供 approved-only 分页评论/回复入口，非公开稿件的评论投影为空；作者自己的评论可进入账号中心编辑。

功能型页面保留 noindex/nofollow 链接、不进 sitemap。原静态 posts/moments/albums、GitHub 发布输入和管理员发布逻辑不改，未实现 Round 5 静态桥。

## 验证与后续

沿用 Community CI 的 Node 22、PGlite、原生 PostgreSQL 18.4、jsdom 26.1.0、playwright-core 1.56.1、真实 Chrome/Chromium。workflow 的 glob 自动运行 Round 4 新测试，无新增应用 npm 依赖。

```bash
node scripts/generate-site.mjs
node scripts/check-seo.mjs
node scripts/check-secrets.mjs
node --test tests/*.test.cjs tests/*.test.mjs
git diff --check
```

本轮完整执行 70 项测试，0 失败/0 跳过。包含全部既有回归、真实 PostgreSQL/RLS/并发、真实 DOM 和 375px Chromium。DOM/Chrome 使用 mock 数据与临时本地 HTTP 服务，外部请求被拦截；SQL 权限在原生 PostgreSQL 执行真实语句，不 mock query。测试验证 participants/admin/guest/UUID、直接 DML 拒绝、所有事件和原因、Storage 注册前后权限及元数据、并发 pair/发送删除/孤儿登记、游标竞争、账号/会话切换陈旧响应、图片过期、safe DOM 和移动端无横向溢出。

上线前仍需在**独立 Supabase 测试项目**用 guest、A/B/C、两个 admin 的真实 JWT 验收 REST/RPC、图片 upload/register/sign/download/remove、Storage HTTP 失败时物理文件保留、所有账号/权限切换、真实邀请/密码恢复，以及 legacy owner 映射。不得把测试写入生产。远端 Actions 状态需另行观察，本地通过不等于已观察到远端 Actions 成功。

Round 5：Community article/moment/album→GitHub 静态发布、版本/作者映射、公开资产交付、legacy 目录自动同步、canonical/sitemap/feed/索引衔接及失败重试。未做群聊、管理员查看所有私信、拉黑/举报、撤回、全文搜索、配额/扫描/后台自动清理；这些不是本轮能力。

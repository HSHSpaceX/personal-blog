# 上线前安全审计（2026-10-01）

范围：`feature/invite-auth`，正式域名 `https://hsh-personal-blog.pages.dev/`。没有连接或配置真实 Supabase 项目。

## 已发现并修复

- 001/002 依赖项目默认表授权；在 Supabase 的宽默认授权下，RLS 不阻止 TRUNCATE。003 显式撤销并重建表/列权限，禁止客户端 TRUNCATE、TRIGGER、REFERENCES、role 写入及评论 ID/时间戳/旧作者伪造。anon 无原始 likes/follows SELECT，authenticated 保持仅本人关系 RLS。
- 触发器函数默认对 PUBLIC 可执行。003 撤销其 PUBLIC/anon/authenticated EXECUTE，仅公开身份布尔检查和只返回计数的 RPC；所有 SECURITY DEFINER 固定空 search_path、显式引用表，不接受动态 SQL。
- `like_counts` 只检查数组第一维，二维输入可绕过总量限制。003 使用 cardinality、维度、类型、null 和每项长度校验。
- 回复触发器检查每次 UPDATE，会阻止删除拥有 pending 回复的 Auth 用户时 user_id 的 FK SET NULL。003 仅对插入或 parent_id/post_slug 更新验证；账号删除保留无身份旧内容的回归已通过。
- 访客 `getUser()` 的 AuthSessionMissingError 被当作初始化失败；SDK 初始事件可使并发 ready/角色查询提前以 guest 完成。现在安全识别无 session，验证身份的并发请求共享同一 Promise；role 只信任数据库结果。
- PAT 校验期间退出/清除后仍可能写回凭证，后台还缓存了第二份 PAT。现在统一内存访问，连接绑定用户和请求代次，退出/失去 admin/切换账号/pagehide 清除凭证与输入；晚到校验不能重新保存。退出的身份清除先于网络请求，失败也不恢复本页权限。PAT 不写 localStorage/sessionStorage。
- 安全页面可从 CDN 运行第三方 JS。SDK 2.117.2、KaTeX 0.16.11 及其 CSS/字体/许可证固定存于 assets/vendor，带 npm 包完整性与文件 SHA256，保留上游原始字节（SDK 模板字符串内行末空白按 .gitattributes 保留）；SDK 更新支持 publishable key。已更新网页脚本缓存版本。
- 真实验收脚本将 publishable key 当作匿名 Bearer JWT，可能把认证失败误认为 RLS 正常。现在匿名只发 apikey，先验证账号/角色/公开资料，并预先建立另一用户的关系记录再验证隐私。

## 权限复核

profiles 只允许本人修改公开字段；user_roles 只读本人（admin 可读角色），客户端不能改角色；评论 pending 插入强制本人，公开只看 approved，作者可见自己的 pending，只有 admin 可以审核/删除；点赞与关注强制本人 ID，主键禁止重复；Storage 写入/覆盖/删除检查自己的 UUID 目录，头像只允许 2 MiB JPEG/PNG/WebP。评论、资料、搜索输出继续转义用户文本。公开 RPC 输出仅为数量或内容 target_id + 数量，不返回 liker/follower 身份。前端没有 signUp；公开注册的禁用仍由 Dashboard 设置。

## 验证

- Auth/RLS 静态与 VM 测试：11 项通过。
- 本地真实 PostgreSQL 引擎（PGlite，模拟 Supabase schemas/default grants）：70 项授权、可见性、约束、函数和账号删除断言通过。
- 供应链/真实验收 HTTP 客户端测试：3 项通过，包括全部 vendor 文件哈希、字体路径、页面无 CDN 脚本、匿名不使用 publishable Bearer。
- 搜索：6 项通过；generate-site、check-seo、IndexNow dry-run、sitemap/feed/Bing XML parse、secret scan、git diff --check 通过。
- 本地 http.server + curl：文章与 SDK 200，robots 指向正式域名。
- Chromium：桌面/390px 移动、深色模式、首页/归档/分类/tag/搜索/时间线/动态/图库/登录/资料、静态无 JS 正文、旧入口和本地 KaTeX 通过。真实 vendored SDK 使用模拟项目/API 验证访客、登录、session/admin 恢复、PAT 连接/刷新/退出及 storage 无 PAT 通过。

## 仍需真实部署验证

本地 PostgreSQL 测试不模拟 Supabase Auth/SMTP、PostgREST 或 Storage HTTP 文件检测。按 [部署文档](SUPABASE_SETUP.md#上线前安全验收) 执行三份迁移、关闭注册、配置准确的邮件 redirect/SMTP、Dashboard 邀请用户/授予 admin、检查 bucket，然后用两个普通账号和一个 admin 运行真实验收脚本并走实际邀请/密码恢复邮件流程。GitHub repo permissions.push 的连接检查不单独证明 Contents 权限，实际 GitHub API 仍会校验细粒度权限。固定本地供应链版本仍需定期审阅更新。

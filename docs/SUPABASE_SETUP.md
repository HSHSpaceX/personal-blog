# Supabase 邀请制部署

正式站点：`https://hsh-personal-blog.pages.dev/`。此仓库只提交公开的 Supabase URL 和 publishable/anon key。**service_role、数据库密码、SMTP 密码、GitHub PAT 不得写入仓库或网页配置。**

1. 在 Supabase 创建项目。在 **Authentication → Providers → Email** 启用邮箱密码；在 **Authentication → Settings** 关闭 **Allow new users to sign up**（公开注册）。按项目当前 Dashboard 的提示配置邮件服务；生产环境建议使用自己的 SMTP。不要在页面提供 `signUp` 按钮。
2. 在 **Authentication → URL Configuration** 将 Site URL 设为 `https://hsh-personal-blog.pages.dev/`，允许重定向 URL 加入 `https://hsh-personal-blog.pages.dev/login.html?reset=1`，也可加入 Cloudflare 无扩展名形式 `/login?reset=1`。邀请邮件/重置邮件须使用正确正式域名。
3. 在 **SQL Editor** 依次执行 `supabase/migrations/202609300001_invite_auth.sql` 和 `supabase/migrations/202609300002_private_reactions.sql`。检查 `profiles`、`user_roles`、`comments`、`likes`、`follows` 已启用 RLS；原始点赞／关注关系只允许本人读取，公开计数经 `like_counts`、`follower_count`、`user_like_count` RPC；`avatars` bucket 公开可读、单文件 2 MB、仅 JPG/PNG/WebP。迁移先于邀请用户执行；若已有 Auth 用户，请手工为每个用户补 `profiles` 和 `user_roles`。
4. 在 **Authentication → Users** 用 Dashboard 手动邀请/创建站长账号。复制其 UUID。在 SQL Editor 执行以下命令，将占位 UUID 替换成真实 UUID：

   ```sql
   update public.user_roles set role = 'admin' where user_id = 'YOUR-ADMIN-UUID';
   update public.profiles set username = 'hshspacex', display_name = 'HSH(站长)' where id = 'YOUR-ADMIN-UUID';
   ```

   用户名 `hshspacex` 用于公开资料和关注入口。**不要**让浏览器或普通用户写 `user_roles`。
5. 在 `site.config.mjs` 填写项目 **Settings → API** 中的 `SUPABASE_URL` 和 **publishable key**（旧项目可使用 anon key），可选填公开 HTTPS `JOIN_REQUEST_URL`。运行 `node scripts/generate-site.mjs` 生成 `js/config.js`，再运行 `node scripts/check-seo.mjs`。不要将 service_role key 填入任何前端文件。
6. 部署到正式 Pages 域名。邀请用户时在 Dashboard 的 **Authentication → Users → Invite user** 填写邮箱；邀请链接会在 Auth 回调后打开设置密码页。若 Dashboard 支持指定邀请重定向，填 `https://hsh-personal-blog.pages.dev/login.html?reset=1`。取消公开注册后，新用户只能由 Dashboard 创建/邀请。忘记密码通过 `login.html` 的按钮发送恢复邮件，链接回到同页设置新密码。先用测试邀请邮件完整走一次设置密码和再次登录。
7. 在 Storage 检查 `avatars` bucket。上传路径为 `<auth-user-uuid>/avatar-<time>.<ext>`；RLS 只允许用户写自己 UUID 文件夹。公开头像链接供评论和资料页显示。

## 旧评论

`js/comments.js` 仅作离线只读兼容；配置 Supabase 后，评论和公开搜索以数据库为准。先运行 `node scripts/legacy-comments-to-sql.mjs > /tmp/legacy-comments.sql`，审阅输出，删除不想迁移的旧测试评论，再在 SQL Editor 执行。脚本不读取或导出旧邮箱、设备信息；旧评论 `user_id` 为 `NULL`，`legacy_author_name` 保留原昵称，不伪造 Auth 用户。导入前可备份原文件，但不得把邮箱/设备字段带入新表。新评论仅登录用户可提交，默认 `pending`；管理员在 `admin.html#messages` 审核为 `approved` 或 `rejected`。匿名只可读取 approved，作者可读取自己的 pending。

## RLS 复核

使用 Dashboard SQL Editor 检查 `pg_policies`，并用**两个普通测试账号和一个 admin** 在浏览器或 Supabase API 测试：匿名访客读取 `likes`/`follows` 原始行应为空或拒绝，但计数 RPC 可用；登录用户读取他人的点赞／关注行应为空或拒绝；未登录插入 `comments`/`likes`/`follows` 应拒绝；普通账号插入他人 `user_id`、更新他人 profile、写 `user_roles`、审核/删除他人评论都应拒绝；admin 可审核/删除；同一账号相同 target 连续点赞两次第二次应因主键冲突被拒绝；他人 UUID 文件夹的头像上传应拒绝。`tests/auth-policy.test.cjs` 对迁移与前端入口做静态守卫检查；它不能代替在真实项目中测试 RLS。

删除账号时 Auth 用户级联清除 profile/role/likes/follows；历史评论保留内容，`user_id` 变 `NULL` 后以“已注销用户”显示。不要用 service_role 在浏览器绕过 RLS。

完成配置后，可在**测试项目**中用三个 Dashboard 创建的测试账号运行 `node scripts/check-supabase-rls.mjs`。将 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 和 `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`、`TEST_OTHER_EMAIL`/`TEST_OTHER_PASSWORD`、`TEST_ADMIN_EMAIL`/`TEST_ADMIN_PASSWORD` 仅作为本机环境变量提供；脚本不打印凭据，会清理测试评论与点赞。普通测试账号保持 `user` role，管理员测试账号由 SQL Editor 授予 `admin` role。不要将这些变量写进仓库或 CI 日志。

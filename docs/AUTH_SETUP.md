# 登录、权限与 GitHub PAT

本站为邀请制。登录入口 `login.html` 支持邮箱密码、会话恢复、退出和密码重置，不调用公开注册接口。`profile.html` 供登录用户修改自己的用户名、显示名、简介及头像，也可访问 `profile.html?username=hshspacex` 关注站长。站长身份由 Supabase `user_roles.role = 'admin'` 决定；前端仅改善显示，真正的资料、评论、点赞、关注与头像访问由 RLS 限制。没有 Supabase 配置时，页面保持可读，登录和写入操作显示不可用。

先按 [Supabase 部署步骤](SUPABASE_SETUP.md) 创建项目、关闭公开注册并执行迁移。`JOIN_REQUEST_URL` 可指向站长自己的公开申请表单；留空时不显示“申请加入”链接。邮件重置必须将站点域名加入 Supabase redirect allowlist。不要在浏览器代码中调用 admin API、使用 service_role 或自动创建账号。

后台文章/动态/图库仍通过 GitHub Contents API 发布，因此 admin 登录后另需一个对 `HSHSpaceX/personal-blog` 有 Contents Read and write 的 fine-grained PAT。连接时验证 GitHub `/user` 和目标仓库的 `permissions.push`。PAT 默认放在内存和该浏览器标签页的 `sessionStorage`，关闭会话或退出时清除。旧版 `blog-gh-token` localStorage 条目在新脚本加载时清除；没有“记住本机”功能，也没有使用 Supabase 密码加密 PAT。不要把 PAT 粘贴到 issue、PR、README 或配置文件。

评论审核只使用 Supabase admin 权限，**不需要 PAT**。后台内容编辑仍需要 GitHub PAT，并受 GitHub 仓库权限控制。若在后台新增/修改文章，`Generate static site SEO files` GitHub Action 会生成静态文章、sitemap、feed 和公开配置文件；部署前检查它运行成功。Cloudflare Pages 的正式域名和当前 canonical 保持 `https://hsh-personal-blog.pages.dev/`。

已有 `js/albums.js` 中标记为 private 的画廊仍是公开静态仓库中的数据，不能作为机密内容保存；此轮没有把图库存储迁入私有服务。不要在公开仓库上传机密照片。

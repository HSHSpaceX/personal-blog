# 登录、权限与 GitHub PAT

本站为邀请制。登录入口 `login.html` 支持邮箱密码、会话恢复、退出和密码重置，不调用公开注册接口。`profile.html` 供登录用户修改自己的用户名、显示名、简介及头像，也可访问 `profile.html?username=hshspacex` 关注站长。站长身份由 Supabase `user_roles.role = 'admin'` 决定；前端仅改善显示，真正的资料、评论、点赞、关注与头像访问由 RLS 限制。没有 Supabase 配置时，页面保持可读，登录和写入操作显示不可用。

先按 [Supabase 部署步骤](SUPABASE_SETUP.md) 创建项目、关闭公开注册并执行迁移。`JOIN_REQUEST_URL` 可指向站长自己的公开申请表单；留空时不显示“申请加入”链接。邮件重置必须将站点域名加入 Supabase redirect allowlist。不要在浏览器代码中调用 admin API、使用 service_role 或自动创建账号。

后台文章/动态/图库仍通过 GitHub Contents API 发布，因此 admin 登录后另需一个只授权 `HSHSpaceX/personal-blog`、Contents Read and write 的 Fine-grained PAT。连接时验证 GitHub `/user` 和目标仓库的 `permissions.push`。PAT **仅保存在当前标签页临时 sessionStorage 与 JS 内存中**；刷新/同标签页跳转可恢复，退出登录、失去 admin 权限或切换账号后立即清除，关闭标签页后会话存储失效。旧 localStorage 和旧 sessionStorage 键会清理；无跨标签页“记住本机”功能，也不使用 Supabase 密码加密 PAT。网站身份由 Supabase 验证，PAT 只验证 GitHub Legacy 写权限。已有 Classic PAT 可兼容，但不推荐新建。不要把 PAT 粘贴到 issue、PR、README 或配置文件。

原始 `likes` 和 `follows` 行仅本人可读，匿名访客无法枚举谁点赞或关注了谁。公开数量由只返回计数的 SQL RPC 提供；资料页“已点赞 X 次”指该用户点出的赞。

评论审核只使用 Supabase admin 权限，**不需要 PAT**。后台内容编辑仍需要 GitHub PAT，并受 GitHub 仓库权限控制。若在后台新增/修改文章，`Generate static site SEO files` GitHub Action 会生成静态文章、sitemap、feed 和公开配置文件；部署前检查它运行成功。Cloudflare Pages 的正式域名和当前 canonical 保持 `https://hsh-personal-blog.pages.dev/`。

已有 `js/albums.js` 中标记为 private 的画廊仍是公开静态仓库中的数据，不能作为机密内容保存；此轮没有把图库存储迁入私有服务。不要在公开仓库上传机密照片。


## 前端资源与上线审计

Supabase SDK 固定为 **2.117.2**（支持新的 publishable key），KaTeX 固定为 **0.16.11**，JS/CSS/字体和许可证保存在 `assets/vendor/`，安全页面无需从 CDN 加载可执行脚本。`manifest.json` 记录 npm 来源、包完整性和每个文件的 SHA256；`tests/supply-chain.test.mjs` 检查完整性、字体路径及页面引用。升级时从官方固定版本 npm 包重新 vendoring 并更新清单，保留许可证并运行回归；本地固定版本仍需定期检查上游安全更新。

PAT 统一由 `GitHubCredentials` 管理，后台不保存第二份副本。退出（包括远端退出事件）、失去 admin、切换账号或离开页面都会清空凭证和 PAT 输入框；校验期间发生上述变化会使本次连接失效，不会重新填回凭证。刷新/关闭/浏览器返回缓存后均需重新连接。连接校验 `/user` 和仓库 `permissions.push`；这个检查不单独证明 Fine-grained token 的 Contents 写权限，GitHub Contents API 会在实际写入时强制校验。仍只需指定 personal-blog、Contents Read and write，无需账号级 admin/Actions/其他仓库权限。

未配置 Supabase 时只读降级；已配置但无 session 时正常显示访客。邀请/密码恢复回到正式域名的 `login.html?reset=1`，新密码保存后退出当前会话并返回登录入口。前端没有公开 `signUp` 调用，关闭公开注册仍必须由 Dashboard 实施。

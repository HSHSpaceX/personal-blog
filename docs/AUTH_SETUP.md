# 登录与统一管理权限

网站仅使用邀请制 Supabase Auth；普通用户与管理员共用账号中心、编辑器和资源中心。Dashboard 邀请账号，服务器验证 JWT 后从 user_roles 获取角色，不能信任 email、username 或 metadata 赋权。

所有浏览器 GitHub PAT 输入、连接和 Contents API 写入均已停用。旧本机/sessionStorage 凭据键会清理，刷新、切换账号或管理员身份也不能恢复令牌。admin.html 仅转到统一管理中心。无需申请或输入 PAT；不要把凭据放进公开配置、日志、issue 或 PR。

前端仅配置 Supabase URL 和公开 publishable key。service_role 仅用于受控 main Actions 发布/经审批的历史导入。网站管理员保存文案必须经过 JWT 和数据库角色验证的 RPC；发布服务从已批准公开版本读取，不接受任意客户端 HTML。

普通用户修改自己内容、保存草稿、投稿并参与关注/评论/私信；已发表修改须重审，旧版本在审核期间继续公开。管理员保留全部社交能力，额外拥有审核、正整数周期配置、精选、回收站恢复、站点文案和评论管理。管理员不能浏览他人未投稿资源，只有审核已引用资源可预览；非参与管理员不能读取私信。

退出、账号切换和权限降级优先清除私有编辑内容及签名预览，未保存提醒不能阻止安全清理。正文与签名不写入额外本机持久存储；保存失败保留 dirty，已保存但提交失败明确区分状态并重用 revision。

Auth 回跳、密码重置、SMTP、27 项迁移、历史导入、GitHub Publisher 和 Cloudflare Pages 验收以 [最终部署手册](FINAL_DEPLOYMENT_GUIDE_20261018.md) 为准。本机没有连接生产 Supabase，CI 全绿不代表真实 Storage/Auth 已验收；不需要合并历史 PR。

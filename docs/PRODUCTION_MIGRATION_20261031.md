# 2026-10-31 生产数据库迁移结果

后续状态：两个 Secrets 已配置，真实 Auth/Storage 验收、获批准的历史导入和 Publisher/Cloudflare 发布已完成。本文下方“尚未完成”是迁移结束时的历史状态，当前结果见 [生产发布报告](PRODUCTION_RELEASE_20261031.md)。

正式项目 `hscqeswnscnvkdthhlfp` 已完成第 18 项专用前向修复，以及兼容版第 23～27 项升级。用户在数据库归档恢复、Storage 全文件备份和最终执行清单完成后集中批准。实际执行时间为北京时间 22:21～22:22，后置验证于 22:25 完成。

数据库安装状态为 `base_state=ready`、`round2_state=ready`。这只证明本次数据库升级通过，不能替代真实账号、Storage HTTP/TUS、邮件与 Publisher 发布闭环验收。

## 实际执行记录

| 操作 | Supabase migration version | 结果 |
| --- | --- | --- |
| 第 18 项缺失文档对象专用修复 | 20261031142139 | 已提交 |
| 完整第 22 项只读边界检查 | 不写迁移记录 | 通过 |
| 兼容版第 23 项 Storage 保护 | 20261031142205 | 已提交 |
| 第 24 项发布契约 | 20261031142207 | 已提交 |
| 第 25 项审核队列 | 20261031142210 | 已提交 |
| 第 26 项动态删除 | 20261031142212 | 已提交 |
| 第 27 项文章精选与用户搜索 | 20261031142214 | 已提交 |

执行的是经过 SHA256 核对并在原生恢复副本中演练的文件。没有重跑第 1～22 项历史迁移，没有使用原始第 23 项，没有修改托管 Storage 表结构、owner 或原生索引，也没有使用旧测试项目。每步的 SQL 摘要、开始/结束时间和 MCP 实际结果保存在本机受限备份目录，私人数据没有进入仓库。

## 验证通过

- 原生 Custom Archive 经 `pg_restore --list`、解压和全新隔离 PostgreSQL 恢复验证。预建 Supabase 角色并保留 owner/ACL/RLS；原生环境不具备的 Vault 扩展条目只在本地恢复列表排除，已核实其数据为空。原始归档不变，不把这次验证称为托管全服务灾难恢复。
- 全部 Storage 对象字节备份完成，大小及 SHA256 校验通过；私有文件另与生产 ETag 核对。
- 迁移前实时数据与原生归档一致。迁移后所有原有表的原有列和行逐项一致，序列值不变；新增字段使用迁移规定的默认值。
- 完整 preflight、postflight 执行成功；关键 RPC 的定义摘要、EXECUTE ACL、SECURITY DEFINER 和空 search_path 与原生演练一致；应用表 RLS 均保持启用。
- Storage 结构与原生索引保持不变，两个私有 bucket 仍为 `DISABLED`；登记、owner、引用、预约和 tombstone 检查通过；没有孤立引用或无效约束。两个业务资源外键已按兼容迁移改为 `ON DELETE RESTRICT`。
- PostgREST schema cache 已刷新。真实匿名 HTTP：`community_capabilities` 返回 200/20261013；`profile_search` 返回 200 且仅包含公开字段；服务端专用 `community_release_preflight` 返回 401/42501；私有 dm-media 对象的公开访问被拒绝。
- Auth 只读检查：公开注册关闭、邮件自动确认关闭；公开资料和头像读取成功。
- 升级后正式网站再次完成 375/1440 宽度下的首页、文章、动态、时间线、归档、精选、用户主页共 14 组浏览器检查：HTTP 200，头像与当前资料一致且加载成功，无横向溢出或页面脚本异常。

## 尚未完成

- GitHub Repository Secrets 已有 `SUPABASE_URL`，仍缺 `SUPABASE_SERVICE_ROLE_KEY`，自动 Publisher 尚未恢复。没有为了验证而创建或发布公开内容。
- 真实普通用户/管理员账号的上传、跨账号拒绝、签名链接、TUS、邀请与密码重置邮件尚待受控验收。没有把本地 SQL 测试算作真实 HTTP 验收。
- 历史内容仍为 dry-run；正式作者身份、最终导入清单及实际导入需独立确认和授权。
- 安全 Advisor 报告包含预期的 SECURITY DEFINER 可执行入口、无客户端策略的内部 RLS 表，以及尚未启用的泄露密码保护。没有为消除告警而放宽权限或修改 Auth 配置。参考 [RPC 告警说明](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[内部 RLS 表说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[密码保护配置](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

头像一致性修复已在此前提交中上线，本次没有重新修改头像逻辑。原生恢复限制、精确数据对比、备份摘要及恢复方案位于本机备份目录；备份、密钥和私人数据不提交 GitHub。

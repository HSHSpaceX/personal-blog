# 2026-10-31 生产发布与历史导入结果

正式项目 `hscqeswnscnvkdthhlfp`。数据库升级、真实账号/Storage HTTP 验收及获批准的历史内容发布已实际执行。历史内容已通过 Supabase → Publisher → GitHub → Cloudflare；邀请/重置邮件投递以及登录后的编辑、审核、私信浏览器操作尚未全部验收，不能将本报告理解为所有业务场景均已通过。

## 数据库与备份

- 第 18 项八个差异来自三个函数及 ACL 缺失、封面触发器缺失、旧 body validator 实现，不是格式白名单问题。专用前向修复后，完整第 22 项边界验证通过。
- 兼容版第 23 项与第 24～27 项已于本日完成。没有重跑第 1～22 项，没有修改托管 Storage 表 owner、原生索引或结构，没有使用旧测试项目。执行版本见 [数据库迁移报告](PRODUCTION_MIGRATION_20261031.md)。
- 历史内容发布后再次执行 postflight：`base_state=ready`、`round2_state=ready`，缺失对象及诊断错误为空，两个私有 bucket 均 `DISABLED`，无删除预约或 tombstone 遗留。
- 迁移前 PostgreSQL Custom Archive 已用 `pg_restore --list` 检查并在全新隔离原生 PostgreSQL 恢复。恢复预建 Supabase 角色；本机缺少的空 Vault 扩展条目只在本地排除，原归档不变。这不是托管全服务灾难恢复测试。
- 原有 26 个 Storage 文件均有实际字节备份。导入前后均保存受限目录中的 68 表快照；导入后新增的 6 份媒体已另存字节与 SHA256，并记录对应 12 个私有/公开对象的恢复路径。备份和私人数据不在 Git 中。

## Auth、Storage 与头像

[真实 HTTP 验收 41211954175](https://github.com/HSHSpaceX/personal-blog/actions/runs/41211954175)：43 PASS、0 FAIL。批准范围内创建一个普通用户和一个临时管理员，验证实际密码登录、角色、头像上传及资料持久化、跨账号资料/头像拒绝、私有文件读写隔离、管理员不能读取他人私有文件、签名下载、头像 MIME/2 MiB 限制、TUS 6 MiB 分块后续传及完整 SHA256、刷新会话和退出后 refresh token 失效。

测试账号及测试路径均清理成功；清理后原有 68 表深度逐行比较完全一致，原 3 用户和 26 个对象不变。没有发送测试邮件、私信或创建公开测试文章。数据库层的历史 revision/私信引用保护、竞态、事务回滚、删除预约及恢复由原生 PostgreSQL 回归验证，没有在生产制造破坏性历史数据。

普通用户头像反馈已由站长确认是操作问题，未重新开发上传流程。此前头像一致性修复保持有效；旧文章/动态使用已确认的站长身份及公开资料头像，原链接保留。

## Publisher 与真实历史发布

两个 Repository Actions Secrets 的名称和作用域已核实；没有读取或打印密钥。真实只读 RPC 均成功。修复了 Publisher 对 void RPC 的 HTTP 204 响应仍调用 JSON 解析而失败的问题，相关回归测试已加入。

站长确认历史作者并批准配置后，`legacy_author_id` 设为站长账号 UUID。随后另行批准正式导入，执行清单摘要为 `c94fc3510bcc7e9f9cd92a7783b7cb6c27734d44d13d0ffd0e0002ad37c087b2`，源提交为 `94cc0cf44186bbc76069ad910602bc96781e365d`。

| 内容 | 保留的历史标识 | 日期 |
| --- | --- | --- |
| 奥匈帝国的兴衰：一个多民族帝国的百年孤独 | post-austria-history | 2026-09-20 |
| 星舰14飞 | m20260930-153407-jq9o | 2026-09-30 15:34 +08:00 |
| 纪念吴老师 | m20260914-204633-fp3i | 2026-09-14 20:46 +08:00 |

- [导入工作流 41216040550](https://github.com/HSHSpaceX/personal-blog/actions/runs/41216040550) 成功：3 项内容、3 个批准版本、3 条历史映射及 6 个媒体登记。关于页未导入。
- [Publisher 41216105176](https://github.com/HSHSpaceX/personal-blog/actions/runs/41216105176) 成功：导出、媒体同步、生成/SEO/Secrets/23 项回归、verify、push、finalize 全部通过。
- 实际公开提交：[904cc6f16903ae58b6882ef5be781d466e6d9c71](https://github.com/HSHSpaceX/personal-blog/commit/904cc6f16903ae58b6882ef5be781d466e6d9c71)，修改两个公开快照及原路径下的文章生成页面。旧文章、动态、相册源文件和 assets 均未更改。
- 3 项 publication state 均为 `published`，desired/published revision 一致，commit 指向上述提交，last_error 为空。Cloudflare 对该提交部署成功。
- 6 个公开媒体通过真实 HTTP 下载，大小、MIME、SHA256 与批准清单全部一致，共 7,718,034 字节。原扩展名 jpg、真实内容 PNG 的文件按 PNG 发布；原静态文件保留。
- 部署后首页、旧文章地址、动态、站长主页在 375/1440 宽度完成 8 组浏览器检查：头像和公开图片加载成功、无横向溢出或脚本异常；两个旧动态锚点各出现一次，无重复内容。文章与动态截图已核对。
- 导入前所有原有表记录保持逐字段不变，包括已有社区条目、用户、评论、私信及媒体。新增 6 个私有对象及 6 个公开副本后 Storage 共 38 个对象，用户仍为原有 3 个。

## 测试边界与未完成项

[完整 CI 41211897470](https://github.com/HSHSpaceX/personal-blog/actions/runs/41211897470)：186 项，185 PASS、0 FAIL、1 SKIP，含原生 PostgreSQL 权限/并发/事务及 PGlite。固定的隔离托管 HTTP 测试仍为 SKIP；本次 43 项获授权真实生产 HTTP 验收独立记录，不将 SKIP 算作通过。此前本地完整回归、恢复副本迁移演练及升级后的 14 组头像、26 组公开/未登录入口检查均已记录。

仍需完成：真实邮件邀请和密码重置投递、托管 SMTP/Site URL/Redirect URLs 配置核实，以及登录后的草稿编辑、审核和私信浏览器验收。没有通过关闭 RLS、提升普通用户权限或放宽私有 bucket 来绕过问题。历史导入的批准版本发布已验证，但不等同于普通用户从编辑器新建内容到审核的完整验收。

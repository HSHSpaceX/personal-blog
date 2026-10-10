# Community V2 GUI 最终整合

开始基线：integration/community-v2 a537dc4bc1cc5a35b682615b43e813f955a71038；main 7e955659045a715539f674f74c8367145908e34f。远端核对后无新 main 提交，本轮不合并 PR、不部署生产。

## 工作区与目录

账号中心使用 css/workspace.css 和 js/workspace.js。桌面左侧目录可收起为窄条，375px 使用带背景遮罩和键盘焦点约束的抽屉。所有独立模块都保留 DOM，仅切换 hidden；hash 路由支持刷新、前进/后退。#content 兼容 #articles，#assets、#review-center、?revision、?comment 和资料编辑链接保留。普通用户目录包括概览、资料、文章、动态、图册、评论/回复、资源、通知、私信、关注/粉丝、设置；admin 额外获得审核、规则、站点页面、Legacy 管理入口。

主工作区保持原渐变背景、玻璃卡片、顶部品牌、圆角和宽松间距，一次只显示一个功能模块。资料/消息通过同源内嵌现有页面复用原事件与权限链路，退出或切换账号时销毁内嵌文档并清空私有编辑状态。公开主页只增加初始 tab 深链接，保留全部原功能与分页。

## 共用编辑器与数据格式

js/content-editor.js 是唯一可视化正文编辑核心：Community 用户和 admin 使用 communityRichEditor；Legacy 使用原 richEditor、标题/元数据/预览/源码/保存链路。核心提取原工具栏与 contenteditable 操作，支持段落、H2/H3、粗体/斜体、引用、编号/无序列表、代码、安全链接、图片/视频/附件选择。Community 不提供 HTML 源码提交接口；粘贴仅取纯文本，正文序列化为白名单 JSON，不保存 innerHTML。

正文 body.document = {version:1,blocks:[...]}。块类型为 paragraph、heading、quote、code、list、asset；行内只包含 text、bold/italic marks、安全 http/https/mailto 链接。最多 200 块，正文上限延续旧类型限制；未知字段、危险协议、用户凭据 URL、事件/脚本字段拒绝。asset 只能引用本 revision 的资源 UUID。body.text/description 是 document 的一致纯文本投影，用于兼容搜索及原纯文本 revision。旧 revision 不要求 document；Legacy 可信 GitHub HTML 保持可编辑，不迁移或重写已有内容。

js/community-schema.js 负责前端与 Node 发布器验证，js/community-public.js 使用验证后的块生成转义 HTML，并适配文章/动态/图册公开正文。分类、标签、摘要、已选图片封面、图册图片说明与排序仍走现有 revision 保存/审核接口。Supabase 私有资源选择器与 Legacy GitHub 资源管理分别工作；普通用户不需要 PAT。

## 数据库与权限

唯一新增 migration：supabase/migrations/202610100001_safe_content_document.sql，按文件名顺序在 202610070004_category_raw_length.sql 之后执行。它新增严格 document/inline 验证，并扩展 community_validate_body；封面触发器独立验证作者所有权和图片 MIME。所有内部验证/触发函数撤销 public/anon/authenticated 直接执行权限，security definer 固定空 search_path。

未重写任何旧 migration，也未改变 RLS、不可变 revision、review audit、public version pointer、publication state、默认人工审核、N 次首次投稿阈值、普通用户已发布修改重审、admin 自投稿自动通过等语义。拒绝理由、重编、评论修改、资源历史引用保护、通知去重、个人主页、私信参与者隔离和 signed URL 路径保护沿用原实现。

GitHub PAT 仅用于 Legacy 写入，不决定网站角色。保留 main 的同标签页临时 sessionStorage 策略，退出/降权/切换账号清除，关闭标签页失效，不写 localStorage；已修正文档/界面关于“仅内存”的过时说明。

缺少 Supabase 表/RPC 时显示明确项目/迁移/schema-cache 提示，操作不会被当作成功，其他账号模块仍可用。本轮没有连接真实 Supabase。

## 验收与上线责任

本机隔离测试运行：PGlite 0.3.14、jsdom 26.1.0、Playwright-core 1.56.1、Edge Chromium。tests/workspace-browser.test.mjs 使用本机 HTTP 服务和被拦截的 fixture 后端，覆盖 1440×900、1024×768、768×1024、375×812、两种角色、浅/深色、目录、独占模块、路由/历史/草稿、三个内容类型、资源选择、保存/审核状态、账号切换、后端未部署提示与 Legacy GitHub mock 保存。

截图由 GUI_EVIDENCE_DIR 指定，本次保存在 C:/Users/chdxm/.codex/visualizations/2026/10/07/01a1172e-b904-7792-b927-1d46b5bb992d/gui-evidence/；可通过环境变量重跑生成。Round 1–5 测试保留；Windows 浏览器 fixture 路径改为系统临时目录与 path.relative 边界校验，不降低安全断言。测试新增正文攻击向量、数据库独立验证/审核/权限/封面验证，并对新 internal trigger 增加不可执行权限断言。

本机无 Linux 原生 PostgreSQL 测试配置、也无已安装 WSL 发行版，因此 native multi-connection/Storage 模拟测试留给 GitHub Actions。PGlite、DOM 和真实浏览器均实际执行。真实 Supabase Storage HTTP 验收、真实用户邀请/登录、迁移执行、配置核对、Cloudflare 环境指向与上线由站长完成；不得在前端通过放松权限修复 schema-cache 问题。

交付停在 PR #4，main 的最终合并及生产部署等待站长决定。

本机最终回归：86 项测试，74 通过、0 失败、12 项 native PostgreSQL 因缺少环境跳过；generate-site、SEO、secret scan、supply-chain 3/3、生成器重复执行字节幂等均通过。最终提交 SHA 与 PR #4 Actions 结果在交付报告中列出。

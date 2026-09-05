# 拾光手记

一个纯静态的个人博客，使用 HTML、CSS 和原生 JavaScript 搭建，不依赖构建工具，打开 `index.html` 就能浏览，也可以免费发布到任意静态托管平台。

## 页面

- 首页：精选文章、最新文章、分类入口
- 归档：按分类和标签筛选，按标题或标签搜索
- 文章页：阅读进度、上一篇 / 下一篇
- 关于：个人介绍与联系方式
- RSS：`feed.xml`

## 修改内容

所有文章都放在 `js/posts.js` 的 `window.BLOG_POSTS` 数组里。新增文章时复制其中一项，修改 `slug`、`title`、`category`、`tags`、`date`、`cover`、`excerpt` 和 `content` 即可。`content` 使用 HTML 书写，支持段落、标题、列表、引用和代码块。

封面图片放在 `assets/covers/` 目录，替换同名文件或修改文章数据中的 `cover` 路径即可。博客名称、简介和关于页文字在 `index.html`、`about.html` 中修改。

## 手机后台编辑（可选）

1. 在 GitHub 创建只授权本仓库的 Fine-grained Token（Settings → Developer settings → Fine-grained tokens）：Repository access 选择 `personal-blog`，Permissions 中将 Contents 设为 Read and write。
2. 手机或电脑点击网站菜单栏的“登录”，或打开 `https://hshspacex.github.io/personal-blog/login.html`，输入账号密码登录后进入后台。
3. 每台设备首次进入后台需要粘贴 GitHub Token 并连接，之后 Token 会记住在本机。
4. 在后台可以新增、修改、删除文章，也能直接上传封面图。保存后会自动提交到 `main`，GitHub Pages 一两分钟内自动发布。
5. GitHub Token 只保存在当前设备的浏览器 localStorage 中，不会进入仓库；在后台点“退出”会同时清除登录状态和 Token。

两点说明：保存和删除只会更新文章数据 `js/posts.js`，RSS（`feed.xml`）需要手动同步；每次打开页面都会自动加载最新的文章数据，但 GitHub Pages 构建需要一两分钟，刚保存完稍等片刻再刷新。

## 修改网站图标

把新的方形图片覆盖 `assets/icon.jpg` 即可，浏览器和标签页图标会自动更新。如果没立即生效，强制刷新页面（Ctrl+F5）或清除图标缓存。

## 修改登录账号密码

登录凭据以 SHA-256 哈希保存在 `js/login.js` 中。修改方法：用 Node 生成新哈希后替换对应字段：

```bash
node -e "const c=require('crypto');console.log(c.createHash('sha256').update('新的账号或密码').digest('hex'))"
```

## 本地预览

直接双击 `index.html` 即可打开；也可以用任意静态服务器获得更完整的体验：

```bash
python -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 免费发布

这个项目是纯静态网站，以下平台都有免费额度：

1. Vercel：安装 Vercel CLI 后，在项目目录运行 `vercel deploy`。
2. Netlify：使用 Netlify Drop 直接把项目文件夹拖入网页，或运行 `npx netlify deploy --prod`。
3. GitHub Pages：把项目推送到 GitHub 仓库，在 Settings → Pages 中选择部署分支。

发布到正式域名后，把 `feed.xml` 里的 `https://hshspacex.github.io/personal-blog/` 替换成你的真实域名。

## 示例封面来源

示例文章的封面图片来自 Unsplash，遵循其免费使用许可。替换为自己的图片即可完全归你所有。

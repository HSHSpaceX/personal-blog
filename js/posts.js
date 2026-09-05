/* 文章数据：修改或新增文章后，首页、归档和文章页会自动更新。 */
window.BLOG_POSTS = [
  {
    slug: "static-blog-guide",
    title: "从零搭建一个免费个人博客",
    category: "技术",
    tags: ["Web","指南"],
    date: "2026-09-02",
    readingTime: 8,
    cover: "assets/covers/cover-code.jpg",
    featured: true,
    excerpt: "不需要服务器，也不需要付费订阅。用 HTML、CSS 和一点 JavaScript，就能拥有一个完全属于自己的博客。",
    content: `<p>很多人以为个人博客一定要买服务器、装 WordPress，其实对于以写作和记录为主的博客，静态网站已经足够好用。它速度快、几乎不需要维护，而且可以免费托管在任何静态平台上。</p>
      <h2>这篇文章记录我搭建本站的完整思路，你也可以照着做一套完全属于自己的。</h2>

      <h2>为什么选择静态网站</h2>
      <p>静态网站把每篇文章提前生成为普通的 HTML 文件，访问时不需要后端程序运行。相比动态系统，它有几个明显的优点：</p>
      <ul>
        <li>免费托管：GitHub Pages、Vercel、Netlify 都有免费额度。</li>
        <li>安全省心：没有数据库和后台，几乎不存在被入侵的入口。</li>
        <li>加载快：文件体积小，全球 CDN 都能轻松承担。</li>
      </ul>

      <h2>本站的文件结构</h2>
      <p>为了让内容足够简单，我没有使用复杂的构建工具，而是把所有文章放在一个数据文件里：</p>
      <pre><code>index.html    首页
post.html     文章页面
archive.html  归档与搜索
about.html    关于页
css/style.css 全局样式
js/posts.js   文章数据
js/site.js    页面交互</code></pre>
      <p>新增文章时，只需要在 <code>posts.js</code> 中复制一篇文章的数据结构，改掉标题、正文和封面图即可。首页、归档和 RSS 会自动同步。</p>

      <h2>关于免费托管</h2>
      <p>静态网站可以发布到 Vercel 或 Netlify 的免费套餐，也可以推到 GitHub 仓库后启用 GitHub Pages。它们都支持绑定自己的域名，唯一可能产生的费用是域名本身。</p>
      <blockquote><p>先让内容跑起来，再慢慢优化。博客最重要的始终是写作这件事本身。</p></blockquote>

      <h2>一点建议</h2>
      <p>工具只是起点。真正让博客有价值的是持续记录：写下遇到的问题、读过的书、走过的路。哪怕一周只有一篇，一年后回头看也会很惊人。</p>`
  },
  {
    slug: "post-20260905-1423",
    title: "示例",
    category: "技术",
    tags: ["示例"],
    date: "2026-09-05",
    readingTime: 1,
    cover: "assets/covers/cover-20260905-1455.jpeg",
    featured: true,
    excerpt: "",
    content: `<blockquote><span style="color: var(--ink); font-family: var(--font-sans);"><b>测试</b></span></blockquote><blockquote><img src="assets/posts/img-20260905-1736-0fcs.jpg" alt="插图"></blockquote>`
  }
];

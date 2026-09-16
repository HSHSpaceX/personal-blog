/* 文章数据：修改或新增文章后，首页、归档和文章页会自动更新。 */
window.BLOG_POSTS = [
  {
    slug: "post-20260916-2019",
    title: "测试篇",
    category: "随笔",
    tags: ["测试"],
    date: "2026-09-16",
    readingTime: 1,
    cover: "assets/covers/cover-20260916-2019-b2ob.jpg",
    featured: true,
    excerpt: "",
    content: `<p></p><div>图片测试</div><div><br></div><div><img src="https://raw.githubusercontent.com/HSHSpaceX/personal-blog/main/assets/posts/img-20260916-2021-b0eo.jpg" alt="插图">公式测试</div><div>$$t$$</div><div><br></div><div>目录测试</div><h2>测试</h2><div><br></div><div>链接测试</div><div><a href="https://https://www.kechuang.org/u/108946/profile/moment">https://www.kechuang.org/u/108946/profile/moment</a><br></div><div><br></div><div><br></div>`
  },
  {
    slug: "post-20260916-2132",
    title: "火箭推力计算方法",
    category: "专业",
    tags: [],
    date: "2026-09-16",
    readingTime: 5,
    cover: "assets/covers/cover-20260916-2141-v9uo.jpg",
    featured: true,
    excerpt: "",
    content: `<p>下面是一种简单火箭推力计算方法，内容较简</p><p>取火箭与喷出推进剂为系统。设火箭质量为 m，速度为 v；在时间 dt 内喷出质量 dm，喷出物相对火箭速度为 v_e。喷出后火箭质量变为 m-dm，速度变为 v+dv，喷出物相对地面速度为 v-v_e。</p><p><br></p><p>系统初动量：</p><p><br></p><p>$$p_1 = m v \\tag{1}$$</p><p><br></p><p>系统末动量：</p><p><br></p><p>$$p_2 = (m-dm)(v+dv) + dm(v-v_e) \\tag{2}$$</p><p><br></p><p>展开并忽略高阶小量：</p><p><br></p><p>$$p_2 = m v + m\\,dv - v_e\\,dm \\tag{3}$$</p><p><br></p><p>动量变化：</p><p><br></p><p>$$dp = p_2 - p_1 = m\\,dv - v_e\\,dm \\tag{4}$$</p><p><br></p><p>无外力时 dp=0，得：</p><p><br></p><p>$$m\\,dv = v_e\\,dm \\tag{5}$$</p><p><br></p><p>两边除以 dt：</p><p><br></p><p>$$m\\frac{dv}{dt} = v_e\\frac{dm}{dt} \\tag{6}$$</p><p><br></p><p>定义质量流量为：</p><p><br></p><p>$$\\dot m = \\frac{dm}{dt} \\tag{7}$$</p><p><br></p><p>则火箭获得的动量推力为：</p><p><br></p><p>$$F_{\\text{动量}} = \\dot m v_e \\tag{8}$$</p><p><br></p><p>喷管出口截面积为 A_e，出口压力为 p_e，环境压力为 p_0。出口截面上压力差为：</p><p><br></p><p>$$\\Delta p = p_e - p_0 \\tag{9}$$</p><p><br></p><p>该压力差产生的轴向压力推力为：</p><p><br></p><p>$$F_{\\text{压力}} = (p_e - p_0) A_e \\tag{10}$$</p><p><br></p><p>将动量推力与压力推力相加：</p><p><br></p><p>$$F = F_{\\text{动量}} + F_{\\text{压力}} \\tag{11}$$</p><p><br></p><p>代入式（8）和式（10）：</p><p><br></p><p>$$F = \\dot m v_e + (p_e - p_0) A_e \\tag{12}$$</p><p><br></p><p>定义有效排气速度：</p><p><br></p><p>$$c_{\\text{eff}} = v_e + \\frac{(p_e - p_0) A_e}{\\dot m} \\tag{13}$$</p><p><br></p><p>则推力可写为：</p><p><br></p><p>$$F = \\dot m c_{\\text{eff}} \\tag{14}$$</p><p><br></p><p>比冲定义为单位质量流量推进剂产生的推力：</p><p><br></p><p>$$I_{sp} = \\frac{F}{\\dot m g_0} = \\frac{c_{\\text{eff}}}{g_0} \\tag{15}$$</p><p><br></p><p>喷管出口压力与燃烧室压力 p_c 满足：</p><p><br></p><p>$$p_e = p_c \\left(1 + \\frac{\\gamma-1}{2} M_e^2\\right)^{-\\frac{\\gamma}{\\gamma-1}} \\tag{16}$$</p><p><br></p><p>喷管面积比与出口马赫数 M_e 的关系为：</p><p><br></p><p>$$\\frac{A_e}{A_t} = \\frac{1}{M_e} \\left[ \\frac{2}{\\gamma+1} \\left(1 + \\frac{\\gamma-1}{2} M_e^2 \\right) \\right]^{\\frac{\\gamma+1}{2(\\gamma-1)}} \\tag{17}$$</p><p><br></p><p>推力亦可写成：</p><p><br></p><p>$$F = C_F p_c A_t \\tag{18}$$</p><p><br></p><p>其中推力系数为：</p><p><br></p><p>$$C_F = \\frac{F}{p_c A_t} \\tag{19}$$</p><p><br></p><p>出处：</p><p><br></p><p>[1] Sutton, G. P., &amp; Biblarz, O. *Rocket Propulsion Elements*, 9th Edition. Wiley, 2017.</p><p><br></p><p>[2] Cantwell, B. J. "Generation of Thrust — Rocket Performance." AA103 Course Notes, Stanford University, 2021.</p><p><br></p><p>[3] MIT OpenCourseWare. "V. Rocket Performance." Unified Engineering, MIT.</p><p></p>`
  }
];

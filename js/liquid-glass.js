/* ============================================================================
   Liquid Glass — vanilla engine (no dependencies)
   Derived from rdev/liquid-glass-react (MIT) and shuding/liquid-glass (MIT):
   radial edge refraction via an SVG displacement map, chromatic aberration,
   masked blur, plus pointer-tracked specular and springy pointer response.

   Usage:
     <link rel="stylesheet" href="liquid-glass.css">
     <script type="module" src="liquid-glass.js"></script>
     <div class="liquid-glass" data-liquid-glass style="--lg-radius:24px">…</div>

   Optional attributes:
     data-lg-refraction="18"     peak edge displacement in px (auto when omitted)
     data-lg-aberration="1"      chromatic fringe amount, 0–3
     data-lg-elasticity="0.4"    pointer spring, 0–1
     data-lg-follow="200"        pointer-elastic zone in px (0 disables)
     data-lg-track="parent"      track pointer over the element's parent
     data-lg-interactive         pointer cursor + press state
     data-lg-ink="dark"          dark text for light backdrops
   ========================================================================= */
(function (global) {
  "use strict";

  var SVG = "http://www.w3.org/2000/svg";
  var uid = 0;
  var defsSvg = null;
  var instances = [];

  var canRefract = (function () {
    try {
      var ok = CSS.supports("filter", "url(#x)") &&
        (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)"));
      if (/firefox/i.test(navigator.userAgent)) ok = false;
      return ok;
    } catch (e) { return false; }
  })();

  function svgEl(name, attrs) {
    var node = document.createElementNS(SVG, name);
    for (var k in attrs) if (attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    return node;
  }

  function ensureDefs() {
    if (defsSvg && defsSvg.isConnected) return defsSvg;
    defsSvg = svgEl("svg", { "aria-hidden": "true", focusable: "false", class: "lg-defs" });
    defsSvg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    document.body.appendChild(defsSvg);
    return defsSvg;
  }

  function smoothstep(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

  /* Refraction map (mirrors the official rdev/liquid-glass-react pipeline).
     Official: radial edge-mask (B = 0 at center, 255 at rim) + negative
     feDisplacementMap scale. Negative scale pulls the sampled backdrop
     INWARD, so the rim magnifies the scene like Apple's Liquid Glass lens.

     We reproduce it on a rounded-rect SDF:
       - R,G encode the inward shift offset (0..255, 128 = no shift). With a
         negative scale these become a real inward pull toward the center.
       - B is the edge-intensity gate: 0 at the card core, ramping to 255 at
         the rim over a band, so the bend only reads near the edge.
       - A mirrors B for the compositing "in"/"over" steps.
     scale = 2*k, and k scales with the element short side so the lens
     magnitude tracks element size (the official uses a fixed 100 on a
     270px-wide card, ~37% of its width). */
  function buildMap(w, h, radius, peek) {
    var maxPx = 768;
    var s = Math.min(global.devicePixelRatio || 1, maxPx / Math.max(w, h));
    var cw = Math.max(4, Math.round(w * s));
    var ch = Math.max(4, Math.round(h * s));
    var canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext("2d");
    var img = ctx.createImageData(cw, ch);
    var data = img.data;

    var hw = cw / 2, hh = ch / 2;
    var r = Math.max(0, Math.min(radius * s, Math.min(hw, hh)));
    var ix = hw - r, iy = hh - r;

    // Inward peek: how far past the rim the lens reaches into the card.
    // Driven from the element short side so the bend reads proportionally.
    // Default auto-peek is intentionally aggressive so the whole scene warps
    // like the official "Prominent" mode: up to ~62% of the short side, or
    // an explicit data-lg-refraction when one is provided.
    // Maxed-out "hyper" distortion: up to ~85% of the short side so the
    // scene visibly tears at the rim. An explicit data-lg-refraction still
    // overrides the auto value.
    var k = Math.max(peek, Math.min(w, h) * 0.85) * s;

    // Band: how deep the edge-mask ramp extends from rim toward center.
    // Wide so the magnification swells across the surface (official look).
    // band no longer gates the offset (mask is radial); kept for reference.
    var band = Math.max(6, Math.min(cw, ch) * 0.42);

    for (var y = 0; y < ch; y++) {
      var py = y + 0.5 - hh;
      var apy = Math.abs(py);
      for (var x = 0; x < cw; x++) {
        var px = x + 0.5 - hw;
        var idx = (y * cw + x) * 4;

        // rounded-rect SDF (IQ): p = |pos| - half + r
        var qx = Math.abs(px) - ix;
        var qy = apy - iy;
        var sdf = Math.min(Math.max(qx, qy), 0) +
          Math.sqrt(Math.max(qx, 0) * Math.max(qx, 0) + Math.max(qy, 0) * Math.max(qy, 0)) - r;

        if (sdf > 0) {                       // outside the shape: no bend
          data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 0;
          continue;
        }

        // Distance from the card center (normalized by the half short side).
        // This is the "radial edge-mask" the official demo uses: 0 at the
        // center, 1 at the rim, so the whole interior is gated as "edge".
        var cx = px, cy = py;
        var dist = Math.sqrt(cx * cx + cy * cy);
        var norm = Math.max(Math.min(cw, ch) * 0.5, 1);   // ~half short side
        // Radial mask: 0 at center -> 1 at the shape's rim. Keep a gentle
        // ease (not squared) so the offset magnitude stays large enough to
        // read; the filter's negative scale turns this into a real lens.
        var m = Math.max(0, Math.min(1, dist / norm));
        m = 0.5 * (1 - Math.cos(Math.PI * m));             // smooth ease-in-out

        // Inward unit normal (points from surface toward center).
        var nx = 0, ny = 0;
        if (qx > 0 || qy > 0) {
          var dxn = (px < 0 ? 1 : -1) * Math.max(qx, 0);
          var dyn = (py < 0 ? 1 : -1) * Math.max(qy, 0);
          var len = Math.sqrt(dxn * dxn + dyn * dyn) || 1;
          nx = dxn / len; ny = dyn / len;
        }
        // In the flat-center region the dominant axis is the one whose |q|
        // is largest; fall back to pointing straight at the center so no
        // pixel carries zero offset (this was making the interior flat).
        if (nx === 0 && ny === 0) {
          var cl = Math.hypot(px, py) || 1;
          nx = -px / cl; ny = -py / cl;
        }

        // Shift sample point inward by k*mask; encoded in R,G (0..255).
        var off = k * m;
        data[idx]     = Math.round(Math.max(0, Math.min(255, 128 + nx * off)));
        data[idx + 1] = Math.round(Math.max(0, Math.min(255, 128 + ny * off)));
        // B/A = edge-intensity gate.
        data[idx + 2] = Math.round(m * 255);
        data[idx + 3] = Math.round(m * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return { href: canvas.toDataURL("image/png"), scale: 2 * k };
  }

  function buildFilter(id, href, scale, aberration) {
    var f = svgEl("filter", {
      id: id, x: "-25%", y: "-25%", width: "150%", height: "150%", "color-interpolation-filters": "sRGB"
    });
    var ab = Math.max(0, Math.min(3, aberration));

    f.appendChild(svgEl("feImage", {
      href: href, "preserveAspectRatio": "none", x: "0", y: "0", width: "100%", height: "100%", result: "MAP"
    }));
    f.appendChild(svgEl("feColorMatrix", {
      in: "MAP", type: "matrix",
      values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", result: "EDGE_MASK"
    }));
    // The official demo thresholds the edge-mask alpha so it snaps to full
    // across the whole card interior (a small clean core stays at 0). Without
    // this step the displaced backdrop gets erased by the "in" composite
    // and only a thin rim shows. Threshold to [0, .1, 1] like the original.
    f.appendChild(svgEl("feComponentTransfer", { in: "EDGE_MASK", result: "EDGE_MASK_T" }));
    f.lastChild.appendChild(svgEl("feFuncA", { type: "discrete", tableValues: "0 0.1 1" }));

    var S = scale;
    var channels = [
      ["R", -S, "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"],
      ["G", -S * (1 + ab * 0.05), "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"],
      ["B", -S * (1 + ab * 0.10), "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"]
    ];

    channels.forEach(function (c) {
      var out = c[0] + "_DISPLACED", iso = c[0] + "_CHANNEL";
      f.appendChild(svgEl("feDisplacementMap", {
        in: "SourceGraphic", in2: "MAP", scale: c[1],
        xChannelSelector: "R", yChannelSelector: "G", result: out
      }));
      f.appendChild(svgEl("feColorMatrix", { in: out, type: "matrix", values: c[2], result: iso }));
    });

    f.appendChild(svgEl("feBlend", { in: "G_CHANNEL", in2: "B_CHANNEL", mode: "screen", result: "GB" }));
    f.appendChild(svgEl("feBlend", { in: "R_CHANNEL", in2: "GB", mode: "screen", result: "RGB" }));
    f.appendChild(svgEl("feGaussianBlur", { in: "RGB", stdDeviation: 0.3, result: "RGB_SOFT" }));
    f.appendChild(svgEl("feComposite", { in: "RGB_SOFT", in2: "EDGE_MASK_T", operator: "in", result: "EDGE" }));

    // Clean core: invert the thresholded mask (alpha -> 0 where the edge
    // applies, 1 in the flat center) and keep the original, un-displaced
    // backdrop there so the very middle stays crisp.
    f.appendChild(svgEl("feComponentTransfer", { in: "EDGE_MASK_T", result: "CORE_MASK" }));
    f.lastChild.appendChild(svgEl("feFuncA", { type: "table", tableValues: "0 1" }));
    f.appendChild(svgEl("feComposite", { in: "SourceGraphic", in2: "CORE_MASK", operator: "in", result: "CORE" }));
    f.appendChild(svgEl("feComposite", { in: "EDGE", in2: "CORE", operator: "over" }));
    return f;
  }

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  function mount(el, options) {
    if (!el || el.__lg) return el && el.__lg;
    options = options || {};

    var content = document.createElement("div");
    content.className = "lg-content";
    while (el.firstChild) content.appendChild(el.firstChild);

    var lens = document.createElement("span");
    lens.className = "lg-lens";
    lens.setAttribute("aria-hidden", "true");
    el.appendChild(lens);

    ["lg-tint", "lg-sheen", "lg-rim"].forEach(function (cls) {
      var s = document.createElement("span");
      s.className = cls;
      s.setAttribute("aria-hidden", "true");
      el.appendChild(s);
    });
    el.insertBefore(content, el.firstChild);

    var inst = {
      el: el, lens: lens, content: content, filterId: "lg-f" + (++uid), built: false,
      refraction: options.refraction != null ? options.refraction : num(el.dataset.lgRefraction, null),
      aberration: options.aberration != null ? options.aberration : num(el.dataset.lgAberration, 1),
      elasticity: options.elasticity != null ? options.elasticity : num(el.dataset.lgElasticity, 0.35),
      follow: options.follow != null ? options.follow : num(el.dataset.lgFollow, 200),
      track: options.track || el.dataset.lgTrack || "self",
      detach: []
    };
    el.__lg = inst;

    function paint() {
      var w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      var radius = options.radius != null ? options.radius : parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      var peek = inst.refraction != null && inst.refraction > 0
        ? inst.refraction
        : Math.max(10, Math.min(Math.min(w, h) * 0.45, 44));
      var map = buildMap(w, h, radius, peek);
      var next = buildFilter(inst.filterId, map.href, map.scale, inst.aberration);
      var old = document.getElementById(inst.filterId);
      if (old) old.replaceWith(next); else ensureDefs().appendChild(next);
      if (!inst.built) {
        el.style.setProperty("--lg-filter", "url(#" + inst.filterId + ")");
        inst.built = true;
      }
      inst.map = map;
    }

    if (canRefract) paint(); else lens.style.display = "";

    var ro = null;
    if (global.ResizeObserver) {
      var last = "";
      var pending = false;
      ro = new ResizeObserver(function () {
        var key = el.clientWidth + "x" + el.clientHeight;
        if (key === last || pending) return;
        last = key;
        pending = true;
        requestAnimationFrame(function () { pending = false; if (canRefract) paint(); });
      });
      ro.observe(el);
    }

    /* pointer: specular position + liquid elastic follow.
       Port of rdev/liquid-glass-react: when the pointer enters the activation
       zone around an element, the element translates toward it and stretches
       along the approach direction, then springs back on leave. The sheen
       position is always tracked on the tracking element. */
    var trackEl = null;
    function setTrack() {
      trackEl = inst.track === "parent" && el.parentElement ? el.parentElement : el;
    }
    setTrack();

    function onMove(e) {
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var px = (e.clientX - r.left) / r.width;
      var py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--lg-px", (px * 100).toFixed(1) + "%");
      el.style.setProperty("--lg-py", (py * 100).toFixed(1) + "%");
      applyElastic(e.clientX, e.clientY);
    }

    // Sheen-only update; used when another listener on the same parent
    // already drives the elastic follow for this element.
    function onSheen(e) {
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      el.style.setProperty("--lg-px", (((e.clientX - r.left) / r.width) * 100).toFixed(1) + "%");
      el.style.setProperty("--lg-py", (((e.clientY - r.top) / r.height) * 100).toFixed(1) + "%");
    }

    // Distance from pointer to the nearest edge, clamped at 0 on the shape.
    function edgeDistance(mx, my, r) {
      var dx = Math.abs(mx - (r.left + r.width / 2)) - r.width / 2;
      var dy = Math.abs(my - (r.top + r.height / 2)) - r.height / 2;
      var ex = Math.max(0, dx);
      var ey = Math.max(0, dy);
      return Math.sqrt(ex * ex + ey * ey);
    }

    function applyElastic(mx, my) {
      if (options.movable === false) return;
      var zone = inst.follow;
      if (!zone || zone <= 0) return;
      if (el.hasAttribute("data-lg-interactive") === false && inst.track === "parent") return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var edge = edgeDistance(mx, my, r);
      var fadeIn = edge > zone ? 0 : 1 - edge / zone;
      var dx = mx - cx, dy = my - cy;
      var dist = Math.hypot(dx, dy);
      if (fadeIn <= 0 || dist === 0) {
        el.style.setProperty("--lg-ex", "0px");
        el.style.setProperty("--lg-ey", "0px");
        el.style.setProperty("--lg-scale", "1");
        el.style.setProperty("--lg-sx", "1");
        el.style.setProperty("--lg-sy", "1");
        return;
      }
      var stretch = Math.min(dist / 300, 1) * inst.elasticity * fadeIn;
      var nx = dx / dist, ny = dy / dist;
      // Keep the follow subtle (Apple's default feels light, not wobbly).
      // Translate toward the pointer is ~1% of the offset; stretch is gentle.
      var sx = 1 + Math.abs(nx) * stretch * 0.12 - Math.abs(ny) * stretch * 0.06;
      var sy = 1 + Math.abs(ny) * stretch * 0.12 - Math.abs(nx) * stretch * 0.06;
      var cl = Math.max(0.94, Math.min(1.06, sx));
      var cy2 = Math.max(0.94, Math.min(1.06, sy));
      el.style.setProperty("--lg-ex", (dx * inst.elasticity * 0.04 * fadeIn).toFixed(2) + "px");
      el.style.setProperty("--lg-ey", (dy * inst.elasticity * 0.04 * fadeIn).toFixed(2) + "px");
      el.style.setProperty("--lg-sx", cl.toFixed(4));
      el.style.setProperty("--lg-sy", cy2.toFixed(4));
      el.style.setProperty("--lg-scale", "1");
    }

    function resetElastic() {
      el.style.setProperty("--lg-ex", "0px");
      el.style.setProperty("--lg-ey", "0px");
      el.style.setProperty("--lg-scale", "1");
      el.style.setProperty("--lg-sx", "1");
      el.style.setProperty("--lg-sy", "1");
    }

    function onDown() {
      if (el.hasAttribute("data-lg-interactive")) el.classList.add("lg-pressing");
    }
    function onUp() {
      el.classList.remove("lg-pressing");
    }
    function onLeave(e) {
      resetElastic();
      el.style.setProperty("--lg-px", "30%");
      el.style.setProperty("--lg-py", "0%");
    }

    var mm = global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!mm || !mm.matches) {
      var bound = [];
      trackEl.addEventListener("pointermove", onMove, { passive: true });
      trackEl.addEventListener("pointerleave", onLeave, { passive: true });
      // When the parent drives the elastic follow, keep the sheen tracking
      // on the element itself so moving over it also moves the highlight.
      if (inst.track === "parent") {
        el.addEventListener("pointermove", onSheen, { passive: true });
        bound.push(function () { el.removeEventListener("pointermove", onSheen); });
      }
      bound.push(
        function () { trackEl.removeEventListener("pointermove", onMove); },
        function () { trackEl.removeEventListener("pointerleave", onLeave); }
      );
      el.addEventListener("pointerdown", onDown, { passive: true });
      el.addEventListener("pointerup", onUp, { passive: true });
      el.addEventListener("pointercancel", onUp, { passive: true });
      bound.push(
        function () { el.removeEventListener("pointerdown", onDown); },
        function () { el.removeEventListener("pointerup", onUp); },
        function () { el.removeEventListener("pointercancel", onUp); }
      );
      inst.detach = bound;
    }

    instances.push(inst);
    return inst;
  }

  function mountAll(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll(".liquid-glass[data-liquid-glass]");
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  function unmount(el) {
    var inst = el && el.__lg;
    if (!inst) return;
    inst.detach.forEach(function (fn) { fn(); });
    var f = document.getElementById(inst.filterId);
    if (f) f.remove();
    el.__lg = null;
    instances = instances.filter(function (i) { return i !== inst; });
  }

  global.LiquidGlass = { mount: mount, mountAll: mountAll, unmount: unmount, supportsRefraction: canRefract };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { mountAll(); });
  } else {
    mountAll();
  }
})(window);

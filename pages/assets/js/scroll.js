/* ============================================================
   scroll.js — 滚动驱动：元素渐入 / 视差 / 数字滚动
   性能策略：
   - 单个 rAF 循环统一处理，绝不在 scroll 回调里读写布局
   - IntersectionObserver 只负责「进入视口」的一次性状态
   - 视差写入 CSS 自定义属性，由合成器消费，只触发 transform
   ============================================================ */
(function () {
  'use strict';

  var raf = null;
  var pending = false;
  var scrollY = window.scrollY;

  /* ─── 视差目标缓存（避免每帧 querySelector） ─── */
  var parallaxItems = [];
  function collectParallax() {
    parallaxItems = Array.prototype.map.call(
      document.querySelectorAll('[data-parallax]'),
      function (el) {
        return {
          el: el,
          speed: parseFloat(el.getAttribute('data-parallax')) || 0.12,
          // 缓存元素在文档中的位置，滚动时不再读布局
          top: 0, height: 0, computed: false
        };
      }
    );
  }

  function measure() {
    var vh = window.innerHeight;
    parallaxItems.forEach(function (it) {
      if (!it.computed) {
        var r = it.el.getBoundingClientRect();
        it.top = r.top + window.scrollY;
        it.height = r.height;
        it.computed = true;
      }
    });
    return vh;
  }

  function tick() {
    raf = null;
    var vh = measure();
    // 元素中心相对视口中心的偏移量 → 视差位移
    parallaxItems.forEach(function (it) {
      var center = it.top + it.height / 2;
      var delta = (scrollY + vh / 2) - center;
      var y = (delta * it.speed).toFixed(2);
      it.el.style.setProperty('--parallax', y + 'px');
    });
  }

  function onScroll(y) {
    scrollY = y;
    if (raf) return;
    raf = requestAnimationFrame(tick);
  }

  /* ─── 渐入：进入视口加 .is-in，随后停止观察 ─── */
  function setupReveal() {
    var targets = document.querySelectorAll('[data-reveal], [data-reveal-group], [data-lines]');
    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (t) { t.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    targets.forEach(function (t) {
      // 兄弟错峰索引
      if (t.hasAttribute('data-reveal-group')) {
        Array.prototype.forEach.call(t.children, function (c, i) {
          c.style.setProperty('--i', i);
        });
      }
      io.observe(t);
    });
  }

  /* ─── 数字滚动：首次进入视口时从 0 计到目标 ─── */
  function setupCounters() {
    var nums = document.querySelectorAll('[data-count]');
    if (!nums.length) return;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function run(el) {
      var target = parseFloat(el.getAttribute('data-count')) || 0;
      var decimals = parseInt(el.getAttribute('data-count-decimals') || '0', 10);
      if (reduce) { el.textContent = target.toFixed(decimals); return; }
      var dur = parseInt(el.getAttribute('data-count-duration') || '1400', 10);
      var t0 = performance.now();
      (function step(now) {
        var p = Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 4);            // expo-out
        el.textContent = (target * eased).toFixed(decimals);
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    }

    if (!('IntersectionObserver' in window)) { nums.forEach(run); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        run(en.target);
        io.unobserve(en.target);
      });
    }, { threshold: 0.4 });
    nums.forEach(function (n) { io.observe(n); });
  }

  /* ─── 视差缓存失效：尺寸变化 / 图片加载后重新定位 ─── */
  var resizeTimer = null;
  function invalidate() {
    parallaxItems.forEach(function (it) { it.computed = false; });
    if (raf) return;
    raf = requestAnimationFrame(tick);
  }
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(invalidate, 150);
  });
  window.addEventListener('load', invalidate);

/* ─── 导出 ─── */
  window.JutianScroll = {
    init: function (opts) {
      opts = opts || {};
      collectParallax();
      setupReveal();
      setupCounters();
      if (opts.onScroll) {
        var passive = { passive: true };
        window.addEventListener('scroll', function () {
          opts.onScroll(window.scrollY);
          onScroll(window.scrollY);
        }, passive);
        opts.onScroll(window.scrollY);
        onScroll(window.scrollY);
      } else {
        window.addEventListener('scroll', function () { onScroll(window.scrollY); }, { passive: true });
      }
    }
  };
})();

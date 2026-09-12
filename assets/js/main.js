/* ============================================================
   巨天 Agent · 官网交互脚本
   ============================================================ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ===================== 思考程度演示 ===================== */
  var LEVELS = [
    { name: '关闭', desc: '直接回答，零等待。闲聊、简单查询的最佳选择。' },
    { name: '低',   desc: '稍作斟酌再开口，快与准之间的平衡点。' },
    { name: '中',   desc: '适度思考后作答——日常任务的默认档位。' },
    { name: '高',   desc: '深入推理，代码架构、方案设计这类问题值得。' },
    { name: '最大', desc: '竭尽全力想透彻，复杂问题的压舱底。' }
  ];

  var slider = document.getElementById('tpSlider');
  var tpLevel = document.getElementById('tpLevel');
  var tpDesc = document.getElementById('tpDesc');
  var scaleMarks = document.querySelectorAll('.tp-scale span');
  var listItems = document.querySelectorAll('.think-list li');

  function setLevel(i) {
    var lv = LEVELS[i];
    if (tpLevel) tpLevel.textContent = lv.name;
    if (tpDesc) {
      tpDesc.textContent = lv.desc;
      tpDesc.style.color = 'var(--a1)';
      setTimeout(function () { if (tpDesc) tpDesc.style.color = ''; }, 350);
    }
    scaleMarks.forEach(function (s, k) { s.classList.toggle('on', k === i); });
    listItems.forEach(function (li, k) { li.classList.toggle('on', k === i); });
  }

  if (slider) {
    slider.addEventListener('input', function () { setLevel(parseInt(slider.value, 10)); });
    listItems.forEach(function (li, k) {
      li.style.cursor = 'pointer';
      li.addEventListener('click', function () {
        slider.value = String(k);
        setLevel(k);
      });
    });
    setLevel(2);
  }

  /* ===================== 主题切换 ===================== */
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('jta-theme'); } catch (err) { saved = null; }
  if (saved) root.dataset.theme = saved;

  var toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('jta-theme', next); } catch (err) {}
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'dark' ? '#08060f' : '#f8f7fc');
    });
  }

  /* ===================== 移动端菜单 ===================== */
  var burger = document.getElementById('burger');
  var navLinks = document.getElementById('navLinks');
  if (burger && navLinks) {
    burger.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      burger.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', String(open));
    });
    navLinks.addEventListener('click', function (e) {
      if (e.target.tagName === 'A' || e.target.tagName === 'I') {
        navLinks.classList.remove('open');
        burger.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ===================== 导航 / 进度条 ===================== */
  var nav = document.getElementById('nav');
  var bar = document.querySelector('#progress span');
  var sections = [].slice.call(document.querySelectorAll('main section[id]'));
  var links = [].slice.call(document.querySelectorAll('.nav-links a'));

  function onScroll() {
    var y = window.scrollY;
    if (nav) nav.classList.toggle('scrolled', y > 24);
    if (bar) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
    }
    var pos = y + 140;
    var current = sections.length ? sections[0].id : '';
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].offsetTop <= pos) current = sections[i].id;
    }
    links.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ===================== 滚动显现 ===================== */
  var revealed = [].slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    revealed.forEach(function (el) { io.observe(el); });
  } else {
    revealed.forEach(function (el) { el.classList.add('in'); });
  }

  /* ===================== 数字滚动 ===================== */
  function runCounter(el) {
    var n = parseFloat(el.dataset.count) || 0;
    var suffix = el.dataset.suffix || '';
    if (reduced) { el.textContent = n + suffix; return; }
    var dur = 1400, t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      el.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var counters = [].slice.call(document.querySelectorAll('[data-count]'));
  if ('IntersectionObserver' in window) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { runCounter(en.target); co.unobserve(en.target); }
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { co.observe(el); });
  } else {
    counters.forEach(runCounter);
  }

  /* ===================== 磁吸 / 光标光晕 ===================== */
  var glow = document.getElementById('cursorGlow');
  if (window.matchMedia('(pointer: fine)').matches && !reduced) {
    window.addEventListener('mousemove', function (e) {
      if (glow) {
        glow.classList.add('on');
        glow.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
      }
    }, { passive: true });

    document.querySelectorAll('.magnetic').forEach(function (el) {
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
        var y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
        el.style.transform = 'translate(' + (x * 5).toFixed(2) + 'px,' + (y * 3.5).toFixed(2) + 'px) translateY(-2px)';
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    });
  }

  /* ===================== 年份 ===================== */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  /* ===================== 背景粒子 ===================== */
  var canvas = document.getElementById('net');
  if (canvas && !reduced) {
    var ctx = canvas.getContext('2d');
    var dots = [], w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var count = Math.min(70, Math.round((w * h) / 22000));
      dots = [];
      for (var i = 0; i < count; i++) {
        dots.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2,
          r: Math.random() * 1.4 + 0.6
        });
      }
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      var light = root.dataset.theme === 'light';
      var dotC = light ? 'rgba(60,30,120,.26)' : 'rgba(190,165,255,.5)';
      var lineC = light ? 'rgba(60,30,120,' : 'rgba(170,140,255,';
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0 || d.x > w) d.vx *= -1;
        if (d.y < 0 || d.y > h) d.vy *= -1;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = dotC; ctx.fill();
        for (var j = i + 1; j < dots.length; j++) {
          var o = dots[j];
          var dx = d.x - o.x, dy = d.y - o.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 138) {
            ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(o.x, o.y);
            ctx.strokeStyle = lineC + (0.15 * (1 - dist / 138)).toFixed(3) + ')';
            ctx.lineWidth = 1; ctx.stroke();
          }
        }
      }
      requestAnimationFrame(frame);
    }
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
  }
})();

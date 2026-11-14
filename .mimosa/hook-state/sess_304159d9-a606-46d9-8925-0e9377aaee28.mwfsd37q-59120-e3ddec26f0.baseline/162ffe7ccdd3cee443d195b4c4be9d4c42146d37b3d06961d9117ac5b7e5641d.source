/* ============================================================
   app.js — 站点入口：导航行为、主题、页面转场、抽屉
   依赖：scroll.js（provideScroll）、interactions.js（provideInteractions）
   ============================================================ */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ─── 主题：localStorage 记忆，默认跟随系统 ─── */
  var THEME_KEY = 'jutian-site-theme';
  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    var btn = doc.querySelector('[data-theme-toggle]');
    if (btn) {
      btn.setAttribute('aria-label', t === 'dark' ? '切换到浅色' : '切换到深色');
      btn.querySelector('.icon-sun').style.display = t === 'dark' ? 'block' : 'none';
      btn.querySelector('.icon-moon').style.display = t === 'dark' ? 'none' : 'block';
    }
  }
  var saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(saved || systemTheme());
  doc.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-theme-toggle]');
    if (!btn) return;
    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  /* ─── 导航：下滚隐藏 / 上滚归位 / 滚动进度 / 移动抽屉 ─── */
  var nav = doc.querySelector('.nav');
  var lastY = window.scrollY;
  var navHidden = false;

  function onNavScroll(y) {
    if (!nav) return;
    // 顶部 8px 内始终显示；向下滚动超过 120px 才隐藏，避免误触
    if (y > lastY && y > 120 && !navHidden) {
      nav.classList.add('is-hidden'); navHidden = true;
      closeDrawer();
    } else if (y < lastY && navHidden) {
      nav.classList.remove('is-hidden'); navHidden = false;
    }
    lastY = y;
    // 进度线
    var h = doc.documentElement.scrollHeight - window.innerHeight;
    var p = h > 0 ? Math.min(1, y / h) : 0;
    nav.style.setProperty('--progress', p.toFixed(4));
  }

  var burger = doc.querySelector('[data-burger]');
  var links = doc.querySelector('.nav__links');
  function closeDrawer() { if (links) links.classList.remove('is-open'); }
  if (burger) {
    burger.addEventListener('click', function () {
      if (links) links.classList.toggle('is-open');
    });
  }
  // 点击导航链接后收起抽屉
  if (links) {
    links.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeDrawer();
    });
  }

  /* ─── 当前页高亮 ─── */
  (function markCurrent() {
    var here = location.pathname.split('/').pop() || 'index.html';
    doc.querySelectorAll('.nav__link').forEach(function (a) {
      var href = a.getAttribute('href');
      if (href === here || (here === '' && href === 'index.html')) a.setAttribute('aria-current', 'page');
    });
  })();

  /* ─── 页面转场：内部链接点击 → 幕布上滑 → 新页淡入 ─── */
  var veil = doc.querySelector('.transition-veil');
  function isInternal(a) {
    var href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || a.target === '_blank') return false;
    return new URL(href, location.href).origin === location.origin;
  }
  doc.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a || !isInternal(a) || e.metaKey || e.ctrlKey || !veil || reduceMotion) return;
    var url = new URL(a.href, location.href);
    if (url.pathname === location.pathname && url.hash) return;   // 同页锚点走原生平滑滚动
    e.preventDefault();
    doc.body.classList.add('is-leaving');
    veil.classList.add('is-active');
    setTimeout(function () {
      veil.classList.add('is-leaving');
      window.location.href = a.href;
    }, 300);
  });
  // 从转场进入时：内容淡入
  if (!reduceMotion && sessionStorage.getItem('jt-page-transition') === '1') {
    sessionStorage.removeItem('jt-page-transition');
    doc.body.classList.add('page-enter');
  } else {
    doc.body.classList.add('page-enter');
  }
  // 记录「本次是转场进入」，供下一页判断
  window.addEventListener('pagehide', function () {
    if (!reduceMotion) sessionStorage.setItem('jt-page-transition', '1');
  });

  /* ─── 挂钩子：交给滚动与交互模块 ─── */
  if (window.JutianScroll) window.JutianScroll.init({ onScroll: onNavScroll, reduceMotion: reduceMotion });
  if (window.JutianInteractions) window.JutianInteractions.init({ reduceMotion: reduceMotion });

  // 脚本加载晚于 DOM 就绪时的兜底
  doc.documentElement.classList.add('js-ready');
})();

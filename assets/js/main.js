(function () {
  'use strict';

  var root = document.documentElement;
  var key = 'jta-paper-theme';

  var saved = null;
  try { saved = localStorage.getItem(key); } catch (e) { saved = null; }
  if (saved) root.dataset.theme = saved;

  var btn = document.getElementById('themeBtn');
  if (btn) {
    btn.addEventListener('click', function () {
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem(key, next); } catch (e) {}
    });
  }

  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');
  if (burger && nav) {
    burger.addEventListener('click', function () { nav.classList.toggle('open'); });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') nav.classList.remove('open');
    });
  }

/* 思考程度切换 */
  var LEVELS = [
    ['关闭', '不经过额外推理，拿到问题直接作答。适合闲聊、简单查询、格式转换这类不值得等待的任务。'],
    ['低', '少量斟酌后再回答，速度与质量之间的平衡点。日常问答、短代码修改可以用这一档。'],
    ['中', '适度思考后作答，是默认档位。会先梳理任务结构再动手，适合大多数真实工作。'],
    ['高', '深入推理。写代码架构、设计技术方案、排查疑难 Bug 时值得多花这几秒。'],
    ['最大', '竭尽全力想透彻。用于复杂重构、长链条任务，代价是明显的等待时间。']
  ];
  var bar = document.getElementById('thinkBar');
  var desc = document.getElementById('thinkDesc');
  if (bar && desc) {
    var btns = [].slice.call(bar.querySelectorAll('button'));
    function setLv(i) {
      btns.forEach(function (b, k) { b.classList.toggle('on', k === i); });
      desc.innerHTML = '<b>' + LEVELS[i][0] + '：</b>' + LEVELS[i][1];
    }
    btns.forEach(function (b, k) { b.addEventListener('click', function () { setLv(k); }); });
    setLv(2);
  }

  var links = [].slice.call(document.querySelectorAll('.nav a[href^="#"]'));
  var sections = links.map(function (a) { return document.querySelector(a.getAttribute('href')); });

  function onScroll() {
    var pos = window.scrollY + 120;
    var current = -1;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i] && sections[i].offsetTop <= pos) current = i;
    }
    links.forEach(function (a, i) { a.classList.toggle('on', i === current); });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

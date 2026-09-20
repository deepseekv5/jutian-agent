(function () {
  'use strict';

  /* ===================== 风格切换（正常 / 猫娘 / 搞笑） ===================== */
  var MODES = {
    neko: {
      title: '巨天 Agent 喵', subtitle: '会真的帮你把活干完的那种喵',
      lede1: '住在你电脑里的智能体喵。会开终端、改文件、写代码、做 PPT，还能听你说话再回答喵。不是普通的聊天框哦，它是真的会动手的那种喵。',
      lede2: '现在还在预览阶段，正在慢慢打磨喵。这一页写了它现在能做什么、还不能做什么喵。',
      aside1: '常见的助手只会告诉你该怎么做喵；咱想做的是替你把它做完喵。',
      aside2: '还没发布喵，不过你可以先在下面点几下，看看思考档位是啥喵。',
      pull: '「要不要多想一会儿，交给客人决定喵。」', cite: '—— 五档思考程度的设计想法',
      s1: '这是啥喵', s2: '会做的事情', s3: '长什么样', s4: '要想多久喵', s5: '里面的构造',
      s6: '能用在哪些地方', s7: '接下来做啥', s8: '常见问题喵', s9: '怎么拿到喵',
      n1: '先把边界说清楚喵：能做什么，还有咱不让它做什么。',
      n2: '六样本事，每一样写到哪一步都写清楚喵。',
      n3: '现在预览版的样子，没有修图喵。',
      n4: '五档可以调喵。要多想还是快答，客人说了算喵。',
      n5: '现在这个版本里面装了什么喵。',
      n6: '咱自己常用的几个例子，比功能列表好懂喵。',
      n7: '做完的、正在做的、打算做的。没有时间表喵。',
      n8: '预览阶段最常被问到的几个喵。',
      u1: '把乱糟糟的下载目录整理好喵', u2: '从零搭一个项目骨架喵', u3: '给明天的课做演示文稿喵',
      q1: '现在可以下载吗喵？', q2: '它会偷偷改咱的文件吗喵？', q3: '会开源吗喵？',
      contact1: '现在还不能下载喵。发布的时候会同时有 Mac 和 Windows 版，会在官网和 GitHub 通知喵。',
      foot: '实际功能以发布版本为准喵'
    },
    funny: {
      title: '巨天 Agent（还没发布版）', subtitle: '理论上它会干活，实际上还在调试',
      lede1: '一个装在你电脑里的智能体。它会开终端、改文件、写代码、做 PPT——当然，偶尔也会自信地做错。',
      lede2: '目前是预览版，意思是它确实存在，但还不建议你把作业交给它。',
      aside1: '普通助手告诉你怎么做，我们想让它替你做完。风险是：它做错了也是替你做错的。',
      aside2: '没发布也能玩：下面那个档位切换，点着玩不要钱。',
      pull: '「它想多久，你说了算。想太久就是你的问题了。」', cite: '—— 写在设计文档第一页的话',
      s1: '这玩意是什么', s2: '能力清单（按靠谱程度排序）', s3: '界面（截图是真的）',
      s4: '思考程度（想多久你定）', s5: '技术规格（数字会变）', s6: '使用场景（理论上）',
      s7: '路线图（没有日期）', s8: '常见问题', s9: '怎么拿到（目前拿不到）',
      n1: '先把话说清楚：它能干什么，以及我们不敢让它干什么。',
      n2: '六项能力，每项都写明了「到此为止」。',
      n3: '真实界面，没有美化——美化会让它看起来更能干。',
      n4: '五档可调。选「最大」之前请先看看你的待办清单。',
      n5: '当前版本的实际构成，会变。',
      n6: '几个真实用例，比功能列表诚实。',
      n7: '做完的、在做的、想做的。没有日期，理由是给不出。',
      n8: '预览阶段被问最多的几个问题。',
      u1: '整理那个你已经不敢打开的下载目录', u2: '从零搭一个项目（然后自己再改一遍）', u3: '给明天的课做 PPT（救命用）',
      q1: '现在能下载吗？（不能）', q2: '它会背着我改文件吗？', q3: '会开源吗？（暂时不）',
      contact1: '现在下载不了。发布时会有 Mac 和 Windows 两个版本，通知会发在官网和 GitHub。',
      foot: '页面写的和实际发布的可能有出入'
    },
    terminal: {
      title: 'agent@local:~$', subtitle: 'status: preview · build: 4.0.0',
      lede1: '# 它会开终端、改文件、写代码、做 PPT。',
      lede2: '# 当前状态：未开放下载。',
      pull: '// 想多久，由调用方决定。', cite: 'config: thinking_level',
      foot: '-- waiting for release --'
    },
    paper: {
      title: '巨天 Agent', subtitle: '桌面智能体 · 预览版报道',
      lede1: '据悉，一款可操作终端与本地文件的桌面智能体正在封闭打磨，尚未开放下载。',
      lede2: '该产品提供五档思考程度，供使用者在响应速度与推理深度之间取舍。',
      pull: '「把控制权留给用户，包括决定它该想多久。」', cite: '—— 开发方说明',
      foot: '本版为预览报道 · 以实际发布为准'
    },
    blueprint: {
      title: '巨天 Agent', subtitle: 'UNIT SPEC / REV. 4.0.0-PREVIEW',
      lede1: '设备类型：桌面 AI 智能体。安装位置：本机。',
      lede2: '接口：终端、文件系统、代码编辑器、PPT 生成器、语音链路。',
      pull: '控制项：思考档位 ×5。默认：中。', cite: 'DWG NO. JTA-4.0',
      foot: 'DRAFT · 未发布'
    },
    note: {
      title: '巨天 Agent', subtitle: '还在做的一个东西',
      lede1: '想做一个真正会干活的智能体，不是只会说话的那种。',
      lede2: '现在还在打磨，等能拿得出手了再发。',
      pull: '想多久，让你来定。', cite: '—— 记在草稿本上',
      foot: '待续'
    },
    pixel: {
      title: 'JUTIAN AGENT', subtitle: 'STAGE 1 — LOADING',
      lede1: '装备：终端 / 文件 / 代码 / PPT / 语音。',
      lede2: '当前状态：预览版。BOSS：稳定性。',
      pull: 'THINK LEVEL: 1 2 3 4 5', cite: 'CREDITS: 001',
      foot: 'COMING SOON'
    }
  };

  var MODE_KEY = 'jta-mode';
  var vEls = [].slice.call(document.querySelectorAll('[data-v]'));
  vEls.forEach(function (el) { el.setAttribute('data-orig', el.textContent); });

  function applyMode(m) {
    if (!m || m === 'normal') m = 'normal';
    document.documentElement.dataset.mode = m;
    vEls.forEach(function (el) {
      var k = el.getAttribute('data-v');
      var pack = MODES[m] || {};
      el.textContent = pack[k] || el.getAttribute('data-orig');
    });
    var sel = document.getElementById('modeSelect');
    if (sel) sel.value = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    if (window.__onMode) window.__onMode(m);
  }

  var selBox = document.getElementById('modeSelect');
  if (selBox) selBox.addEventListener('change', function () { applyMode(selBox.value); });
  var savedMode = null;
  try { savedMode = localStorage.getItem(MODE_KEY); } catch (e) {}
  if (savedMode && MODES[savedMode]) applyMode(savedMode);

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
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'dark' ? '#1b1916' : '#f7f4ee');
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
  var LEVELS_NORMAL = [
    ['关闭', '不经过额外推理，拿到问题直接作答。适合闲聊、简单查询、格式转换这类不值得等待的任务。'],
    ['低', '少量斟酌后再回答，速度与质量之间的平衡点。日常问答、短代码修改可以用这一档。'],
    ['中', '适度思考后作答，是默认档位。会先梳理任务结构再动手，适合大多数真实工作。'],
    ['高', '深入推理。写代码架构、设计技术方案、排查疑难 Bug 时值得多花这几秒。'],
    ['最大', '竭尽全力想透彻。用于复杂重构、长链条任务，代价是明显的等待时间。']
  ];
  var LEVELS_NEKO = [
    ['关闭', '不怎么想就直接回答喵。适合随口问问、查个小东西。'],
    ['低', '稍微想一下再回答喵。日常用这个就够啦。'],
    ['中', '好好想一下再回答喵。这是默认档，大多数时候用它。'],
    ['高', '想得比较深喵。写代码结构、设计方案的时候用它。'],
    ['最大', '尽全力想清楚喵。任务越难越合适，就是要等一会儿。']
  ];
  var LEVELS_FUNNY = [
    ['关闭', '不思考，直接答。适合问它今天星期几。'],
    ['低', '稍微想一下。性价比最高的一档。'],
    ['中', '适度思考。默认档，就像默认咖啡因含量。'],
    ['高', '深思熟虑。适合架构设计，以及「为什么又报错了」这类问题。'],
    ['最大', '竭尽全力。适合复杂重构，也适合你想去泡杯茶的时候。']
  ];
  var LEVELS = LEVELS_NORMAL;
  var bar = document.getElementById('thinkBar');
  var desc = document.getElementById('thinkDesc');
  if (bar && desc) {
    var btns = [].slice.call(bar.querySelectorAll('button'));
    function setLv(i) {
      btns.forEach(function (b, k) { b.classList.toggle('on', k === i); });
      desc.innerHTML = '<b>' + LEVELS[i][0] + '：</b>' + LEVELS[i][1];
    }
    var curLv = 2;
    btns.forEach(function (b, k) { b.addEventListener('click', function () { curLv = k; setLv(k); }); });
    setLv(curLv);
    window.__onMode = function (m) {
      LEVELS = m === 'neko' ? LEVELS_NEKO : (m === 'funny' ? LEVELS_FUNNY : LEVELS_NORMAL);
      setLv(curLv);
    };
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

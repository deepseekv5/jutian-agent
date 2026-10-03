/* ============================================================
   interactions.js — 微交互：磁性按钮 / 3D 倾斜 / 表单校验
   原则：所有反馈只改 transform 与 opacity；鼠标事件用 rAF 节流；
        触屏设备一律降级为静态。
   ============================================================ */


window.JutianInteractions = (function () {
  'use strict';
  return {
    init: function () {
      var fine = window.matchMedia('(pointer: fine)').matches;

      /* ─── 磁性按钮 ─── */
      function setupMagnetic() {
        if (!fine) return;
        document.querySelectorAll('[data-magnetic]').forEach(function (el) {
          var strength = parseFloat(el.getAttribute('data-magnetic')) || 0.28;
          var raf = null, tx = 0, ty = 0;
          function apply() { raf = null; el.style.transform = 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0)'; }
          el.addEventListener('mousemove', function (e) {
            var r = el.getBoundingClientRect();
            tx = (e.clientX - (r.left + r.width / 2)) * strength;
            ty = (e.clientY - (r.top + r.height / 2)) * strength;
            if (!raf) raf = requestAnimationFrame(apply);
          });
          el.addEventListener('mouseleave', function () {
            tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(apply);
          });
        });
      }

      /* ─── 3D 倾斜卡 ─── */
      function setupTilt() {
        if (!fine) return;
        document.querySelectorAll('.tilt').forEach(function (el) {
          var raf = null, rx = 0, ry = 0;
          function apply() {
            raf = null;
            el.style.setProperty('--rx', rx.toFixed(2) + 'deg');
            el.style.setProperty('--ry', ry.toFixed(2) + 'deg');
          }
          el.addEventListener('mousemove', function (e) {
            var r = el.getBoundingClientRect();
            ry = ((e.clientX - r.left) / r.width - 0.5) * 8;
            rx = -((e.clientY - r.top) / r.height - 0.5) * 6;
            el.classList.add('is-active');
            if (!raf) raf = requestAnimationFrame(apply);
          });
          el.addEventListener('mouseleave', function () {
            rx = 0; ry = 0; el.classList.remove('is-active');
            if (!raf) raf = requestAnimationFrame(apply);
          });
        });
      }

      /* ─── Hero 窗口跟随光标 ─── */
      function setupHeroTilt() {
        var stage = document.querySelector('[data-hero-stage]');
        if (!stage || !fine) return;
        var mock = stage.querySelector('.appmock');
        if (!mock) return;
        var raf = null, rx = 0, ry = 0;
        function apply() {
          raf = null;
          mock.style.setProperty('--tilt-x', rx.toFixed(2) + 'deg');
          mock.style.setProperty('--tilt-y', ry.toFixed(2) + 'deg');
        }
        stage.addEventListener('mousemove', function (e) {
          var r = stage.getBoundingClientRect();
          ry = ((e.clientX - (r.left + r.width / 2)) / r.width) * 5;
          rx = -((e.clientY - (r.top + r.height / 2)) / r.height) * 3;
          if (!raf) raf = requestAnimationFrame(apply);
        });
        stage.addEventListener('mouseleave', function () {
          rx = 0; ry = 0; if (!raf) raf = requestAnimationFrame(apply);
        });
      }

      /* ─── 表单校验（本地演示，无后端） ─── */
      function setupForm() {
        var form = document.querySelector('[data-form]');
        if (!form) return;
        var ok = form.querySelector('.form__ok');

        function setError(name, msg) {
          var input = form.querySelector('[name="' + name + '"]');
          if (!input) return true;
          var field = input.closest('.field');
          field.classList.toggle('field--invalid', !!msg);
          var err = field.querySelector('.field__err');
          if (err) err.textContent = msg || '';
          return !msg;
        }

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var d = new FormData(form);
          var name = String(d.get('name') || '').trim();
          var email = String(d.get('email') || '').trim();
          var msg = String(d.get('message') || '').trim();

          var valid = true;
          valid = setError('name', !name ? '请填写怎么称呼你' : (name.length > 40 ? '名字太长了' : '')) && valid;
          valid = setError('email', /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? '' : '邮箱格式看起来不对') && valid;
          valid = setError('message', msg.length < 6 ? '至少写六个字，我们才知道怎么帮你' : '') && valid;
          if (!valid) return;

          form.querySelectorAll('input, textarea, select, button').forEach(function (el) { el.disabled = true; });
          if (ok) { ok.classList.add('is-visible'); }
        });

        form.addEventListener('input', function (e) {
          var field = e.target.closest('.field');
          if (field && field.classList.contains('field--invalid')) {
            field.classList.remove('field--invalid');
            var err = field.querySelector('.field__err');
            if (err) err.textContent = '';
          }
        });
      }

      /* ─── 懒加载图片淡入 ─── */
      function setupLazyFade() {
        document.querySelectorAll('img[loading="lazy"]').forEach(function (img) {
          if (img.complete) return;
          img.style.opacity = '0';
          img.style.transition = 'opacity 600ms cubic-bezier(0.16,1,0.3,1)';
          var show = function () { img.style.opacity = '1'; };
          img.addEventListener('load', show);
          img.addEventListener('error', show);
        });
      }


      /* ─── 终端打字：进入视口后逐字敲命令、逐行出结果 ─── */
      function setupTerminal() {
        var terms = document.querySelectorAll('[data-terminal]');
        if (!terms.length) return;
        var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            io.unobserve(en.target);
            play(en.target);
          });
        }, { threshold: 0.5 });
        terms.forEach(function (t) { io.observe(t) });

        function play(term) {
          var cmdEl = term.querySelector('.cmd')
          var lines = term.querySelectorAll('[data-term-line]')
          if (!cmdEl || reduce) return
          var full = cmdEl.textContent
          var firstLine = term.children[0]
          // 隐藏结果行
          lines.forEach(function (l) { l.style.opacity = '0'; l.style.transition = 'opacity .4s ease' })
          cmdEl.textContent = ''
          var i = 0
          var timer = setInterval(function () {
            i++
            cmdEl.textContent = full.slice(0, i)
            if (i >= full.length) {
              clearInterval(timer)
              var j = 0
              var reveal = setInterval(function () {
                if (j < lines.length) { lines[j].style.opacity = '1'; j++ }
                else clearInterval(reveal)
              }, 420)
            }
          }, 34)
        }
      }

      /* ─── 旋转舞台:悬停暂停 ─── */
      function setupTurntablePause() {
        var sec = document.querySelector('.turntable')
        if (!sec) return
        sec.addEventListener('mouseenter', function () { sec.classList.add('is-paused') })
        sec.addEventListener('mouseleave', function () { sec.classList.remove('is-paused') })
      }

      /* ─── 颜色自定义大字：点色板换色 ─── */
      function setupPaint() {
        var sec = document.querySelector('.paint')
        if (!sec) return
        var title = sec.querySelector('.paint__title')
        var meta = sec.querySelector('.paint__meta')
        var names = { '#0d9668': 'TEAL 0D9668', '#3b82f6': 'BLUE 3B82F6', '#f59e0b': 'AMBER F59E0B', '#ec4899': 'ROSE EC4899', '#8b5cf6': 'VIOLET 8B5CF6' }
        sec.addEventListener('click', function (e) {
          var b = e.target.closest('[data-paint]')
          if (!b) return
          var c = b.getAttribute('data-paint')
          sec.style.setProperty('--demo-accent', c)
          sec.querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('is-active', x === b) })
          if (meta && names[c]) meta.textContent = 'ACCENT · ' + names[c]
        })
      }

      /* ─── 滚动逐字点亮：把长句按字组分片,按滚动进度从左到右点亮 ─── */
      function setupSweep() {
        var el = document.querySelector('[data-sweep]')
        if (!el) return
        // 分片:按 2 字一组(中文节奏),标点并入前组
        var text = el.textContent.trim()
        var groups = []
        var buf = ''
        for (var i = 0; i < text.length; i++) {
          var ch = text[i]
          buf += ch
          if ('，。：；—、！？'.indexOf(ch) >= 0 || buf.length >= 3) { groups.push(buf); buf = '' }
        }
        if (buf) groups.push(buf)
        el.textContent = ''
        var spans = groups.map(function (g) {
          var sp = document.createElement('span')
          sp.className = 'w'
          sp.textContent = g
          el.appendChild(sp)
          return sp
        })
        var ticking = false
        function update() {
          ticking = false
          var r = el.getBoundingClientRect()
          var vh = window.innerHeight
          // 进度:元素顶部从视口 85% 走到 25%
          var p = (vh * 0.85 - r.top) / (r.height + vh * 0.5)
          p = Math.max(0, Math.min(1, p))
          var litCount = Math.round(p * spans.length)
          spans.forEach(function (sp, i) {
            var lit = i < litCount
            sp.classList.toggle('lit', lit)
            // 绿色点缀:点亮的前 1/6 用品牌绿
            sp.classList.toggle('g', lit && i < spans.length / 6)
          })
        }
        window.addEventListener('scroll', function () {
          if (!ticking) { ticking = true; requestAnimationFrame(update) }
        }, { passive: true })
        window.addEventListener('resize', update)
        update()
      }

      setupTurntablePause();
      setupSweep();
      setupPaint();
      setupTerminal();
      setupMagnetic();
      setupTilt();
      setupHeroTilt();
      setupForm();
      setupLazyFade();
    }
  };
})();

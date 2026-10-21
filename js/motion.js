/* ============================================================
   motion.js — 字的手感
   · 纯函数：isLatinText / wordRanges / planLine / pickWordMove
     （Node 下可直接 require 做单测，不碰 DOM）
   · 浏览器：attach() 挂“指针光 / 墨点 / 字浪 / 发呆张望”
   原则：动效一律叠加，不改阅读流程；没有指针、关了动效、
   系统开了“减少动态效果”时自动退化成空实现。
   ============================================================ */
(function (root) {
  'use strict';
  const XR = (root.XR = root.XR || {});

  const WORD_CH = /[0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
  const CJK_CH = /[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;
  const PUNCT = /[，。！？…—、；：,.!?;:'"‘’“”]/;

  /* 字的动作池：中文一次动一个字，英文一次动一个整词 */
  const MOVES = [
    'bob', 'bob', 'tilt', 'sway', 'pulse', 'hop', 'shiver', 'look',
    'drift', 'float', 'flip', 'glow', 'swing', 'pop', 'tick'
  ];
  const LEAD = ['bob', 'bob', 'hop', 'look', 'shiver', 'drift', 'swing'];
  const LATIN_MOVES = ['bob', 'float', 'swing', 'drift', 'tilt', 'pulse', 'glow', 'hop', 'look', 'shiver'];
  const LATIN_LEAD = ['bob', 'float', 'swing', 'drift', 'hop', 'bob', 'tilt'];

  /* ---------------- 纯函数 ---------------- */

  // 这段是不是以拉丁文为主（英文书 / 中英混排里的英文句子）
  function isLatinText(text) {
    const s = String(text == null ? '' : text);
    let latin = 0;
    let cjk = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (WORD_CH.test(c)) latin++;
      else if (CJK_CH.test(c)) cjk++;
    }
    return latin >= 4 && latin > cjk * 2;
  }

  // 英文的词边界：don't / well-known 算一个词
  function wordRanges(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    let i = 0;
    while (i < s.length) {
      if (!WORD_CH.test(s[i])) { i++; continue; }
      let j = i + 1;
      while (j < s.length) {
        if (WORD_CH.test(s[j])) { j++; continue; }
        if ((s[j] === "'" || s[j] === '’' || s[j] === '-') && WORD_CH.test(s[j + 1] || '')) { j += 2; continue; }
        break;
      }
      out.push({ s: i, e: j });
      i = j;
    }
    return out;
  }

  /* 给一行排“动点”：
     返回 { 起点: { end, m, amp, dur, ph, once } }
     · 中文：一个字一个动点
     · 英文：一个整词一个动点（整词一起动，词不会从中间断开，
       高亮底色也不会被“半个词在动”撕开）
     · blocked 里的区间（跳词 / 搜索命中 / 自定义样式）一律不动，
       否则底色会被移动的字带歪。 */
  function planLine(text, opts) {
    const o = opts || {};
    const s = String(text == null ? '' : text);
    const out = {};
    if (s.length < 2) return out;
    const level = o.level === undefined ? 2 : Math.max(0, Math.min(3, Number(o.level) || 0));
    if (!level) return out;
    const seed = typeof o.seed === 'function' ? o.seed : Math.random;
    const lead = !!o.lead;
    const latin = typeof o.latin === 'boolean' ? o.latin : isLatinText(s);
    const ranges = Array.isArray(o.blocked) ? o.blocked : [];
    const blocked = (a, b) => {
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        if (r && a < r[1] && b > r[0]) return true;
      }
      return false;
    };

    const spots = [];
    if (latin) {
      const ws = wordRanges(s);
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        const len = w.e - w.s;
        if (len < 2 || len > 24) continue;
        if (blocked(w.s, w.e)) continue;
        spots.push(w);
      }
    } else {
      for (let i = 0; i < s.length; i++) {
        if (!/[0-9A-Za-z\u3400-\u9FFF\u3040-\u30FF]/.test(s[i])) continue;
        if (blocked(i, i + 1)) continue;
        spots.push({ s: i, e: i + 1 });
      }
    }

    // 一行里连个“字”都没有：段首行留一个标点在敲
    if (!spots.length) {
      if (!lead) return out;
      for (let i = 0; i < s.length; i++) {
        if (PUNCT.test(s[i]) && !blocked(i, i + 1)) {
          out[i] = { end: i + 1, m: 'tick', amp: '0.8', dur: '2.6', ph: (seed(3) * 2).toFixed(2), once: false };
          break;
        }
      }
      return out;
    }

    const r0 = seed(0);
    if (r0 < 0.12 && !lead) return out;      // 12% 的行安静一下，动才显得有意图

    const L = spots.length;
    let k = L <= 8 ? 1 : L <= 24 ? 1 + Math.floor(r0 * 2) : 2 + Math.floor(r0 * 2);
    if (latin) k = Math.min(k, 2);            // 英文一个词就是一大块，少动几个更自然
    k = Math.max(1, Math.min(level >= 2 ? 3 : 2, k));

    const used = {};
    for (let n = 0; n < k; n++) {
      const rp = seed(n + 1);
      let slot = Math.floor(rp * L) % L;
      if (used[slot]) slot = (slot + 1) % L;
      if (used[slot]) break;
      used[slot] = 1;

      const sp = spots[slot];
      const word = s.slice(sp.s, sp.e);
      const ra = seed(n + 7);
      const rd = seed(n + 13);
      const rf = seed(n + 19);
      const rm = seed(n + 29);
      let m;
      if (n === 0) {
        const pool = latin ? LATIN_LEAD : LEAD;   // 每行至少有一个是上下动
        m = pool[Math.floor(rm * pool.length) % pool.length];
      } else {
        const pool = latin ? LATIN_MOVES : MOVES;
        m = pool[Math.floor(rm * pool.length) % pool.length];
      }
      if (/^[0-9０-９]+$/.test(word)) m = 'pop';                 // 数字自己弹大
      else if (!latin && PUNCT.test(word)) m = 'tick';           // 标点敲一下
      if (o.style === 'dialogue' && rf < 0.6) m = 'speak';       // 台词里的字会“开口”
      if (o.tone === 'loud' && rm > 0.7) m = 'hop';

      out[sp.s] = {
        end: sp.e,
        m: m,
        amp: (latin ? (0.5 + ra * 0.5) : (0.6 + ra * 0.8)).toFixed(2),
        dur: (latin ? (2.4 + rd * 2.2) : (1.8 + rd * 2.8)).toFixed(2),
        ph: (rf * 3).toFixed(2),
        once: seed(n + 37) < 0.35
      };
    }
    return out;
  }

  // 跳词自己的呼吸方式（同一个词永远是同一种，别每次刷新都变脸）
  function pickWordMove(word, rnd) {
    const r = typeof rnd === 'number' ? rnd : 0.5;
    if (r < 0.34) return 'breathe';
    if (r < 0.62) return 'glow';
    if (r < 0.78) return 'shimmer';
    return '';
  }

  /* ---------------- 浏览器：手感层 ---------------- */
  function noop() { }

  function attach(opts) {
    const o = opts || {};
    const stage = o.stage;
    const beats = o.beats;
    const stub = { point: noop, ripple: noop, spark: noop, wave: noop, tap: noop, setActive: noop, detach: noop };
    if (!stage || !beats || typeof document === 'undefined') return stub;

    const win = window;
    const calm = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const docEl = document.documentElement;
    const bodyEl = document.body;
    const getLevel = typeof o.getLevel === 'function' ? o.getLevel : function () { return 2; };
    const onTap = typeof o.onTap === 'function' ? o.onTap : null;

    let raf = 0;
    let px = 0;
    let py = 0;
    let lit = null;
    let active = false;
    let idleTimer = 0;
    let lastPoke = 0;
    let disposed = false;

    function clearLit() {
      if (lit) { lit.classList.remove('lit'); lit = null; }
    }

    function paint() {
      raf = 0;
      if (disposed) return;
      docEl.style.setProperty('--gx', px + 'px');
      docEl.style.setProperty('--gy', py + 'px');
      const el = document.elementFromPoint(px, py);
      const line = el && el.closest ? el.closest('.beat') : null;
      const next = line && beats.contains(line) ? line : null;
      if (next !== lit) {
        if (lit) lit.classList.remove('lit');
        lit = next;
        if (lit) lit.classList.add('lit');
      }
    }

    // 指针走到哪儿，那一带的字就醒一下（触屏由 CSS 自己关掉这层光）
    function point(x, y) {
      if (disposed || calm || !active || getLevel() <= 0) return;
      px = x;
      py = y;
      lastPoke = performance.now();
      bodyEl.classList.add('glow-on');
      if (!raf) raf = requestAnimationFrame(paint);
    }

    function pointOff() {
      bodyEl.classList.remove('glow-on');
      clearLit();
    }

    // 点一下：一小圈墨
    function ripple(x, y) {
      if (disposed || calm || getLevel() <= 0) return;
      const r = stage.getBoundingClientRect();
      const i = document.createElement('i');
      i.className = 'ink-ripple';
      i.style.left = (x - r.left + stage.scrollLeft) + 'px';
      i.style.top = (y - r.top + stage.scrollTop) + 'px';
      stage.appendChild(i);
      setTimeout(() => { if (i.parentNode) i.parentNode.removeChild(i); }, 700);
    }

    // 点跳词：那个词的字散开又落回去
    function spark(text, x, y) {
      if (disposed || calm || getLevel() <= 0) return;
      const chars = Array.from(String(text == null ? '' : text)).slice(0, 6);
      if (!chars.length) return;
      const r = stage.getBoundingClientRect();
      const box = document.createElement('span');
      box.className = 'spark';
      box.style.left = (x - r.left + stage.scrollLeft) + 'px';
      box.style.top = (y - r.top + stage.scrollTop) + 'px';
      chars.forEach((c, n) => {
        const b = document.createElement('b');
        b.textContent = c;
        const a = (n / chars.length) * Math.PI * 2 - Math.PI / 2;
        const d = 14 + (n % 3) * 7;
        b.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
        b.style.setProperty('--dy', (Math.sin(a) * d - 8).toFixed(1) + 'px');
        b.style.setProperty('--rot', ((n % 2 ? 1 : -1) * (12 + n * 6)) + 'deg');
        b.style.animationDelay = (n * 12) + 'ms';
        box.appendChild(b);
      });
      stage.appendChild(box);
      setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box); }, 900);
    }

    // 字浪：一道光从这一行上扫过去
    function wave(el) {
      const line = el || lit || beats.querySelector('.beat:not(.past)');
      if (!line || disposed || calm || getLevel() <= 0) return false;
      line.classList.remove('wave');
      void line.offsetWidth;
      line.classList.add('wave');
      setTimeout(() => line.classList.remove('wave'), 1200);
      return true;
    }

    // 被点到的那一行，轻轻应一下
    function tap(el) {
      if (!el || disposed || calm || getLevel() <= 0) return;
      el.classList.remove('tapped');
      void el.offsetWidth;
      el.classList.add('tapped');
      setTimeout(() => el.classList.remove('tapped'), 420);
    }

    // 发呆：半天没人动，某一行里的某个字自己张望一下
    function pokeOnce() {
      if (disposed || calm || !active || document.hidden || getLevel() <= 0) return;
      const vis = [];
      const all = beats.querySelectorAll('.beat .zg');
      const vh = win.innerHeight || 800;
      for (let i = 0; i < all.length; i++) {
        const r = all[i].getBoundingClientRect();
        if (r.bottom > 40 && r.top < vh - 40) vis.push(all[i]);
      }
      if (!vis.length) return;
      const el = vis[Math.floor(Math.random() * vis.length)];
      el.classList.add('peek');
      setTimeout(() => el.classList.remove('peek'), 1600);
    }

    function loop() {
      if (disposed) return;
      const now = performance.now();
      if (active && !document.hidden && now - lastPoke > 5200 && now - idleTimer > 5200) {
        idleTimer = now;
        pokeOnce();
      }
      setTimeout(loop, 2600);
    }

    function onLeave() { pointOff(); }

    stage.addEventListener('pointerleave', onLeave);
    const timer = setTimeout(loop, 6000);

    return {
      get active() { return active; },
      point: point,
      pointOff: pointOff,
      ripple: ripple,
      spark: spark,
      wave: wave,
      tap: tap,
      setActive: function (on) {
        active = !!on;
        if (!active) pointOff();
      },
      detach: function () {
        disposed = true;
        clearTimeout(timer);
        if (raf) cancelAnimationFrame(raf);
        stage.removeEventListener('pointerleave', onLeave);
        pointOff();
      }
    };
  }

  const Motion = {
    isLatinText: isLatinText,
    wordRanges: wordRanges,
    planLine: planLine,
    pickWordMove: pickWordMove,
    attach: attach,
    MOVES: MOVES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Motion;
  if (root) root.XR.Motion = Motion;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

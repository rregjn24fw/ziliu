/* ============================================================
   ui.js — 界面与交互
   ============================================================ */
(function () {
  'use strict';

  const XR = window.XR;
  const $ = (sel, root) => (root || document).querySelector(sel);

  const D = {};
  const S = {
    view: 'shelf',
    book: null,
    chapterIndex: 0,
    beats: [],
    index: -1,
    auto: false,
    autoTimer: 0,
    settings: null,
    busy: false,
    ended: false,
    saveTimer: 0,
    seamTimer: 0,
    revealUntil: 0,
    revealEl: null,
    revealDur: 0,
    lastWheel: 0,
    seen: {},
    notebook: {},
    drawerView: '',
    allShown: false,
    immersive: false,
    immersiveTarget: 0,
    scrubbing: false,
    lastAdvance: 0,
    ignoreClickUntil: 0,
    autoScrollTimer: 0,
    autoGlide: null,
    autoStepAt: 0,
    autoEndAt: 0,
    autoChapterAt: 0,
    gates: [],
    gateOpen: null,
    gateCool: 0,
    gateCoolClick: 0,
    gateArmed: false,
    gatePlay: false,
    gateCarry: 0,
    gateLastCh: -99,
    gateInfo: null,
    selOn: false,
    scrollBase: 0,
    animSalt: '0',
    bookSalt: '0',
    rules: [],
    rulesErr: [],
    rulesVer: 0,
    ruleDraft: { pat: '', act: 'hi', repl: '' },
    ruleTimer: 0,
    search: { q: '', re: false, hits: [], i: -1, error: '', capped: false, ms: 0 },
    beatSeq: 0,
    io: null,
    motion: null,
    /* 互动扩展：分支剧情 + 守卷人阿泠 */
    companion: null,
    lastScene: {},
    milestones: {},
    story: { stack: [], current: null },
    storyOverride: null,
    stories: [],
    choiceKind: '',
    choiceOptions: null,
    companionReply: null,
    genScope: 'extra',
    /* B 段：书签 / 笔记 / 朗读 / 同步 */
    marks: { bookmarks: [], notes: [] },
    markCount: 0,
    noteDraft: null,
    tts: { on: false, cursor: -1, step: false },
    syncState: null,
    syncBusy: false,
    syncTimer: 0,
    syncLoop: 0,
    onlineBound: false
  };

  /* ---------------- 小工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }
  function fmtNum(n) {
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + ' 万';
    return String(n);
  }
  function stripChapterNo(title) {
    return String(title || '').replace(/^\s*(第\s*[0-9零〇一二三四五六七八九十百千两]+\s*[章节回卷部篇集幕话折]|Chapter\s+\d+)\s*[:：.、·]?\s*/i, '').trim() || title;
  }

  /* 读法：只在设置里定。正文里不会弹出来问，但会一直按这个读法显示 */
  const MOODS = {
    normal: { name: '正常', zoom: 1, mute: false, note: '原文本来的样子' },
    near: { name: '凑近', zoom: 1.18, mute: false, note: '字号放大 18%，像把头凑近书页' },
    far: { name: '退后', zoom: 0.86, mute: false, note: '字号收 14%，把环境推远一点' },
    still: { name: '安静', zoom: 1, mute: true, note: '不跳词、不逐字动，只留字' }
  };
  function mood() {
    return MOODS[S.settings.mood] || MOODS.normal;
  }

  let toastTimer = 0;
  function toast(msg) {
    D.toast.textContent = msg;
    D.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => D.toast.classList.remove('show'), 2200);
  }

  function setStatus(msg, isErr) {
    D.status.textContent = msg || '';
    D.status.classList.toggle('err', !!isErr);
  }

  /* ---------------- 设置 ---------------- */
  function applySettings() {
    const s = S.settings;
    const compiled = XR.Engine.compileRules(s.rules || []);
    S.rules = compiled.rules;
    S.rulesErr = compiled.errors;
    S.rulesVer = (S.rulesVer || 0) + 1;
    document.body.dataset.theme = s.theme;
    document.documentElement.style.setProperty('--base', s.base + 'px');
    document.documentElement.style.setProperty('--motion', (0.45 + s.intensity * 1.05).toFixed(2));
    XR.Store.saveSettings(s);
  }

  /* ============================================================
     书架
     ============================================================ */
  async function renderShelf() {
    const books = await XR.Store.listBooks();
    D.bookList.innerHTML = '';
    D.shelfEmpty.hidden = books.length > 0;

    for (const b of books) {
      const pct = await bookPercent(b);
      // 语言标记按书本体的 / stats 里的取：英文书按“词”数，中文按“字”数
      const lang = b.lang || (b.stats && b.stats.lang) || 'cjk';
      const amount = lang === 'latin' ? (b.words || (b.stats && b.stats.words) || b.chars) : b.chars;
      const li = document.createElement('li');
      li.className = 'book-card';
      li.dataset.id = b.id;
      li.innerHTML =
        '<div class="bc-title">' + esc(b.title) + '</div>' +
        '<div class="bc-meta"><span>' + b.chapters + ' 章</span><span>' +
        fmtNum(amount) + (lang === 'latin' ? ' 词' : ' 字') + '</span><span>' +
        (b.source === 'epub' ? 'EPUB' : 'TXT') + '</span>' + (b.images ? '<span>' + b.images + ' 图</span>' : '') +
        (b.author ? '<span>' + esc(b.author) + '</span>' : '') + '</div>' +
        '<div class="bc-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="bc-foot"><span class="bc-open">' + (pct > 0 ? '继续阅读 →' : '开始阅读 →') + '</span>' +
        '<button class="bc-del" data-del="' + escAttr(b.id) + '">删除</button></div>';
      D.bookList.appendChild(li);
    }

    if (XR.Store.mode === 'memory') {
      setStatus('提示：当前环境无法持久化存储（file:// 或隐私模式），刷新后需要重新导入。');
    }
  }

  async function bookPercent(meta) {
    const p = await XR.Store.getProgress(meta.id);
    if (!p || !meta.chapters) return 0;
    const per = p.beats > 0 ? (p.index + 1) / p.beats : 0.5;
    const v = ((p.chapterIndex || 0) + Math.min(1, Math.max(0, per))) / meta.chapters;
    return Math.max(1, Math.min(100, Math.round(v * 100)));
  }

  async function importFiles(files) {
    if (!files || !files.length) return;
    D.dropzone.classList.add('over');
    let last = null;
    for (const f of files) {
      try {
        setStatus('正在解析 ' + f.name + ' …');
        const book = await XR.Import.fromFile(f, (m) => setStatus(m));
        await XR.Store.saveBook(book);
        last = book;
        const st = book.stats || {};
        let msg = '已导入《' + book.title + '》 · ' + book.chapters.length + ' 章 · ' +
          fmtNum(st.lang === 'latin' ? (st.words || st.chars) : st.chars) + (st.lang === 'latin' ? ' 词' : ' 字');
        if (st.images) msg += ' · ' + st.images + ' 张图';
        if (st.failedImages) msg += ' · 有 ' + st.failedImages + ' 张图没找到';
        setStatus(msg);
        if (st.failedImages && !st.images) toast('这本书的图一张都没读出来，把书名告诉我，我看一眼');
        else toast('已导入：' + book.title);
      } catch (err) {
        console.error(err);
        setStatus('导入失败：' + (err && err.message ? err.message : err), true);
        toast('导入失败，看看底部提示');
      }
    }
    D.dropzone.classList.remove('over');
    await renderShelf();
    await XR.Store.markDirty('books');
    queueAutoSync();
    if (last) {
      companionSay('add-book', { title: last.title, chapters: last.chapters.length });
      if (files.length === 1) openBook(last.id);
    }
  }

  /* ============================================================
     打开 / 关闭一本书
     ============================================================ */
  async function openBook(id) {
    const book = await XR.Store.getBook(id);
    if (!book) { toast('这本书已经不在了'); renderShelf(); return; }
    if (!book.chapters || !book.chapters.length) {
      // 云端幽灵书：同步开着就直接从 GitHub 下载正文，下载完接着读
      const cfg = XR.Store.loadSync();
      const cfgOk = cfg && cfg.enabled && cfg.owner && cfg.repo && cfg.token &&
        (XR.Sync && typeof XR.Sync.pullBookContent === 'function');
      if (cfgOk) {
        toast('正在从云端下载正文…');
        try {
          const ok = await XR.Sync.pullBookContent(id);
          if (ok) {
            const fresh = await XR.Store.getBook(id);
            if (fresh && fresh.chapters && fresh.chapters.length) {
              toast('✓ 正文已下载，继续阅读');
              return openBook(id);
            }
          }
          toast('云端没有这本书的正文：去原设备开「同步正文」后同步一次', true);
          renderShelf();
          return;
        } catch (err) {
          toast('正文下载失败：' + (err && err.message ? err.message : err), true);
          renderShelf();
          return;
        }
      }
      toast('这本书只有云端记录：打开设置里的同步（含「同步正文」）即可自动下载', true);
      renderShelf();
      return;
    }
    S.book = book;
    S.bookSalt = Math.random().toString(36).slice(2, 8);
    S.story = { stack: [], current: null };
    S.storyOverride = null;
    S.milestones = {};
    const prog = await XR.Store.getProgress(id);
    const ci = prog ? Math.min(prog.chapterIndex || 0, book.chapters.length - 1) : 0;
    const resume = prog && typeof prog.index === 'number' ? prog.index : -1;
    S.seen = (prog && prog.seen) || {};
    S.stories = await XR.Store.listStories(id);
    await refreshMarks();
    loadNotebook();

    D.shelf.hidden = true;
    D.reader.hidden = false;
    S.view = 'reader';
    if (S.motion) S.motion.setActive(true);

    loadChapter(ci, resume);
    D.stage.focus({ preventScroll: true });
    companionSay('resume', { chapter: ci + 1, title: book.title });

    if (!XR.Store.getFlag('seen')) {
      XR.Store.setFlag('seen', 1);
      setTimeout(() => toast('默认按「段」读；拖顶部进度条可以跳到任意位置，设置里能切「逐句 / 整章」'), 700);
    }
  }

  function backToShelf() {
    setAuto(false);
    if (S.tts.on) ttsStop(true);
    saveProgressNow();
    if (S.book) companionSay('interrupt', { title: S.book.title });
    S.view = 'shelf';
    if (S.motion) S.motion.setActive(false);
    S.book = null;
    S.story = { stack: [], current: null };
    S.storyOverride = null;
    closeAll();
    D.reader.hidden = true;
    D.shelf.hidden = false;
    renderShelf();
    D.shelf.scrollTop = 0;
  }

  /* ============================================================
     章节加载
     ============================================================ */
  function loadChapter(ci, resume, seam) {
    if (!S.book) return;
    ci = Math.max(0, Math.min(ci, S.book.chapters.length - 1));
    S.chapterIndex = ci;
    S.ended = false;
    S.index = -1;
    S.revealEl = null;
    S.revealUntil = 0;

    const s = S.settings;
    const mode = s.mode || 'read';
    S.immersive = mode === 'immersive';
    S.allShown = mode === 'read' || (mode === 'play' && s.granularity === 'chapter');

    const gran = mode === 'read'
      ? 'sentence'
      : mode === 'immersive'
        ? (s.stageUnit === 'sentence' ? 'sentence' : 'paragraph')
        : s.granularity;

    const realCh = (S.story.current && S.storyOverride)
      ? { title: S.storyOverride.title, text: S.storyOverride.text }
      : S.book.chapters[ci];
    S.beats = XR.Engine.buildChapter(realCh, {
      intensity: s.intensity,
      granularity: gran,
      density: s.density,
      marks: s.marks,
      restrained: mode === 'read',
      rnd: chapterRnd(ci)
    });

    // 卡页：分支阅读不铺卡；主线按用户设置铺，零头带到下一章
    if (S.story.current) { S.gateInfo = null; S.gateCarry = 0; }
    else planGates();

    // 分支入口：只在主线注入「岔路」选择节拍
    if (!S.story.current) {
      const hooks = XR.Stories.hooksForChapter(S.stories || [], ci);
      if (hooks.length) S.beats = XR.Stories.attachChoices(S.beats, hooks);
    }

    S.gates = [];
    S.gateOpen = null;
    S.gatePlay = false;
    S.animSalt = Math.random().toString(36).slice(2, 8);
    S.beatSeq = 0;
    if (S.io) S.io.disconnect();

    D.stage.classList.toggle('immersive-mode', S.immersive);
    D.beats.innerHTML = '';
    renderChapterCard(realCh, ci);
    updateChrome();

    if (S.allShown) {
      for (const b of S.beats) {
        renderBeat(b, true);
      }
      S.index = S.beats.length - 1;
      const max = D.stage.scrollHeight - D.stage.clientHeight;
      const p = typeof resume === 'number' && resume > 0 && S.beats.length > 1 ? resume / (S.beats.length - 1) : 0;
      D.stage.scrollTop = Math.max(0, Math.min(max, p * max));
      updateChrome();
      saveProgressNow();
      S.scrollBase = D.stage.scrollTop;
      S.gateArmed = false;
      S.gateCool = performance.now() + 900;
      if (seam) playSeam();
      // 自动播放跨章：新的一章先露个脸，再接着走
      S.autoChapterAt = performance.now() + (S.auto ? Math.max(1000, autoWait()) : 0);
      maybeResumeAuto();
      return;
    }

    const target = typeof resume === 'number' && resume >= 0 ? Math.min(resume, S.beats.length - 1) : 0;
    for (let i = 0; i <= target; i++) {
      S.index = i;
      renderBeat(S.beats[i], true);
    }
    if (S.immersive) {
      arrangeImmersive();
      centerImmersive(true);
    } else {
      D.stage.scrollTop = D.stage.scrollHeight;
    }
    updateChrome();
    saveProgressNow();
    if (seam) playSeam();
    S.autoChapterAt = performance.now() + (S.auto ? Math.max(1000, autoWait()) : 0);
    maybeResumeAuto();
  }

  /* 自动换章的那一下：正文整体上浮淡入一下，像书页翻过去，而不是凭空跳转 */
  function playSeam() {
    D.beats.classList.remove('seam');
    void D.beats.offsetWidth;
    D.beats.classList.add('seam');
    clearTimeout(S.seamTimer);
    S.seamTimer = setTimeout(() => D.beats.classList.remove('seam'), 900);
  }

  /* ============================================================
     沉浸模式：最新的一段落在正中间，读过的往上走、越往上越淡
     ============================================================ */
  function immersiveNodes() {
    return Array.from(D.beats.querySelectorAll('.beat, .gate-strip'));
  }

  function stageKeep() {
    const k = Math.round(Number(S.settings.stageKeep));
    return Number.isFinite(k) ? Math.max(0, Math.min(4, k)) : 2;
  }

  function arrangeImmersive() {
    if (!S.immersive) return;
    const nodes = immersiveNodes();
    const last = nodes.length - 1;
    for (let i = 0; i < nodes.length; i++) {
      const depth = last - i;
      if (depth > 0) {
        nodes[i].classList.add('past');
        nodes[i].dataset.depth = String(depth);
      } else {
        nodes[i].classList.remove('past');
        delete nodes[i].dataset.depth;
      }
    }
    while (nodes.length > stageKeep() + 1) {
      const gone = nodes.shift();
      if (gone) gone.remove();
    }
  }

  function centerImmersive(instant) {
    if (!S.immersive) return;
    const nodes = immersiveNodes();
    const el = nodes[nodes.length - 1];
    if (!el) return;
    const vh = D.stage.clientHeight;
    if (!vh) return;
    const h = el.offsetHeight;
    const top = D.beats.offsetTop + el.offsetTop;
    let target = h > vh * 0.82
      ? top - Math.round(vh * 0.08)
      : top - Math.round((vh - h) / 2);
    const max = Math.max(0, D.stage.scrollHeight - vh);
    target = Math.max(0, Math.min(max, target));
    S.immersiveTarget = target;
    if (instant) D.stage.scrollTop = target;
    else D.stage.scrollTo({ top: target, behavior: 'smooth' });
  }

  /* 这一章埋几张卡：完全按设置里的「每 N 句 / 每 N 段一张」走。
     上一章没用完的零头带到这一章（S.gateCarry），所以一章只有几行的书读几章也会遇到卡。
     跳章就从这里重新攒，不会因为跨了几十章一次弹出七八张。 */
  function planGates() {
    S.gateInfo = null;
    const s = S.settings;
    if (!s.gateOn) { S.gateCarry = 0; return; }
    if (S.gateLastCh !== S.chapterIndex - 1) S.gateCarry = 0;
    S.gateLastCh = S.chapterIndex;

    const unit = s.gateUnit === 'paragraph' ? 'paragraph' : 'sentence';
    const every = Math.max(1, Math.round(s.gateEvery || 6));
    const res = XR.Engine.insertGatesEvery(S.beats, {
      every,
      unit,
      carry: S.gateCarry,
      ahead: s.gateAhead !== false
    });
    S.beats = res.beats;
    S.gateCarry = res.carry;
    S.gateInfo = {
      every,
      unit,
      count: res.count,
      units: res.units,
      carry: res.carry,
      left: Math.max(1, every - res.carry)
    };
  }

  function gateUnitWord(unit) {
    return unit === 'paragraph' ? '段' : '句';
  }

  function jumpChapter(i) {
    if (!S.book) return;
    if (S.tts.on) ttsStop(true);
    if (S.auto) setAuto(false);   // 自己点了章节 = 自己接管
    saveProgressNow();
    S.story = { stack: [], current: null };
    S.storyOverride = null;
    closeAll();    if (i < 0 || i >= S.book.chapters.length) return;
    loadChapter(i, -1);
    toast('第 ' + (i + 1) + ' 章 · ' + stripChapterNo(S.book.chapters[i].title));
  }

  function renderChapterCard(ch, ci) {
    const el = document.createElement('div');
    el.className = 'chapter-card';
    if (S.story.current) {
      el.innerHTML =
        '<div class="cc-kicker">番外 · 分支</div>' +
        '<div class="cc-title">' + esc(ch.title) + '</div>';
    } else {
      el.innerHTML =
        '<div class="cc-kicker">第 ' + (ci + 1) + ' 章 · 共 ' + S.book.chapters.length + ' 章</div>' +
        '<div class="cc-title">' + esc(stripChapterNo(ch.title)) + '</div>';
    }
    D.beats.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
  }

  /* ============================================================
     推进
     ============================================================ */
  function advance(instant) {
    if (S.busy) { if (S.auto) scheduleAuto(); return; }
    if (!D.gateLayer.hidden) return;
    if (!D.wordLayer.hidden || !D.choiceLayer.hidden || !D.settings.hidden) return;
    if (!S.book) return;
    if (S.tts.on && !S.tts.step) ttsStop(true);

    // 整章模式：一次铺满，点/空格就是往下翻一屏（立刻翻，不做平滑动画）
    if (S.allShown) {
      const max = D.stage.scrollHeight - D.stage.clientHeight;
      if (max <= 0 || D.stage.scrollTop >= max - 4) {
        // 到章尾了，但还有卡没弹过：先弹卡（内容是卡，不是确认），再直接进下一章
        if (tryLooseGate()) return;
        if (S.story.current) { showStoryEnd(); return; }
        if (!autoNext()) showBookEnd();
        return;
      }
      D.stage.scrollTop = Math.min(max, D.stage.scrollTop + D.stage.clientHeight * 0.82);
      S.gateArmed = true;
      // 自己翻的屏：别让自动播放正在推的那一下把位置又拉回去
      if (S.auto) { S.autoGlide = null; S.autoStepAt = performance.now() + autoWait(); }
      updateChrome();
      saveProgress();
      checkGates();
      return;
    }

    // 还在逐字显影：点一下立刻补全（不管计时器到没到），这一下不算推进
    if (!instant && completeReveal()) { if (S.auto) scheduleAuto(); return; }

    if (S.index + 1 >= S.beats.length) {
      if (S.story.current) { showStoryEnd(); return; }
      if (!autoNext()) showBookEnd();
      return;
    }

    S.index++;
    const b = S.beats[S.index];
    const fast = performance.now() - (S.lastAdvance || 0) < 500;
    S.lastAdvance = performance.now();

    // 岔路：读到这里弹出选择层（进入分支 / 继续读正文）
    if (b.kind === 'choice') {
      openStoryChoice(b);
      updateChrome();
      saveProgress();
      return;
    }

    // 互动模式里走到卡页：不用滚，直接把整页大卡弹出来
    if (b.kind === 'gate') {
      renderBeat(b, true, false);
      const g = S.gates[S.gates.length - 1];
      updateChrome();
      saveProgress();
      if (g) openGate(g);
      return;
    }

    renderBeat(b, !!instant, fast);
    updateChrome();
    saveProgress();
    if (S.auto) scheduleAuto();
  }

  // 把正在逐字显影的那一句立刻补全；真的还在显影才返回 true。
  // （显影早就自然走完的时候，这一下不能被吃掉 —— 以前它会白吞一次点击，
  //   自动播放也因此停住：下一次 advance 永远在“补全”，链子就断了）
  function completeReveal() {
    const el = S.revealEl;
    if (!el) return false;
    const live = performance.now() < S.revealUntil;
    S.revealEl = null;
    S.revealUntil = 0;
    S.revealDur = 0;
    if (!el.classList.contains('done')) el.classList.add('done');
    return live;
  }

  function renderBeat(b, instant, fast) {
    const all = S.allShown;
    const md = mood();
    const zoom = md.zoom;
    const seq = S.beatSeq++;

    // 岔路：整章模式先显示一条可点的岔路标记；逐句模式由 advance 直接弹选择层
    if (b.kind === 'choice') {
      const strip = document.createElement('div');
      strip.className = 'choice-strip';
      strip.innerHTML = '<b>❖</b><span>' + esc((b.options && b.options[0] && b.options[0].label) || '岔路') + '</span>';
      strip._choiceBeat = b;
      D.beats.appendChild(strip);
      return;
    }

    // 卡页：页面上只留一道细痕，读到这里时整页跳出来
    if (b.kind === 'gate') {
      const strip = document.createElement('div');
      strip.className = 'gate-strip';
      strip.innerHTML = '<i></i><b>' + (b.variant === 'word' ? '词' : '句') + '</b>';
      D.beats.appendChild(strip);
      S.gates.push({ el: strip, beat: b, done: false });
      if (!all) {
        if (S.immersive) {
          arrangeImmersive();
          centerImmersive(true);
        } else {
          D.stage.scrollTop = D.stage.scrollHeight;
        }
      }
      return;
    }

    if (!all) {
      const prev = D.beats.querySelector('.beat:last-child');
      if (prev) prev.classList.add('past');
    }

    const isImg = b.kind === 'image';
    // 用户在设置里加的正则只改“显示出来的字”，原文和跳词仍从 b.text 来
    const prep = isImg ? null : prepared(b);
    const dispText = prep ? prep.text : String(b.text || '');
    // 只有逐句模式、短句、而且不是“连点快进”的时候才逐字显影
    const typed = !isImg && !instant && !all && !fast && S.settings.typewriter && dispText.length <= 80;

    const el = document.createElement(isImg ? 'figure' : 'p');

    if (isImg) {
      el.className = 'beat beat-img';
      if (typeof b.p === 'number') el.dataset.p = String(b.p);
      const src = (S.book && S.book.images) ? S.book.images[b.src] : '';
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.loading = 'eager';
        img.decoding = 'async';
        img.addEventListener('load', () => {
          if (S.immersive) centerImmersive(true);
          if (S.allShown) { updateChrome(); saveProgress(); }
        });
        el.appendChild(img);
      } else {
        el.innerHTML = '<span class="img-missing">［图片未包含在这个文件里］</span>';
      }
    } else {
      el.className = 'beat tone-' + b.tone + ' ' + (b.style === 'dialogue' ? 'dialogue' : 'narration');
      // 英文行换一套排版：拉丁字体的字距、行高、断词规则都跟中文不一样
      if (XR.Motion && b.text && XR.Motion.isLatinText(b.text)) el.classList.add('latin');
      if (typeof b.p === 'number') el.dataset.p = String(b.p);
      if (b.lead) el.dataset.lead = '1';
      el.dataset.in = beatEnter(b);
      el.style.setProperty('--fs', (b.scale * zoom).toFixed(3));
      if (b.huge && zoom > 1.02) el.dataset.huge = '1';
      el.innerHTML = '<span class="ln">' + inlineHTML(b, typed, prep) + '</span>';
    }

    D.beats.appendChild(el);
    el._beat = b;

    if (typed) {
      const L = Math.max(1, Array.from(dispText).length);
      // 整句显影控制在 ~220ms 内，一眼就跟上，不会让你等字
      const stagger = Math.max(3, Math.min(14, 220 / L));
      el.style.setProperty('--stagger', stagger.toFixed(1) + 'ms');
      S.revealDur = L * stagger + 120;
      S.revealUntil = performance.now() + S.revealDur;
      S.revealEl = el;
    } else {
      S.revealEl = null;
      S.revealUntil = 0;
      S.revealDur = 0;
    }

    if (instant || all) el.classList.add('in');
    else requestAnimationFrame(() => el.classList.add('in'));

    // 只有屏幕上看得见的那几行才让字动起来，滚走的不占 CPU
    if (!isImg && S.io) S.io.observe(el);

    if (all) return;

    if (S.immersive) {
      arrangeImmersive();
      centerImmersive(instant || fast);
      return;
    }

    // 只留最近若干句，避免 DOM 无限增长
    const list = D.beats.querySelectorAll('.beat');
    if (list.length > 10) {
      for (let i = 0; i < list.length - 10; i++) list[i].remove();
    }

    if (instant || fast) D.stage.scrollTop = D.stage.scrollHeight;
    else D.stage.scrollTo({ top: D.stage.scrollHeight, behavior: 'smooth' });
  }

  /* ---------------- 活字：不是整句在动，是句子里几个单独的字在动 ----------------
     每行挑 1~3 个字，每个字有自己的动作、幅度、时长、相位；
     每段的第一行（b.lead）一定会有一个字在动 —— 别的行可以偶尔安静；
     有的字一直动，有 35% 的字动一下就停住 —— 像一屋子里不同的人。
     英文按“整词”动（一个词一个动点），词不会从中间被拆开。 */

  function zgSeed(b, n) {
    return XR.Engine.hash(String(b.text).slice(0, 28) + '|' + n + '|' + S.animSalt);
  }

  // 跳词 / 搜索命中 / 自定义样式盖住的地方不动字：不然字一动，底色就被撕开
  function blockedRanges(marks, hit, styles) {
    const out = [];
    for (const m of (marks || [])) out.push([m.start, m.end]);
    if (hit) out.push([hit.start, hit.end]);
    const st = styles || [];
    for (let i = 0; i < st.length; i++) {
      if (!st[i]) continue;
      let j = i + 1;
      while (j < st.length && st[j] === st[i]) j++;
      out.push([i, j]);
      i = j - 1;
    }
    return out;
  }

  function pickZg(b, display, blocked) {
    if (!S.settings.jump) return {};
    if (!b || b.kind !== 'line') return {};
    const text = String(display == null ? b.text : display);
    return XR.Motion.planLine(text, {
      level: S.settings.jump,
      lead: !!b.lead,
      tone: b.tone,
      style: b.style,
      blocked: blocked,
      seed: (n) => zgSeed(b, n)
    });
  }

  // 拆成可以独立移动的块：只给卡页的大字用（正文走逐字活字）
  function chunkify(str) {
    const out = [];
    for (const p of String(str).split(/(\s+)/)) {
      if (!p) continue;
      if (/^\s+$/.test(p)) { out.push({ t: p, space: true }); continue; }
      if (/[A-Za-z]/.test(p) && p.length <= 26) { out.push({ t: p }); continue; }
      const chars = Array.from(p);
      for (let i = 0; i < chars.length; i += 3) out.push({ t: chars.slice(i, i + 3).join('') });
    }
    return out;
  }

  const WV_MOVES = ['bob', 'bob', 'nod', 'hop', 'sway', 'glow'];

  function waveHTML(str, seq) {
    let s = '';
    let n = 0;
    for (const c of chunkify(str)) {
      if (c.space) { s += c.t; continue; }
      const pick = WV_MOVES[Math.floor(XR.Engine.hash('wv|' + c.t + '|' + n) * WV_MOVES.length)] || 'bob';
      n++;
      s += '<span class="wv" data-m="' + pick + '" style="--i:' + (seq.n++) + '">' + esc(c.t) + '</span>';
    }
    return s;
  }

  // 词义动作：写成什么就演什么（字典在 engine.js 里，见 verbFor）
  const verbFor = (w) => XR.Engine.verbFor(w);

  // 用户规则只改“显示出来的字”：替换 + 样式在这里算一次，重绘时按 rulesVer / _hit 复用
  function prepared(b) {
    if (!b || b.kind !== 'line') return { text: '', marks: [], hit: null, spans: [], styleAt: [] };
    if (b._prep && b._prepKey === S.rulesVer && b._prepHit === b._hit) return b._prep;
    const prep = XR.Engine.prepareLine(b.text || '', b.marks || [], b._hit || null, S.rules);
    b._prep = prep;
    b._prepKey = S.rulesVer;
    b._prepHit = b._hit;
    return prep;
  }

  // 跳词的样子：红点 / 一道扫过的光 / 底色呼吸，同一个词永远是同一种
  function kwStyle(word) {
    const v = XR.Engine.hash('mk|' + String(word));
    return v < 0.45 ? 'dot' : v < 0.76 ? 'sweep' : 'breathe';
  }

  // 段落入场：上浮 / 淡入 / 去模糊 / 微微放大，一段一种
  const ENTERS = ['rise', 'rise', 'fade', 'blur', 'zoom'];
  function beatEnter(b) {
    const v = XR.Engine.hash('in|' + String(b.text || '').slice(0, 24));
    return ENTERS[Math.floor(v * ENTERS.length)] || 'rise';
  }

  function inlineHTML(b, typed, prep) {
    const muted = mood().mute;
    const p = prep || prepared(b);
    const marks = muted ? [] : (p.marks || []);
    const hit = p.hit || null;
    const styles = p.styleAt || [];
    const text = p.text;
    const blocked = blockedRanges(marks, hit, styles);
    const zgs = muted ? {} : pickZg(b, text, blocked);
    const seq = { n: 0 };
    let out = '';
    let last = 0;

    // 一个字：换行、转义、逐字显影的 .ch 都在这儿
    const chHTML = (i) => {
      const ch = text[i];
      if (ch === '\n') return '<br>';
      const h = esc(ch);
      return typed ? '<span class="ch" style="--i:' + (seq.n++) + '">' + h + '</span>' : h;
    };

    // 一个动点：中文是一个字，英文是一个整词 —— 整词包一层 .zg，词不会从中间断开
    const zspan = (z, inner) =>
      '<span class="zg" data-m="' + z.m + '" data-once="' + (z.once ? '1' : '0') + '"' +
      ' style="--amp:' + z.amp + ';--dur:' + z.dur + 's;--ph:' + z.ph + 's">' + inner + '</span>';

    // 按“样式 / 搜索高亮”切段，整段只套一层外层，省 DOM 也更稳
    const charsHTML = (from, to) => {
      let s = '';
      let k = from;
      while (k < to) {
        const z = zgs[k];
        if (z && z.end > k && z.end <= to) {
          let inner = '';
          for (let q = k; q < z.end; q++) inner += chHTML(q);
          s += zspan(z, inner);
          k = z.end;
        } else {
          s += chHTML(k);
          k++;
        }
      }
      return s;
    };

    const groupHTML = (from, to) => {
      let s = '';
      let i = from;
      while (i < to) {
        const st = styles[i] || '';
        const inHit = !!hit && i >= hit.start && i < hit.end;
        let j = i + 1;
        while (j < to) {
          const sameHit = !!hit && j >= hit.start && j < hit.end;
          if ((styles[j] || '') !== st || sameHit !== inHit) break;
          j++;
        }
        let inner = charsHTML(i, j);
        if (inHit) inner = '<mark class="hit">' + inner + '</mark>';
        if (st) inner = '<span class="rx" data-style="' + st + '">' + inner + '</span>';
        s += inner;
        i = j;
      }
      return s;
    };

    for (const m of marks) {
      if (m.start < last || m.start >= text.length) continue;
      out += groupHTML(last, m.start);
      const from = Math.max(0, m.start);
      const to = Math.min(text.length, m.end);
      const word = String(m.word || text.slice(from, to));
      const verb = verbFor(word);
      // 跳词自己是“会呼吸的一块”：整块轻轻晃/发光，字不再单独拆开动，
      // 这样底色永远贴着字，不会出现“字飘走了、底色留在原地”
      const inner = charsHTML(from, to);
      const mv = XR.Motion.pickWordMove(word, XR.Engine.hash('mv|' + word));
      let kw = '<span class="kw" role="button" tabindex="0" data-word="' + escAttr(word) + '"' +
        ' data-mk="' + kwStyle(word) + '"' +
        (mv ? ' data-mv="' + mv + '"' : '') +
        (verb ? ' data-verb="' + verb + '"' : '') + '>' +
        (verb ? '<span class="v">' + inner + '</span>' : inner) + '</span>';
      if (hit && m.start < hit.end && m.end > hit.start) kw = '<mark class="hit">' + kw + '</mark>';
      const st = styles[m.start] || '';
      if (st) kw = '<span class="rx" data-style="' + st + '">' + kw + '</span>';
      out += kw;
      last = Math.min(text.length, m.end);
    }
    out += groupHTML(last, text.length);
    return out;
  }

  function goBack() {
    // 自己动手往回翻 = 接管控制：自动播放收起来，按钮也别再亮着
    if (S.auto) setAuto(false);
    if (S.allShown) {
      if (!D.gateLayer.hidden) { closeGate(); return; }
      S.ended = false;
      if (!D.choiceLayer.hidden) { D.choiceLayer.hidden = true; D.choiceLayer.innerHTML = ''; }
      // 已经在章首了再往回退：翻回上一章的末尾，而不是卡死在第一章
      if (D.stage.scrollTop <= 2) { backToPrevChapter(); return; }
      D.stage.scrollTop = Math.max(0, D.stage.scrollTop - D.stage.clientHeight * 0.82);
      updateChrome();
      return;
    }
    if (S.index < 0) return;
    stopAuto();
    closeAll();
    S.ended = false;
    if (S.index <= 0) {
      // 章首再退一句 = 上一章最后一句
      if (S.chapterIndex > 0 && backToPrevChapter()) {
        updateChrome();
        saveProgress();
      } else {
        loadChapter(S.chapterIndex, -1);
      }
      return;
    }
    S.index--;
    const b = S.beats[S.index];
    // 被沉浸模式裁掉的旧句：重新铺到这一句，而不是硬删一个节点
    if (!b || !beatElOf(b)) {
      loadChapter(S.chapterIndex, S.index);
      updateChrome();
      saveProgress();
      return;
    }
    const nodes = D.beats.querySelectorAll('.beat');
    const lastNode = nodes[nodes.length - 1];
    if (lastNode) lastNode.remove();
    if (S.immersive) {
      arrangeImmersive();
      centerImmersive(true);
    } else {
      const prev = D.beats.querySelector('.beat:last-child');
      if (prev) prev.classList.remove('past');
    }
    updateChrome();
    saveProgress();
  }

  function updateChrome() {
    if (!S.book) return;
    const ch = S.book.chapters[S.chapterIndex] || { title: '' };
    if (S.story.current) {
      D.chapterTitle.textContent = '番外 · ' + (S.story.current.title || '');
    } else {
      D.chapterTitle.textContent = '第 ' + (S.chapterIndex + 1) + ' / ' + S.book.chapters.length + ' 章 · ' + stripChapterNo(ch.title);
    }

    let pct;
    if (S.allShown) {
      const max = D.stage.scrollHeight - D.stage.clientHeight;
      pct = max > 6 ? (D.stage.scrollTop / max) * 100 : 100;
      if (S.ended) pct = 100;
    } else {
      pct = S.beats.length ? ((S.index + 1) / S.beats.length) * 100 : 0;
    }
    pct = Math.max(0, Math.min(100, pct));
    D.progressBar.style.width = pct.toFixed(1) + '%';
    if (D.progressKnob) D.progressKnob.style.left = pct.toFixed(1) + '%';
  }

  /* ============================================================
     进度条：拖一下就能跳到本章任意位置
     ============================================================ */
  function ratioFromEvent(e) {
    const r = D.progressTrack.getBoundingClientRect();
    if (!r.width) return 0;
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  function previewSeek(ratio, clientX) {
    const pct = Math.round(ratio * 100);
    let label = pct + '%';
    if (!S.allShown && S.beats.length) {
      const idx = Math.min(S.beats.length - 1, Math.floor(ratio * S.beats.length));
      let total = 0;
      let upto = 0;
      for (let i = 0; i < S.beats.length; i++) {
        if (S.beats[i].kind !== 'line') continue;
        total++;
        if (i <= idx) upto++;
      }
      const unit = S.settings.granularity === 'paragraph' ? '段' : '句';
      label = pct + '% · 第 ' + Math.max(1, upto) + ' / ' + Math.max(1, total) + ' ' + unit;
    }
    D.progressTip.textContent = label;
    D.progressTip.hidden = false;
    D.progressTrack.classList.add('scrubbing');
    const r = D.progressTrack.getBoundingClientRect();
    D.progressTip.style.left = Math.max(24, Math.min(r.width - 24, clientX - r.left)) + 'px';
    D.progressKnob.style.left = (ratio * 100).toFixed(1) + '%';
  }

  function commitSeek(ratio) {
    D.progressTip.hidden = true;
    D.progressTrack.classList.remove('scrubbing');
    if (!S.book) return;
    S.ended = false;
    // 自己拖了进度条：让自动播放从新位置、隔一拍再走
    if (S.auto) { S.autoGlide = null; S.autoStepAt = performance.now() + autoWait(); }
    if (S.allShown) {
      const max = D.stage.scrollHeight - D.stage.clientHeight;
      D.stage.scrollTop = ratio * Math.max(0, max);
      updateChrome();
      saveProgress();
      return;
    }
    const idx = Math.max(0, Math.min(S.beats.length - 1, Math.round(ratio * S.beats.length) - 1));
    loadChapter(S.chapterIndex, idx);
  }

  /* ============================================================
     存档
     ============================================================ */
  function saveProgress() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveProgressNow, 450);
  }
  function saveProgressNow() {
    if (!S.book) return;
    if (S.story.current) return;   // 分支阅读不覆盖主线进度
    if (S.beats.length) {
      let idx = Math.max(0, S.index);
      if (S.allShown) {
        const max = D.stage.scrollHeight - D.stage.clientHeight;
        const ratio = max > 6 ? D.stage.scrollTop / max : 1;
        idx = Math.round(ratio * Math.max(0, S.beats.length - 1));
      }
      const ratio = Math.min(1, (idx + 1) / S.beats.length);
      S.seen[S.chapterIndex] = Math.max(S.seen[S.chapterIndex] || 0, ratio);
      XR.Store.saveProgress(S.book.id, {
        chapterIndex: S.chapterIndex,
        index: idx,
        beats: S.beats.length,
        seen: S.seen
      });
      maybeGoal();
      return;
    }
    XR.Store.saveProgress(S.book.id, {
      chapterIndex: S.chapterIndex,
      index: 0,
      beats: 0,
      seen: S.seen
    });
    maybeGoal();
  }

  /* ============================================================
     回声簿
     ============================================================ */
  function nbKey() {
    return 'nb.' + (S.book ? S.book.id : 'none');
  }
  function loadNotebook() {
    try {
      S.notebook = JSON.parse(XR.Store.getFlag(nbKey()) || '{}') || {};
    } catch (e) {
      S.notebook = {};
    }
  }
  function rememberWord(word) {
    if (!S.book) return;
    const item = S.notebook[word] || { n: 0, ch: S.chapterIndex };
    item.n += 1;
    S.notebook[word] = item;
    XR.Store.setFlag(nbKey(), JSON.stringify(S.notebook));
  }

  /* ============================================================
     回声
     ============================================================ */
  let echoState = null;

  // 整条太长、书里只出现一次时，退到更短的核心词再找 —— 页面上的字不动，只是查得更宽
  function echoOf(word, curText) {
    const b = S.beats[S.index];
    const cur = typeof curText === 'string' ? curText : (b ? b.text : '');
    let res = XR.Engine.findEcho(S.book, word, S.chapterIndex, cur);
    if (res.refs.length) { res.asked = word; return res; }
    const keys = XR.Engine.echoKeys(word);
    for (let i = 1; i < keys.length && i <= 4; i++) {
      const r2 = XR.Engine.findEcho(S.book, keys[i], S.chapterIndex, cur);
      if (r2.refs.length) { r2.asked = word; return r2; }
    }
    res.asked = word;
    return res;
  }

  // 这个词是点在哪一行上的 —— 回声要排除“当前这一句”，阅读模式下 S.index 是章尾，不能拿它当当前句
  function beatTextOf(el) {
    const beat = el && el.closest ? el.closest('.beat') : null;
    if (!beat) return '';
    if (beat._beat && beat._beat.text) return beat._beat.text;
    return String(beat.textContent || '');
  }

  function wordLenClass(w) {
    const n = Array.from(String(w || '')).length;
    return n <= 3 ? 'short' : n <= 5 ? 'mid' : n <= 8 ? 'long' : 'xlong';
  }

  function openEcho(word, curText) {
    D.toast.classList.remove('show');
    rememberWord(word);
    const res = echoOf(word, curText);
    if (!res.refs.length) {
      echoState = { res, i: -1 };
      D.wordLayer.innerHTML =
        '<div class="sheet">' +
        '<div class="echo-head"><span class="echo-word" data-len="' + wordLenClass(word) + '">' + esc(word) + '</span>' +
        '<span class="echo-count">全书只出现 ' + res.count + ' 次</span></div>' +
        '<p class="echo-quote">它只在这里出现过一次 —— 没有别处可以呼应。</p>' +
        '<div class="echo-actions"><button class="btn primary small" data-act="echo-close">继续</button></div></div>';
      D.wordLayer.hidden = false;
      return;
    }
    echoState = { res, i: 0 };
    paintEcho();
    D.wordLayer.hidden = false;
  }

  function paintEcho() {
    const { res, i } = echoState;
    const ref = res.refs[i];
    const hi = highlight(ref.text, res.word);
    const narrowed = res.asked && res.asked !== res.word
      ? '<span class="echo-narrow">从「' + esc(res.asked) + '」里找的</span>'
      : '';
    D.wordLayer.innerHTML =
      '<div class="sheet">' +
      '<div class="echo-head"><span class="echo-word" data-len="' + wordLenClass(res.word) + '">' + esc(res.word) + '</span>' +
      '<span class="echo-count">全书出现 ' + res.count + ' 次 · 这是别处的一次回声</span></div>' +
      (narrowed ? '<div class="echo-narrow-line">' + narrowed + '</div>' : '') +
      '<p class="echo-quote">' + hi + '</p>' +
      '<div class="echo-from">—— ' + esc(ref.chapterTitle) + '</div>' +
      '<div class="echo-actions">' +
      (res.refs.length > 1 ? '<button class="btn ghost small" data-act="echo-next">换个地方</button>' : '') +
      '<button class="btn primary small" data-act="echo-close">继续</button>' +
      '</div></div>';
  }

  function highlight(text, word) {
    const i = text.indexOf(word);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(word) + '</mark>' + esc(text.slice(i + word.length));
  }

  /* ============================================================
     划词
     ============================================================ */
  function handleSelection() {
    if (S.view !== 'reader') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { hideChip(); return; }
    let word = String(sel.toString()).replace(/\s+/g, '').trim();
    // 拖选了一整句也只取开头那一条 2~10 字的「文字条」，回声卡上不该是一句话
    if (word.length > 10) {
      word = word.slice(0, 10).replace(/[，。！？；：、…—～·"'“”‘’「」『』（）()[\]{}<>《》]+$/, '');
    }
    if (word.length < 2 || word.length > 10) { hideChip(); return; }
    if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(word)) { hideChip(); return; }
    const range = sel.getRangeAt(0);
    if (!D.stage.contains(range.commonAncestorContainer)) { hideChip(); return; }

    let rect;
    try { rect = range.getBoundingClientRect(); } catch (e) { return; }
    if (!rect || (!rect.width && !rect.height)) return;

    D.selChip.hidden = false;
    D.selChip.dataset.word = word;
    const host = range.startContainer && (range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer.parentElement);
    const beatEl = host && host.closest ? host.closest('.beat') : null;
    D.selChip.dataset.cur = beatEl ? beatTextOf(beatEl) : '';
    const w = 108;
    D.selChip.style.left = Math.max(10, Math.min(window.innerWidth - w - 10, rect.left + rect.width / 2 - w / 2)) + 'px';
    D.selChip.style.top = Math.min(window.innerHeight - 70, rect.bottom + 12) + 'px';
  }

  function hideChip() {
    D.selChip.hidden = true;
  }

  function clearSelection() {
    try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
    dropSelectMode();
  }

  // 同一章每次重绘都抽到同一批词：换章、换书、重开会换一套，但切设置时不会突然全变
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function chapterRnd(ci) {
    const key = (S.book ? S.book.id : '') + '|' + ci + '|' + (S.bookSalt || '0');
    return mulberry(Math.floor(XR.Engine.hash(key) * 4294967296));
  }

  /* ============================================================
     选字：只有“长按”才选中，点一下 / 双击 / 拖动都算继续
     ============================================================ */
  const PRESS_MS = 460;
  let press = null;

  function enterSelectMode() {
    S.selOn = true;
    D.beats.classList.add('sel-on');
  }
  function dropSelectMode() {
    S.selOn = false;
    D.beats.classList.remove('sel-on');
  }

  function onSelectStart(e) {
    if (S.selOn) return;
    const t = e.target;
    if (t && t.closest && t.closest('#stage')) e.preventDefault();
  }

  function caretRangeAt(x, y) {
    if (document.caretRangeFromPoint) {
      try { return document.caretRangeFromPoint(x, y); } catch (e) { /* ignore */ }
    }
    if (document.caretPositionFromPoint) {
      try {
        const p = document.caretPositionFromPoint(x, y);
        if (!p) return null;
        const r = document.createRange();
        r.setStart(p.offsetNode, p.offset);
        r.collapse(true);
        return r;
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  // 正文被切成了很多小块，一个 text node 可能只有两三个字：
  // 先把整行拉平成一条字符串，再决定选哪几个字，最后映射回节点
  function textNodesIn(root) {
    const out = [];
    if (!root) return out;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let t;
    while ((t = walker.nextNode())) if (t.data) out.push(t);
    return out;
  }

  const SEL_PUNCT = /[\s，。！？；：、…—～·"'“”‘’「」『』（）()[\]{}<>《》]/;

  // 选中的是「文字条」：2~10 个字、整块（马尔福家 不会只剩 福家）、不盖满整行。
  // 规则在 engine.js 的 expandSpan 里，这里只把拉平的字符串和节点映射起来。
  function wordSpanAt(node, off) {
    if (!node || node.nodeType !== 3) return null;
    const host = (node.parentNode && node.parentNode.closest && node.parentNode.closest('.ln')) || node.parentNode;
    if (!host) return null;
    const nodes = textNodesIn(host);
    if (!nodes.length) return null;
    let flat = '';
    const map = [];
    for (const t of nodes) {
      map.push({ t, s: flat.length, e: flat.length + t.data.length });
      flat += t.data;
    }
    const me = map.find((x) => x.t === node);
    if (!me) return null;
    let p = me.s + Math.max(0, Math.min(off, node.data.length));
    while (p < flat.length && /\s/.test(flat[p])) p++;
    if (p >= flat.length) return null;
    if (SEL_PUNCT.test(flat[p]) && p + 1 < flat.length) p++;

    const sp = XR.Engine.expandSpan(flat, { start: p, end: p + 1, word: flat[p] }, Math.random);
    if (!sp) return null;
    const s = sp.start;
    const e = sp.end;
    if (e - s < 2) return null;

    const at = (pos) => {
      for (const x of map) {
        if (pos >= x.s && pos <= x.e) return { node: x.t, off: Math.min(x.t.data.length, pos - x.s) };
      }
      const last = map[map.length - 1];
      return { node: last.t, off: last.t.data.length };
    };
    const A = at(s);
    const B = at(e);
    return { startNode: A.node, startOff: A.off, endNode: B.node, endOff: B.off, text: flat.slice(s, e) };
  }

  function setSel(sp) {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStart(sp.startNode, sp.startOff);
    r.setEnd(sp.endNode, sp.endOff);
    sel.addRange(r);
  }

  function beginSelect(p) {
    if (!p || press !== p) return;
    const r = caretRangeAt(p.x, p.y);
    if (!r) return;
    const sp = wordSpanAt(r.startContainer, r.startOffset);
    if (!sp) return;
    p.long = true;
    p.anchor = { node: sp.startNode, offset: sp.startOff };
    enterSelectMode();
    setSel(sp);
    S.ignoreClickUntil = performance.now() + 900;
    if (!XR.Store.getFlag('selhint')) {
      XR.Store.setFlag('selhint', 1);
      toast('长按选中了 · Ctrl+C 复制 · 按住拖一下可以选更多');
    }
  }

  function pressDown(e) {
    if (press) return;
    if (e.button != null && e.button !== 0) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('button, a, input, select, textarea, .progress, .drawer, .layer, .sel-chip, .toast, .crash')) return;
    if (!D.stage.contains(t) && t !== D.stage) return;
    if (!D.gateLayer.hidden || !D.wordLayer.hidden) return;
    // 手一按住就别再推了：长按选字的时候页面不能自己往下走
    if (S.auto && S.autoGlide) { S.autoGlide = null; S.autoStepAt = performance.now() + autoWait(); }
    dropSelectMode();
    press = { x: e.clientX, y: e.clientY, long: false, timer: 0, anchor: null, raf: 0 };
    press.timer = setTimeout(() => beginSelect(press), PRESS_MS);
  }

  function pressMove(e) {
    const p = press;
    if (!p) return;
    if (!p.long) {
      // 手指/鼠标挪了，那是滚动或者拖拽，不选字
      if (Math.abs(e.clientX - p.x) > 12 || Math.abs(e.clientY - p.y) > 12) {
        clearTimeout(p.timer);
        press = null;
      }
      return;
    }
    if (!p.anchor) return;
    const r = caretRangeAt(e.clientX, e.clientY);
    if (!r || !r.startContainer || !D.beats.contains(r.startContainer)) return;
    try {
      window.getSelection().setBaseAndExtent(p.anchor.node, p.anchor.offset, r.startContainer, r.startOffset);
    } catch (err) { /* ignore */ }
    if (!p.raf) {
      p.raf = requestAnimationFrame(() => {
        p.raf = 0;
        handleSelection();
      });
    }
  }

  function pressUp() {
    const p = press;
    press = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.long) return;
    S.ignoreClickUntil = performance.now() + 250;
    setTimeout(handleSelection, 20);
  }

  function pressCancel() {
    const p = press;
    press = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (p.long) setTimeout(handleSelection, 20);
  }

  /* ============================================================
     卡页：读到某处，整页跳出来一张卡，点一下才继续
     ============================================================ */
  function openGate(g, preview) {
    g.done = true;
    S.gateOpen = g;
    S.gatePlay = !S.allShown && !preview;
    stopAuto();
    D.toast.classList.remove('show');
    hideChip();          // 卡页盖满屏的时候，“回声”小按钮别飘在卡上面
    const b = g.beat;
    const chTitle = stripChapterNo((S.book.chapters[S.chapterIndex] || {}).title || '');
    const where = '第 ' + (S.chapterIndex + 1) + ' 章' + (chTitle ? ' · ' + esc(chTitle) : '');
    const pct = readPercent();
    let body;
    if (b.variant === 'word') {
      const res = echoOf(b.word, b.text || '');
      const ref = res.refs[0];
      const kicker = res.count > 1
        ? '这个词在书里出现 ' + res.count + ' 次'
        : '这个词只在这里出现一次';
      const wl = Array.from(String(b.word)).length;
      const wlen = wl <= 3 ? 'short' : wl <= 6 ? 'mid' : wl <= 10 ? 'long' : 'xlong';
      body =
        '<div class="gate-kicker">' + kicker + ' · 读到 ' + pct + '%</div>' +
        '<div class="gate-word" data-len="' + wlen + '">' + waveHTML(b.word, { n: 0 }) + '</div>' +
        '<span class="gate-rule"></span>' +
        (b.text
          ? '<p class="gate-quote">' + highlight(b.text, b.word) + '</p>' +
            '<div class="echo-from">—— ' + where + '</div>'
          : '<p class="gate-sub">这一处只有它自己。</p>') +
        (ref
          ? '<div class="gate-echo"><b>别处：</b>' + highlight(ref.text, res.word) +
            ' <i>' + esc(ref.chapterTitle) + '</i></div>'
          : '');
    } else {
      body =
        '<div class="gate-kicker">停一下 · ' + where + ' · 读到 ' + pct + '%</div>' +
        '<p class="gate-quote big">' + waveHTML(b.text, { n: 0 }) + '</p>';
    }
    D.gateLayer.innerHTML =
      '<div class="gate-card" role="dialog" aria-label="卡页">' + body +
      '<div class="gate-foot"><span class="gate-tap">轻点任意处继续</span>' +
      '<span class="gate-key">空格 / Esc</span></div></div>';
    D.gateLayer.hidden = false;
    document.body.classList.add('gate-open');
  }

  function readPercent() {
    // 逐句读的时候没有“滚动位置”，按句号算进度，别让卡上写着 100%
    if (!S.allShown && S.beats.length) {
      return Math.round(Math.max(0, Math.min(1, (S.index + 1) / S.beats.length)) * 100);
    }
    const st = D.stage;
    const max = st.scrollHeight - st.clientHeight;
    if (max <= 6) return 100;
    return Math.round(Math.max(0, Math.min(1, st.scrollTop / max)) * 100);
  }

  function closeGate() {
    if (D.gateLayer.hidden) return;
    D.gateLayer.hidden = true;
    D.gateLayer.innerHTML = '';
    document.body.classList.remove('gate-open');
    S.gateOpen = null;
    S.gateCool = performance.now() + 600;
    S.gateCoolClick = performance.now() + 250;
    saveProgress();
    // 卡页本来就是剧情里的一停：空章也别让自动播放断在这里
    if (S.gatePlay) {
      S.gatePlay = false;
      advance(true);
      return;
    }
    // 关掉卡以后先给人喘一口气，再接着往下推
    S.autoChapterAt = performance.now() + 900;
    maybeResumeAuto();
  }

  /* 设置里的「现在就弹一张看看」：拿屏幕正中间那行现做一张，不占用真正埋好的卡 */
  function lineAtCenter() {
    const st = D.stage;
    const rect = st.getBoundingClientRect();
    const mid = st.scrollTop + st.clientHeight * 0.5;
    let best = null;
    let bestD = Infinity;
    for (const el of D.beats.querySelectorAll('.beat')) {
      const b = el._beat;
      if (!b || b.kind !== 'line' || !b.text) continue;
      const top = el.getBoundingClientRect().top - rect.top + st.scrollTop;
      const d = Math.abs(top + el.offsetHeight * 0.5 - mid);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  function previewGate() {
    closeDrawer();
    stopAuto();
    const b = lineAtCenter();
    if (!b) { toast('这一章还没有能做成卡的正文'); return; }
    const mark = (b.marks || []).find((m) => XR.Engine.gateWordOk(m.word));
    const beat = mark
      ? { kind: 'gate', variant: 'word', word: mark.word, text: XR.Engine.quoteOf(b.text, 120), style: b.style }
      : { kind: 'gate', variant: 'quote', word: '', text: XR.Engine.quoteOf(b.text, 140), style: b.style };
    openGate({ el: null, beat, done: true }, true);
  }

  // 卡页的绝对位置（相对滚动了多少）
  function gateTop(g) {
    const st = D.stage;
    return g.el.getBoundingClientRect().top - st.getBoundingClientRect().top + st.scrollTop;
  }

  // 用“越线检测”：只要视窗中线越过了卡页，就弹。翻得再快也不会漏。
  function checkGates() {
    if (!S.allShown || !S.gates.length || !S.book || S.ended) return;
    if (!S.gateArmed) return;
    if (!D.gateLayer.hidden) return;
    if (!D.wordLayer.hidden || !D.choiceLayer.hidden || !D.settings.hidden) return;
    if (performance.now() < S.gateCool) return;
    const st = D.stage;
    const center = st.scrollTop + st.clientHeight * 0.5;
    for (const g of S.gates) {
      if (g.done) continue;
      const top = gateTop(g);
      // 已经很远地翻过去了（跳章、拖进度条），不回头补弹
      if (top < center - st.clientHeight * 2.4) { g.done = true; continue; }
      if (center >= top - 6) { openGate(g); return; }
    }
  }

  // 已经读到章尾、还有一张卡没弹过：先把它弹出来，别让它跟着本章一起被跳过。
  // 这里用 gateCoolClick（只由“刚关掉一张卡”设置），不受“刚进这一章”的冷却影响：
  // 一章只有一屏的书，读完点一下就该看到卡，而不是直接被翻到本章完。
  function tryLooseGate() {
    if (!S.allShown || S.ended || !S.gates.length) return false;
    if (!D.gateLayer.hidden || !D.wordLayer.hidden || !D.choiceLayer.hidden || !D.settings.hidden) return false;
    if (performance.now() < S.gateCoolClick) return false;
    const st = D.stage;
    const limit = st.scrollTop + st.clientHeight * 1.1;
    for (const g of S.gates) {
      if (g.done) continue;
      if (gateTop(g) > limit) return false;
      openGate(g);
      return true;
    }
    return false;
  }

  /* ============================================================
     章末：直接进下一章，不确认
     ============================================================ */
  // 正文非空的章才算“能读”；只有图片的章也算（图片是以标记写进 text 的）
  function chapterHasText(i) {
    const c = S.book && S.book.chapters ? S.book.chapters[i] : null;
    if (!c) return false;
    const t = String(c.text || '');
    return t.trim().length > 0 || /\u0001IMG:/.test(t);
  }

  function nextReadableChapter(from) {
    if (!S.book) return -1;
    for (let i = Math.max(0, from + 1); i < S.book.chapters.length; i++) {
      if (chapterHasText(i)) return i;
    }
    return -1;
  }

  function prevReadableChapter(from) {
    if (!S.book) return -1;
    for (let i = Math.min(from - 1, S.book.chapters.length - 1); i >= 0; i--) {
      if (chapterHasText(i)) return i;
    }
    return -1;
  }

  // 换章的唯一入口：读到章末、往下滚到底、点「继续」都走这里。
  // 不弹层、不等确认；自动播放跨章继续（loadChapter 末尾会自己接上）。
  function autoNext() {
    if (!S.book || !S.beats.length) return false;
    const next = nextReadableChapter(S.chapterIndex);
    if (next < 0) return false;
    saveProgressNow();
    closeAll();
    S.story = { stack: [], current: null };
    S.storyOverride = null;
    loadChapter(next, -1, true);
    toast('第 ' + (next + 1) + ' 章 · ' + stripChapterNo(S.book.chapters[next].title));
    return true;
  }

  // 章首往回退：回到上一章的末尾（像顺着书页往回翻）
  function backToPrevChapter() {
    if (!S.book) return false;
    const prev = prevReadableChapter(S.chapterIndex);
    if (prev < 0) return false;
    closeAll();
    loadChapter(prev, -1, true);
    if (S.allShown) {
      D.stage.scrollTop = D.stage.scrollHeight;
      updateChrome();
      saveProgressNow();
    } else {
      loadChapter(prev, Math.max(0, S.beats.length - 1));
    }
    return true;
  }

  /* ============================================================
     自动播放：一个状态，两种走法
     - 逐句 / 沉浸：每隔「间隔」秒往下走一句
     - 阅读模式：每隔「间隔」秒把下一句推到视口顶上，像有人替你往下推纸
     设置 / 卡页 / 回声只是暂停，关掉会自己接着走；跨章不断。
     ============================================================ */
  function autoSpeed() {
    const v = Number(S.settings && S.settings.autoSpeed);
    return Number.isFinite(v) ? Math.max(0.8, Math.min(8, v)) : 2.6;
  }
  function autoWait() { return Math.round(autoSpeed() * 1000); }

  function syncAutoBtn() {
    D.btnAuto.classList.toggle('on', S.auto);
    D.btnAuto.textContent = S.auto ? '❚❚' : '▷';
    D.btnAuto.title = S.auto ? '停止自动播放（A）' : '自动播放（A）';
    D.btnAuto.setAttribute('aria-label', S.auto ? '停止自动播放' : '自动播放');
  }

  // 真正关掉：状态、按钮、计时器一起收，免得按钮亮着却不动
  function setAuto(on) {
    S.auto = !!on;
    stopAuto();
    syncAutoBtn();
  }

  // 浮层关掉、换完章、改完设置：该接着走就接着走
  function maybeResumeAuto() {
    if (!S.auto || S.ended || !S.book || S.view !== 'reader') return;
    if (!D.settings.hidden || !D.gateLayer.hidden || !D.wordLayer.hidden || !D.choiceLayer.hidden) return;
    resumeAuto();
  }

  function resumeAuto() {
    if (!S.auto || !S.book || S.ended) return;
    stopAuto();
    if (S.allShown) startAutoScroll();
    else scheduleAuto();
  }

  /* ============================================================
     章节结束：整本书读完了才停一下
     ============================================================ */
  function showBookEnd() {
    if (S.ended) return;
    S.ended = true;
    D.toast.classList.remove('show');
    setAuto(false);
    companionSay('goal-book', { title: S.book ? S.book.title : '' });
    D.choiceLayer.innerHTML =
      '<div class="sheet">' +
      '<p class="choice-prompt">全书完</p>' +
      '<p class="choice-sub">你已经读到最后一句了。</p>' +
      '<div class="choice-opts">' +
      '<button class="choice-opt" data-act="chapters"><span class="co-idx">☰</span><span class="co-txt">打开目录</span></button>' +
      '<button class="choice-opt" data-act="restart"><span class="co-idx">↺</span><span class="co-txt">重读本章</span></button>' +
      '<button class="choice-opt" data-act="shelf"><span class="co-idx">⌂</span><span class="co-txt">回到书架</span></button>' +
      '</div>' +
      '<p class="sheet-hint">轻点空白处或按空格收起</p>' +
      '</div>';
    D.choiceLayer.hidden = false;
    S.index = S.beats.length;
    updateChrome();
    saveProgressNow();
  }

  /* ============================================================
     守卷人「阿泠」 + 分支剧情
     ============================================================ */
  const SCENE_THROTTLE = { resume: 15000, interrupt: 15000, 'idle-chat': 4000 };
  let bubbleTimer = 0;

  function companionSay(scene, ctx) {
    const t = Date.now();
    const th = SCENE_THROTTLE[scene] || 0;
    if (th && S.lastScene[scene] && t - S.lastScene[scene] < th) return;
    S.lastScene[scene] = t;
    if (!S.companion) S.companion = XR.Companion.defaultState();
    const res = XR.Companion.pick(scene, S.companion, ctx || {}, Math.random);
    S.companion = XR.Companion.applyDelta(S.companion, res);
    XR.Store.saveCompanion(S.companion);
    showCompanionBubble(res.text);
  }

  function showCompanionBubble(text) {
    if (!D.companionBubble) return;
    // 抽屉开着的时候别盖住设置面板，等关掉再说
    if (!D.settings.hidden) return;
    D.companionBubble.innerHTML =
      '<span class="cb-name">阿泠 · 守卷人</span>' +
      '<span class="cb-text">' + esc(text) + '</span>';
    D.companionBubble.hidden = false;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { if (D.companionBubble) D.companionBubble.hidden = true; }, 5600);
  }

  function moodLabel() {
    const m = (S.companion && S.companion.mood) || {};
    const aff = S.companion ? S.companion.affinity : 0;
    let word = '平和';
    if ((m.mischief || 0) > 0.55) word = '俏皮';
    else if ((m.solemnity || 0) > 0.6) word = '庄重';
    else if ((m.warmth || 0) > 0.65) word = '温润';
    return word + ' · 亲近 ' + Math.round(aff);
  }

  function openCompanion(topic) {
    if (!S.companion) S.companion = XR.Companion.defaultState();
    const res = XR.Companion.chat(topic || '', S.companion, Math.random);
    S.companion = XR.Companion.applyDelta(S.companion, res);
    XR.Store.saveCompanion(S.companion);
    renderCompanionPanel(res);
  }

  function renderCompanionPanel(res) {
    const opts = res.options || [];
    D.companionPanel.innerHTML =
      '<div class="sheet">' +
      '<div class="cp-head"><span class="cp-name">阿泠</span><span class="cp-mood">' + esc(moodLabel()) + '</span></div>' +
      '<p class="cp-text">' + esc(res.text || '') + '</p>' +
      '<div class="cp-opts">' +
      (opts.length
        ? opts.map((o, i) => '<button class="cp-opt" data-act="companion-reply" data-i="' + i + '">' + esc(o.label) + '</button>').join('')
        : '<button class="cp-opt" data-act="companion-more">再聊一句</button>') +
      '</div>' +
      '<p class="cp-foot">守卷人在灯下陪你。轻点空白处收起。</p>' +
      '</div>';
    D.companionPanel.hidden = false;
    S.companionReply = opts;
  }

  function closeCompanionPanel() {
    if (!D.companionPanel) return;
    D.companionPanel.hidden = true;
    D.companionPanel.innerHTML = '';
  }

  /* 读完一章 / 达成全书进度里程碑 */
  function maybeGoal() {
    if (!S.book) return;
    const ci = S.chapterIndex;
    const r = S.seen[ci] || 0;
    if (r >= 0.98 && !S.milestones['ch' + ci]) {
      S.milestones['ch' + ci] = 1;
      companionSay('goal-chapter', { chapter: ci + 1, title: S.book.title });
    }
    const n = S.book.chapters.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += (S.seen[i] || 0);
    const pct = Math.round((sum / n) * 100);
    for (const m of [25, 50, 75]) {
      if (pct >= m && !S.milestones['pct' + m]) {
        S.milestones['pct' + m] = 1;
        companionSay('goal-pct', { pct: m, title: S.book.title });
        break;
      }
    }
  }

  /* 选择层：入口选择 / 分支收尾共用 */
  function openChoiceOptions(prompt, sub, opts, kind) {
    S.choiceKind = kind || '';
    S.choiceOptions = opts || [];
    D.choiceLayer.innerHTML =
      '<div class="sheet">' +
      '<p class="choice-prompt">' + esc(prompt) + '</p>' +
      '<p class="choice-sub">' + esc(sub || '') + '</p>' +
      '<div class="choice-opts">' +
      S.choiceOptions.map((o, i) =>
        '<button class="choice-opt" data-act="choice-pick" data-i="' + i + '">' +
        '<span class="co-idx">' + (i + 1) + '</span><span class="co-txt">' + esc(o.label) + '</span></button>').join('') +
      '</div>' +
      '<p class="sheet-hint">轻点空白处或按空格收起</p>' +
      '</div>';
    D.choiceLayer.hidden = false;
  }

  function closeChoiceLayer() {
    D.choiceLayer.hidden = true;
    D.choiceLayer.innerHTML = '';
    S.choiceKind = '';
    S.choiceOptions = null;
  }

  function openStoryChoice(b) {
    if (!b) return;
    companionSay('branch-entry', { title: S.book ? S.book.title : '', chapter: S.chapterIndex + 1 });
    openChoiceOptions('岔路', '这里有一条没走完的路。', b.options || [], 'entry');
  }

  function showStoryEnd() {
    if (S.ended) return;
    S.ended = true;
    setAuto(false);
    const story = S.story.current;
    const opts = (story && story.options && story.options.length)
      ? story.options
      : [{ label: '回到主线', goto: 'resume', target: null }];
    openChoiceOptions(story ? story.title : '番外', '这一段到这里。', opts, 'story-end');
  }

  function resolveChoice(opt) {
    if (!opt) return;
    if (opt.goto === 'story' && opt.target) {
      const story = (S.stories || []).find((s) => s.id === opt.target);
      if (story) { enterStory(story); return; }
    }
    if (opt.goto === 'chapter') {
      const ci = Math.max(0, Math.min(S.book.chapters.length - 1, Number(opt.target) || 0));
      S.story.current = null;
      S.story.stack = [];
      S.storyOverride = null;
      jumpChapter(ci);
      return;
    }
    // resume
    if (S.story.current) exitStory();
    else advance();
  }

  function enterStory(story) {
    if (!story) return;
    S.story.stack.push({
      chapterIndex: S.chapterIndex,
      index: Math.max(0, S.index),
      story: S.story.current || null
    });
    S.story.current = story;
    S.storyOverride = { title: story.title, text: story.text };
    loadChapter(S.chapterIndex, -1);
  }

  function exitStory() {
    const frame = S.story.stack.pop();
    S.story.current = frame && frame.story ? frame.story : null;
    S.storyOverride = S.story.current
      ? { title: S.story.current.title, text: S.story.current.text }
      : null;
    if (!frame) { loadChapter(S.chapterIndex, -1); return; }
    loadChapter(frame.chapterIndex, Math.max(0, (frame.index || 0) + 1));
  }

  /* 番外 / 分支列表 + 离线生成 */
  async function renderStoryList() {
    if (!S.book) { toast('先打开一本书'); return; }
    const list = await XR.Store.listStories(S.book.id);
    S.stories = list;
    const engineName = { offline: '离线生成', llm: 'AI 生成', local: '本地模型' };
    const items = list.map((s) => {
      const scope = s.scope === 'branch'
        ? '正文分支 · 第 ' + (s.parentChapterIndex + 1) + ' 章'
        : '番外';
      return '<div class="story-item">' +
        '<div class="si-title">' + esc(s.title) + '</div>' +
        '<div class="si-meta">' + esc(scope) + ' · ' + esc(engineName[s.engine] || s.engine || '离线生成') + '</div>' +
        '<div class="si-actions">' +
        '<button class="btn small" data-act="story-read" data-id="' + escAttr(s.id) + '">阅读</button>' +
        '<button class="btn small ghost" data-act="story-del" data-id="' + escAttr(s.id) + '">删除</button>' +
        '</div></div>';
    }).join('');

    D.settings.innerHTML =
      drawerHead('番外 · 分支') +
      '<div class="field"><div class="field-label"><span>生成新剧情</span><b>默认离线</b></div>' +
      '<textarea class="gen-area" id="genPrompt" placeholder="想写一段什么？（可留空，离线模板会自己续）">' + esc(S.genPrompt || '') + '</textarea>' +
      '<div class="seg" data-seg="genScope">' +
      ['extra', 'branch'].map((v) =>
        '<button data-val="' + v + '" class="' + ((S.genScope || 'extra') === v ? 'on' : '') + '">' + (v === 'branch' ? '正文分支' : '番外') + '</button>').join('') +
      '</div>' +
      '<p class="seg-note">番外 = 独立篇章；正文分支 = 附着在当前位置，读到那里可进去。默认用本地模板生成，不联网；设置里可改为 AI。</p>' +
      '<button class="btn full" data-act="gen-run">✎ 生成</button>' +
      '<p class="gen-note">连接 AI 的方式见「阅读设置 · 剧情生成」。</p></div>' +
      (items ? '<div class="story-list">' + items + '</div>' : '<p class="story-empty">还没有番外或分支。先写一段试试。</p>');
    bindGenScope();
  }

  function bindGenScope() {
    if (!D.settings) return;
    D.settings.querySelectorAll('[data-seg="genScope"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const box = $('#genPrompt', D.settings);
        S.genPrompt = box ? box.value : (S.genPrompt || '');
        S.genScope = btn.dataset.val === 'branch' ? 'branch' : 'extra';
        renderStoryList();
      });
    });
  }

  function currentContext() {
    const b = S.beats && S.beats[S.index];
    return b && b.text ? String(b.text).slice(0, 400) : '';
  }

  async function runGenerator() {
    if (!S.book) return;
    const promptEl = D.settings ? $('#genPrompt', D.settings) : null;
    const prompt = promptEl ? promptEl.value.trim() : '';
    const scope = S.genScope === 'branch' ? 'branch' : 'extra';
    const btn = D.settings ? D.settings.querySelector('[data-act="gen-run"]') : null;
    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    try {
      const gen = XR.Store.loadGenerator();
      const out = await XR.Generator.generate({
        title: S.book.title,
        chapter: S.chapterIndex + 1,
        context: currentContext(),
        prompt: prompt,
        scope: scope
      }, gen);
      const story = XR.Stories.normalizeStory({
        bookId: S.book.id,
        scope: scope,
        parentChapterIndex: S.chapterIndex,
        parentIndex: Math.max(0, S.index),
        title: out.title,
        text: out.text,
        options: (out.options && out.options.length) ? out.options : [{ label: '回到主线', goto: 'resume', target: null }],
        engine: out.engine || 'offline',
        prompt: prompt
      });
      await XR.Store.saveStory(story);
      S.stories = await XR.Store.listStories(S.book.id);
      toast('已生成：' + story.title);
      if (scope === 'branch') rebuildChapter(true);
      else renderStoryList();
    } catch (e) {
      toast('生成失败：' + (e && e.message ? e.message : e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✎ 生成'; }
    }
  }

  function toggleAuto() {
    if (!S.book) return;
    if (S.auto) { setAuto(false); return; }
    if (!D.settings.hidden || !D.gateLayer.hidden) return;   // 设置 / 卡页里不抢
    if (!D.choiceLayer.hidden) {
      // 「全书完」还铺在上面：先收起，再接着播
      D.choiceLayer.hidden = true;
      D.choiceLayer.innerHTML = '';
      S.ended = false;
      S.index = Math.max(0, S.beats.length - 1);
      updateChrome();
    }
    if (!D.wordLayer.hidden) { D.wordLayer.hidden = true; D.wordLayer.innerHTML = ''; echoState = null; }
    setAuto(true);
    if (S.allShown) {
      startAutoScroll();
      toast('自动播放 · 每 ' + autoSpeed().toFixed(1) + ' 秒往下走一句（A 或 ❚❚ 停）');
      return;
    }
    advance();
    if (S.auto) resumeAuto();    // 撞上卡页 / 章末时 advance 会提前 return，这里补上
    toast('自动播放 · 每 ' + autoSpeed().toFixed(1) + ' 秒一句（A 或 ❚❚ 停）');
  }

  /* ---- 阅读模式：推纸 ---- */
  function stopAutoScroll() {
    clearInterval(S.autoScrollTimer);
    S.autoScrollTimer = 0;
    S.autoGlide = null;
    S.autoStepAt = 0;
    S.autoEndAt = 0;
  }

  function startAutoScroll() {
    stopAutoScroll();
    if (!S.auto || !S.allShown) return;
    const now = performance.now();
    S.autoStepAt = Math.max(now + 60, S.autoChapterAt || 0);
    S.autoScrollTimer = setInterval(autoScrollTick, 50);
  }

  function autoScrollTick() {
    if (!S.auto || !S.allShown) { stopAutoScroll(); return; }
    // 卡页 / 回声 / 设置：先停住；关掉以后 closeGate / closeDrawer 会把我们接回来
    if (!D.gateLayer.hidden || !D.wordLayer.hidden || !D.choiceLayer.hidden || !D.settings.hidden) return;
    // 正在长按选字、手上有选区：别把选中的字从手指底下推走
    if (press || !D.selChip.hidden) return;
    const st = D.stage;
    const now = performance.now();

    // 正在推：一帧一帧滑到目标，滑完再等一个间隔
    const g = S.autoGlide;
    if (g) {
      const k = Math.min(1, (now - g.t0) / g.dur);
      const e = 1 - Math.pow(1 - k, 3);
      st.scrollTop = g.from + (g.to - g.from) * e;
      if (k >= 1) {
        st.scrollTop = g.to;
        S.autoGlide = null;
        S.autoStepAt = now + autoWait();
        S.autoEndAt = 0;
        S.gateArmed = true;
        updateChrome();
        saveProgress();
        checkGates();
      }
      return;
    }

    if (now < S.autoStepAt) return;

    const max = st.scrollHeight - st.clientHeight;
    if (max <= 4 || st.scrollTop >= max - 2) { finishScreen(now); return; }

    const to = nextScrollTop();
    if (to > st.scrollTop + 2) {
      const dur = Math.min(720, Math.max(280, 220 + (to - st.scrollTop) * 1.2));
      S.autoGlide = { from: st.scrollTop, to, t0: now, dur };
      return;
    }
    finishScreen(now);
  }

  // 这一屏读完了：多留一会儿，再翻下一章（整本读完才停在「全书完」）
  function finishScreen(now) {
    if (!S.autoEndAt) { S.autoEndAt = now + Math.max(1500, autoWait()); return; }
    if (now < S.autoEndAt) return;
    S.autoEndAt = 0;
    if (tryLooseGate()) return;   // 还有卡没弹：先把卡弹出来（卡是内容，不是确认）
    if (!autoNext()) { stopAutoScroll(); showBookEnd(); }
  }

  // 下一步停在哪：把正压着视口上沿的那一块整块推出去，让下一块顶上来
  function nextScrollTop() {
    const st = D.stage;
    const max = st.scrollHeight - st.clientHeight;
    const cur = st.scrollTop;
    if (max <= 4) return -1;
    const base = st.getBoundingClientRect().top;
    const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--base'));
    const line = Number.isFinite(px) ? px : 26;
    const edge = cur + 10;
    let to = -1;
    for (const el of D.beats.children) {
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      const t = r.top - base + cur;
      const b = r.bottom - base + cur;
      if (b <= edge + 1) continue;          // 已经整块滚上去了
      if (t <= edge) {
        // 还压着上沿：推到它的底边；比自己一屏还高的块，分屏推
        to = (b - t) > st.clientHeight * 0.55 ? cur + st.clientHeight * 0.62 : b + line * 0.3;
      } else {
        to = t + line * 0.3;                // 第一块还在上沿下面：把它顶上去
      }
      break;
    }
    if (to < 0) return -1;
    return Math.max(cur + 8, Math.min(max, Math.round(to)));
  }

  function stopAuto() {
    clearTimeout(S.autoTimer);
    S.autoTimer = 0;
    stopAutoScroll();
  }

  function scheduleAuto() {
    clearTimeout(S.autoTimer);
    S.autoTimer = 0;
    if (!S.auto || S.allShown || S.ended) return;
    const wait = autoWait() + Math.min(500, (S.revealDur || 0) * 0.6);
    S.autoTimer = setTimeout(() => {
      S.autoTimer = 0;
      if (!S.auto) return;
      if (!D.gateLayer.hidden || !D.wordLayer.hidden || !D.choiceLayer.hidden || !D.settings.hidden) return;
      // 手上有选区 / 正按着：等一下再走，别把选的字带走
      if (press || !D.selChip.hidden) { scheduleAuto(); return; }
      advance();
    }, wait);
  }

  /* ============================================================
     抽屉：设置 / 目录 / 回声簿
     ============================================================ */
  function openDrawer(view) {
    stopAuto();
    if (D.companionBubble) D.companionBubble.hidden = true;
    if (!D.gateLayer.hidden) closeGate();
    if (!D.choiceLayer.hidden) { D.choiceLayer.hidden = true; D.choiceLayer.innerHTML = ''; S.choiceKind = ''; S.choiceOptions = null; }
    if (S.drawerView === view && !D.settings.hidden) { closeDrawer(); return; }
    S.drawerView = view;
    D.settings.hidden = false;
    D.settings.scrollTop = 0;
    renderDrawer(view);
  }
  function closeDrawer() {
    D.settings.hidden = true;
    S.drawerView = '';
    maybeResumeAuto();   // 在设置里改完东西（包括自动播放间隔），关掉就接着走
  }
  function closeAll() {
    D.wordLayer.hidden = true;
    D.wordLayer.innerHTML = '';
    D.choiceLayer.hidden = true;
    D.choiceLayer.innerHTML = '';
    S.choiceKind = '';
    S.choiceOptions = null;
    D.gateLayer.hidden = true;
    D.gateLayer.innerHTML = '';
    document.body.classList.remove('gate-open');
    S.gateOpen = null;
    closeCompanionPanel();
    closeDrawer();
    hideChip();
    echoState = null;
  }

  function renderDrawer(view) {
    if (view === 'chapters') return renderChapterList();
    if (view === 'words') return renderNotebook();
    if (view === 'search') return renderSearch();
    if (view === 'stories') return renderStoryList();
    if (view === 'generator') return renderGeneratorConfig();
    if (view === 'marks') return renderMarks();
    if (view === 'tts') return renderTtsConfig();
    return renderSettings();
  }

  function drawerHead(title, extra) {
    return '<div class="drawer-head"><h2>' + title + '</h2><div class="dh-actions">' +
      (extra || '') +
      '<button class="btn icon" data-act="close-drawer" aria-label="关闭">✕</button></div></div>';
  }

  function renderChapterList() {
    const total = S.book.chapters.length;
    const items = S.book.chapters.map((c, i) => {
      const pct = Math.round((S.seen[i] || 0) * 100);
      const cur = i === S.chapterIndex;
      return '<button class="chap-item' + (cur ? ' current' : '') + '" data-ch="' + i + '">' +
        '<span class="ci-no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="ci-title">' + esc(stripChapterNo(c.title)) + '</span>' +
        '<span class="ci-pct">' + (pct > 0 ? pct + '%' : '') + '</span></button>';
    }).join('');

    D.settings.innerHTML =
      drawerHead('目录 · ' + total + ' 章',
        '<button class="btn icon" data-act="prev-ch" aria-label="上一章"' + (S.chapterIndex <= 0 ? ' disabled' : '') + '>‹</button>' +
        '<button class="btn icon" data-act="next-ch" aria-label="下一章"' + (S.chapterIndex >= total - 1 ? ' disabled' : '') + '>›</button>') +
      '<div class="chap-list">' + items + '</div>' +
      '<p class="drawer-foot">快捷键：[ 上一章 · ] 下一章 · M 目录</p>';
  }

  function renderNotebook() {
    const words = Object.keys(S.notebook).sort((a, b) => S.notebook[b].n - S.notebook[a].n);
    const list = words.length
      ? words.map((w) => {
        const it = S.notebook[w];
        const ch = S.book.chapters[it.ch] ? stripChapterNo(S.book.chapters[it.ch].title) : '';
        return '<button class="nb-item" data-word="' + escAttr(w) + '">' +
          '<span class="nb-word">' + esc(w) + '</span>' +
          '<span class="nb-meta">点开 ' + it.n + ' 次' + (ch ? ' · ' + esc(ch) : '') + '</span></button>';
      }).join('')
      : '<p class="nb-empty">还没有点开过任何词。<br>点带下划波纹的词，或直接划选一句话试试。</p>';

    D.settings.innerHTML =
      drawerHead('回声簿 · ' + words.length) +
      '<div class="nb-list">' + list + '</div>' +
      '<p class="drawer-foot">这里记着你在这本书里点开过的每一个词。</p>';
  }

  /* ============================================================
     正则 + 全文搜索
     ============================================================ */
  let searchTimer = 0;

  function openSearch() {
    if (S.view !== 'reader' || !S.book) return;
    if (!D.gateLayer.hidden) closeGate();
    if (!D.wordLayer.hidden) { D.wordLayer.hidden = true; D.wordLayer.innerHTML = ''; echoState = null; }
    if (!D.choiceLayer.hidden) { D.choiceLayer.hidden = true; D.choiceLayer.innerHTML = ''; }
    if (S.drawerView !== 'search' || D.settings.hidden) openDrawer('search');
    const inp = D.settings.querySelector('#searchInput');
    if (inp) {
      inp.focus();
      const n = inp.value.length;
      try { inp.setSelectionRange(n, n); } catch (e) { /* ignore */ }
    }
  }

  function searchStatHTML() {
    const st = S.search;
    if (!st.q.trim()) return '输入关键词，或切到「正则」写 <code>马尔福.{0,4}家</code> 这样的式子。';
    if (st.error) return st.error;
    if (!st.count) return '没找到「' + esc(st.q) + '」。';
    return '全书 ' + st.count + ' 处 · 第 ' + (st.i + 1) + ' / ' + st.count + ' 处 · ' + st.ms + 'ms' +
      (st.capped ? ' · 只列前 400 处' : '');
  }

  function searchRowsHTML() {
    const st = S.search;
    if (!st.hits.length) return '';
    const shown = st.hits.slice(0, 200);
    return shown.map((h, i) =>
      '<button class="search-hit' + (i === st.i ? ' current' : '') + '" data-hit="' + i + '">' +
      '<span class="sh-ch">' + (h.ch + 1) + '</span>' +
      '<span class="sh-txt">' + esc(h.before) + '<b>' + esc(h.text) + '</b>' + esc(h.after) + '</span>' +
      '</button>').join('');
  }

  function paintSearchResult() {
    const stat = D.settings.querySelector('#searchStat');
    if (stat) {
      stat.textContent = '';
      stat.innerHTML = searchStatHTML();
      stat.className = 'search-stat' + (S.search.error ? ' err' : '');
    }
    const list = D.settings.querySelector('#searchList');
    if (list) list.innerHTML = searchRowsHTML();
  }

  function doSearch() {
    const st = S.search;
    if (!S.book) return;
    const t0 = performance.now();
    if (!st.q.trim()) {
      st.hits = [];
      st.count = 0;
      st.i = -1;
      st.error = '';
      st.capped = false;
      st.ms = 0;
      paintSearchResult();
      return;
    }
    const res = XR.Engine.searchBook(S.book.chapters, st.q, { regex: st.re, max: 400 });
    st.ms = Math.max(1, Math.round(performance.now() - t0));
    if (res.error) {
      // 正则写错时保留上一次的结果，只把错报出来
      st.error = res.error;
      paintSearchResult();
      return;
    }
    st.error = '';
    st.capped = res.capped;
    st.hits = res.hits;
    st.count = res.hits.length;
    st.i = st.hits.length ? 0 : -1;
    paintSearchResult();
  }

  function renderSearch() {
    const st = S.search;
    D.settings.innerHTML =
      drawerHead('搜索全书') +
      '<div class="search-box">' +
      '<input id="searchInput" type="text" value="' + escAttr(st.q) + '" placeholder="关键词，或正则" autocomplete="off" spellcheck="false">' +
      '<div class="seg" data-seg="searchRe">' +
      [['0', '普通'], ['1', '正则']].map((p) =>
        '<button data-val="' + p[0] + '" class="' + ((st.re ? '1' : '0') === p[0] ? 'on' : '') + '">' + p[1] + '</button>').join('') +
      '</div></div>' +
      '<p id="searchStat" class="search-stat' + (st.error ? ' err' : '') + '"></p>' +
      '<div id="searchList" class="search-list"></div>' +
      '<p class="drawer-foot">Enter 下一处 · Shift+Enter 上一处 · Esc 关闭 · Ctrl+F 随时打开</p>';

    paintSearchResult();

    const inp = D.settings.querySelector('#searchInput');
    if (inp) {
      inp.addEventListener('input', () => {
        S.search.q = inp.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(doSearch, 180);
      });
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); }
      });
      inp.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    D.settings.querySelectorAll('[data-seg="searchRe"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const on = btn.dataset.val === '1';
        if (S.search.re === on) return;
        S.search.re = on;
        renderSearch();
        clearTimeout(searchTimer);
        doSearch();
        const i2 = D.settings.querySelector('#searchInput');
        if (i2) i2.focus();
      });
    });

    // 结果列表是随时重画的，所以用委托，别绑在按钮上
    const list = D.settings.querySelector('#searchList');
    if (list) {
      list.addEventListener('click', (e) => {
        const btn = e.target.closest ? e.target.closest('.search-hit') : null;
        if (!btn) return;
        const i = +btn.dataset.hit;
        if (!S.search.hits[i]) return;
        S.search.i = i;
        gotoHit(S.search.hits[i]);
      });
    }
  }

  function beatIndexForHit(hit) {
    let cum = 0;
    let best = -1;
    let bestScore = Infinity;
    let local = null;
    for (let i = 0; i < S.beats.length; i++) {
      const b = S.beats[i];
      if (b.kind !== 'line' || !b.text) continue;
      const j = b.text.indexOf(hit.text);
      if (j >= 0) {
        const score = Math.abs(cum + j - hit.start);
        if (score < bestScore) {
          bestScore = score;
          best = i;
          local = { start: j, end: j + hit.text.length };
        }
      }
      cum += b.text.length;
    }
    return { idx: best, local };
  }

  function beatElOf(b) {
    const list = D.beats.querySelectorAll('.beat');
    for (let i = list.length - 1; i >= 0; i--) if (list[i]._beat === b) return list[i];
    return null;
  }

  function repaintBeat(el, b) {
    if (!el || !b || b.kind !== 'line') return;
    el.innerHTML = '<span class="ln">' + inlineHTML(b, false, prepared(b)) + '</span>';
    el.classList.add('in');
    if (S.immersive && el === D.beats.querySelector('.beat:last-child')) centerImmersive(true);
  }

  function flashBeat(el) {
    if (!el) return;
    el.classList.add('hit-flash');
    setTimeout(() => el.classList.remove('hit-flash'), 1800);
  }

  function clearHitMarks() {
    for (const b of S.beats) if (b && b._hit) b._hit = null;
  }

  function gotoHit(hit, keepOpen) {
    if (!hit || !S.book) return;
    if (S.auto) setAuto(false);   // 跳到书里某一处：停下来看这一处
    if (hit.ch !== S.chapterIndex || !S.beats.length) loadChapter(hit.ch, -1);
    const loc = beatIndexForHit(hit);
    if (loc.idx < 0) { toast('这一处已经不在本章了'); return; }
    if (!keepOpen) closeDrawer();
    clearHitMarks();
    if (S.allShown) {
      const b = S.beats[loc.idx];
      b._hit = loc.local;
      const el = beatElOf(b);
      if (el) {
        repaintBeat(el, b);
        el.scrollIntoView({ block: 'center' });
        flashBeat(el);
        updateChrome();
        saveProgress();
      }
      return;
    }
    loadChapter(hit.ch, loc.idx);
    const b2 = S.beats[loc.idx];
    if (!b2) return;
    const j = b2.text ? b2.text.indexOf(hit.text) : -1;
    if (j >= 0) b2._hit = { start: j, end: j + hit.text.length };
    const el2 = beatElOf(b2);
    if (el2) { repaintBeat(el2, b2); flashBeat(el2); }
  }

  function stepHit(dir) {
    const st = S.search;
    if (!st.hits.length) return;
    st.i = (st.i + dir + st.hits.length) % st.hits.length;
    paintSearchResult();
    gotoHit(st.hits[st.i], true);
    const cur = D.settings.querySelector('.search-hit.current');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  /* 卡页的具体参数：隔几句（段）一张 · 卡片抽前文还是后文 */
  function gateSettingsHTML(s) {
    const unit = s.gateUnit === 'paragraph' ? 'paragraph' : 'sentence';
    const uw = gateUnitWord(unit);
    const every = Math.max(1, Math.round(s.gateEvery || 6));
    const lo = unit === 'paragraph' ? 1 : 2;
    const hi = unit === 'paragraph' ? 15 : 30;
    const info = S.gateInfo;
    const note = (info
      ? '本章 ' + info.count + ' 张 · 再读 ' + info.left + ' ' + gateUnitWord(info.unit) + '就有下一张。'
      : '每 ' + every + ' ' + uw + '一张。') +
      ' 一章的零头会带到下一章，很短的章读几章也会遇到一张。';
    return '<div class="field sub">' +
      '<div class="field-label"><span>隔几' + uw + '来一张</span><b id="lblGate">' + every + ' ' + uw + '</b></div>' +
      '<input type="range" id="rngGate" min="' + lo + '" max="' + hi + '" step="1" value="' + Math.min(hi, Math.max(lo, every)) + '">' +
      '<div class="seg" data-seg="gateUnit">' +
      [['sentence', '按句'], ['paragraph', '按段']].map((p) =>
        '<button data-val="' + p[0] + '" class="' + (unit === p[0] ? 'on' : '') + '">' + p[1] + '</button>').join('') +
      '</div>' +
      '<div class="seg" data-seg="gateAhead" style="margin-top:8px">' +
      [['1', '抽后文'], ['0', '抽前文']].map((p) =>
        '<button data-val="' + p[0] + '" class="' + ((s.gateAhead === false ? '0' : '1') === p[0] ? 'on' : '') + '">' + p[1] + '</button>').join('') +
      '</div>' +
      '<p class="seg-note">' + note + '<br>抽后文 = 卡片上是接下来要读到的那句；抽前文 = 刚读过的那句。</p>' +
      '<button class="btn small ghost" data-act="try-gate">现在就弹一张看看</button>' +
      '</div>';
  }

  /* ---------------- 正则美化：规则列表 / 试跑 / 增删 ---------------- */
  function currentTextSample() {
    if (!S.book) return '';
    const ch = S.book.chapters[S.chapterIndex] || {};
    return String(ch.text || '').replace(/\u0001[^\u0001]*\u0001/g, '');
  }

  function ruleRowHTML(r, i) {
    const r0 = r || {};
    const off = r0.on === false;
    const tag = r0.action === 'replace'
      ? '替换为「' + esc(String(r0.repl || '').slice(0, 24) || '（删掉）') + '」'
      : (XR.Engine.RULE_STYLE_NAME[r0.action] || '高亮');
    return '<div class="rule-row' + (off ? ' off' : '') + '" data-i="' + i + '">' +
      '<button class="switch ' + (off ? '' : 'on') + '" data-act="rule-toggle" aria-label="启用规则"></button>' +
      '<code class="rule-pat">' + esc(String(r0.pat || '')) + '</code>' +
      '<span class="rule-tag">' + tag + '</span>' +
      '<button class="btn icon rule-del" data-act="rule-del" aria-label="删除规则">✕</button>' +
      '</div>';
  }

  function draftPreviewHTML() {
    const d = S.ruleDraft || { pat: '', act: 'hi', repl: '' };
    if (!String(d.pat || '').trim()) return '写好一条，加之前这里会先试跑（例：把「他说」都高亮）';
    const res = XR.Engine.rulePreview({ pat: d.pat, action: d.act, repl: d.repl }, currentTextSample());
    if (res.error) return '<span class="bad">' + esc(res.error) + '</span>';
    if (!res.hits) return '这一章没命中任何地方（也能加，别的章可能用得上）';
    return '命中 ' + res.hits + ' 处 · …' + esc(res.before) + '<b>' + esc(res.match) + '</b>' + esc(res.after) + '…' +
      (d.act === 'replace' ? ' ⇒ 「' + esc(res.result) + '」' : '');
  }

  function ruleSettingsHTML(s) {
    const list = Array.isArray(s.rules) ? s.rules : [];
    const d = S.ruleDraft || { pat: '', act: 'hi', repl: '' };
    const isRepl = d.act === 'replace';
    const rows = list.map(ruleRowHTML).join('');
    const errs = (S.rulesErr || []).map((e) => e.msg).filter(Boolean).slice(0, 3);
    const preview = draftPreviewHTML();
    const previewErr = /^<span class="bad">/.test(preview);
    return '<div class="field"><div class="field-label"><span>正则美化</span><b>' + list.length + ' / ' + XR.Engine.RULE_MAX + ' 条</b></div>' +
      '<p class="seg-note">自己写正则，只改屏幕上显示的字：命中的地方可以高亮 / 放大 / 发光 / 淡化，也可以直接替换成别的字（原文一个字不动，随时能删）。</p>' +
      '<div class="rule-list">' + (rows || '<p class="rule-empty">还没有规则</p>') + '</div>' +
      (errs.length ? '<p class="rule-test err">' + esc(errs.join(' · ')) + '</p>' : '') +
      '<div class="rule-add">' +
      '<input id="rulePat" type="text" placeholder="正则，如：^「.+」$ 或 /他.{0,4}说/g" value="' + escAttr(d.pat) + '">' +
      '<select id="ruleAct" aria-label="规则动作">' +
      XR.Engine.RULE_ACTIONS.map((a) => '<option value="' + a + '"' + (d.act === a ? ' selected' : '') + '>' + XR.Engine.RULE_STYLE_NAME[a] + '</option>').join('') +
      '</select>' +
      '</div>' +
      '<div class="rule-add" id="ruleReplRow"' + (isRepl ? '' : ' hidden') + '>' +
      '<input id="ruleRepl" type="text" placeholder="替换成（可用 $1；留空 = 删掉）" value="' + escAttr(d.repl) + '">' +
      '</div>' +
      '<div class="rule-add"><button class="btn small" data-act="rule-add">加一条</button></div>' +
      '<p class="rule-test' + (previewErr ? ' err' : '') + '" id="ruleTest">' + preview + '</p>' +
      '<p class="seg-note">不写 /…/ 开关时默认不分大小写；写了就按你写的开关来（只会自动补一个 g）。别写 (a+)+ 这种嵌套量词，会把页面卡死。</p>' +
      '</div>';
  }

  function updateRuleTest() {
    if (!D.settings || D.settings.hidden || S.drawerView !== 'settings') return;
    const box = $('#ruleTest', D.settings);
    if (!box) return;
    const html = draftPreviewHTML();
    box.className = 'rule-test' + (/^<span class="bad">/.test(html) ? ' err' : '');
    box.innerHTML = html;
  }

  function scheduleRuleTest(delay) {
    clearTimeout(S.ruleTimer);
    S.ruleTimer = setTimeout(updateRuleTest, typeof delay === 'number' ? delay : 250);
  }

  function addRule() {
    const d = S.ruleDraft || { pat: '', act: 'hi', repl: '' };
    const pat = String(d.pat || '').trim();
    if (!pat) { toast('先写一条正则'); return; }
    const list = Array.isArray(S.settings.rules) ? S.settings.rules : [];
    if (list.length >= XR.Engine.RULE_MAX) { toast('最多 ' + XR.Engine.RULE_MAX + ' 条，先删一条'); return; }
    const action = d.act === 'replace' ? 'replace' : (XR.Engine.RULE_ACTIONS.indexOf(d.act) >= 0 ? d.act : 'hi');
    const c = XR.Engine.compileRules([{ pat, action, repl: d.repl, on: true }]);
    if (!c.rules.length) {
      toast((c.errors[0] && c.errors[0].msg) || '这条正则不生效');
      updateRuleTest();
      return;
    }
    const rule = { pat, action, repl: action === 'replace' ? String(d.repl || '') : '', on: true };
    list.push(rule);
    S.settings.rules = list;
    S.ruleDraft = { pat: '', act: action, repl: '' };
    applySettings();
    rebuildChapter(true);
    openDrawer('settings');
    const pv = XR.Engine.rulePreview(rule, currentTextSample());
    toast(pv.hits ? '加上了：这一章命中 ' + pv.hits + ' 处' : '加上了，这一章暂时没命中');
  }

  function delRule(i) {
    const list = S.settings.rules || [];
    if (!list[i]) return;
    list.splice(i, 1);
    applySettings();
    rebuildChapter(true);
    openDrawer('settings');
    toast('删掉了一条');
  }

  function toggleRule(i) {
    const list = S.settings.rules || [];
    if (!list[i]) return;
    list[i].on = list[i].on === false;
    applySettings();
    rebuildChapter(true);
    openDrawer('settings');
  }

  function renderSettings() {
    const s = S.settings;
    const mode = s.mode || 'read';
    const modeName = { read: '阅读', play: '互动', immersive: '沉浸' };
    const granName = { sentence: '逐句', paragraph: '每段', chapter: '整章' };
    const densName = { 0: '少', 1: '中', 2: '多' };
    const jumpName = { 0: '关', 1: '轻', 2: '活' };
    const md = mood();
    D.settings.innerHTML =
      drawerHead('阅读设置') +
      '<div class="field"><div class="field-label"><span>阅读方式</span><b>' + modeName[mode] + '</b></div>' +
      '<div class="seg" data-seg="mode">' +
      ['read', 'play', 'immersive'].map((m) => '<button data-val="' + m + '" class="' + (mode === m ? 'on' : '') + '">' + modeName[m] + '</button>').join('') +
      '</div><p class="seg-note">阅读 = 像普通小说一样读；互动 = 逐句 / 逐段，字在底部往上堆；沉浸 = 一页一句或一段，最新的一段落在屏幕正中</p></div>' +
      '<div class="field"><div class="field-label"><span>读法</span><b>' + md.name + '</b></div>' +
      '<div class="seg" data-seg="mood">' +
      ['normal', 'near', 'far', 'still'].map((k) =>
        '<button data-val="' + k + '" class="' + ((s.mood || 'normal') === k ? 'on' : '') + '">' + MOODS[k].name + '</button>').join('') +
      '</div><p class="seg-note">' + md.note + '。只在设置里定，正文读到一半不会弹出来问。</p></div>' +
      (mode === 'play'
        ? '<div class="field"><div class="field-label"><span>互动粒度</span><b>' + granName[s.granularity] + '</b></div>' +
          '<div class="seg" data-seg="granularity">' +
          ['sentence', 'paragraph', 'chapter'].map((g) => '<button data-val="' + g + '" class="' + (s.granularity === g ? 'on' : '') + '">' + granName[g] + '</button>').join('') +
          '</div><p class="seg-note">逐句 = 一句一停；每段 = 一段一停；整章 = 一次铺满，直接滚动读</p></div>'
        : '') +
      (mode === 'immersive'
        ? '<div class="field"><div class="field-label"><span>一页读多少</span><b>' + (s.stageUnit === 'sentence' ? '一句' : '一段') + '</b></div>' +
          '<div class="seg" data-seg="stageUnit">' +
          [['sentence', '一句'], ['paragraph', '一段']].map((p) =>
            '<button data-val="' + p[0] + '" class="' + ((s.stageUnit === 'sentence' ? 'sentence' : 'paragraph') === p[0] ? 'on' : '') + '">' + p[1] + '</button>').join('') +
          '</div><p class="seg-note">一页只推进这么一小块；点、空格、往下滚都是下一块。</p>' +
          '<div class="field-label" style="margin-top:16px"><span>上面留几段</span><b>' + stageKeep() + ' 段</b></div>' +
          '<div class="seg" data-seg="stageKeep">' +
          [0, 1, 2, 3, 4].map((k) => '<button data-val="' + k + '" class="' + (stageKeep() === k ? 'on' : '') + '">' + k + '</button>').join('') +
          '</div><p class="seg-note">最新的一段在正中，读过的往上走、越往上越淡。0 = 屏幕上只留当前这一页。</p></div>'
        : '') +
      '<div class="field"><div class="field-label"><span>互动密度</span><b>' + densName[s.density] + '</b></div>' +
      '<div class="seg" data-seg="density">' +
      [0, 1, 2].map((d) => '<button data-val="' + d + '" class="' + (s.density === d ? 'on' : '') + '">' + densName[d] + '</button>').join('') +
      '</div><p class="seg-note">每段至少一个词会跳出来；密度只决定长段里再多几个</p></div>' +
      '<div class="field"><div class="field-label"><span>整页大弹窗</span><b>' + (s.gateOn ? '开' : '关') + '</b></div>' +
      '<div class="seg" data-seg="gateOn">' +
      [['0', '关'], ['1', '开']].map((p) => '<button data-val="' + p[0] + '" class="' + ((s.gateOn ? '1' : '0') === p[0] ? 'on' : '') + '">' + p[1] + '</button>').join('') +
      '</div>' +
      (s.gateOn ? gateSettingsHTML(s) : '<p class="seg-note">关掉以后读到哪儿都不会整页弹卡，只剩词和动作。</p>') +
      '</div>' +
      '<div class="field"><div class="field-label"><span>拟人动作</span><b>' + jumpName[s.jump || 0] + '</b></div>' +
      '<div class="seg" data-seg="jump">' +
      [0, 1, 2].map((d) => '<button data-val="' + d + '" class="' + ((s.jump || 0) === d ? 'on' : '') + '">' + jumpName[d] + '</button>').join('') +
      '</div><p class="seg-note">每段至少有一个字在动：上下跳 / 歪头 / 摆 / 脉冲 / 蹦 / 发抖 / 张望 / 漂 / 浮 / 翻 / 发光 / 摆荡 / 数字弹一下 / 标点敲一下。台词会点头，响的句子会蹦，写着「跑」「jump」的词会真的动起来；英文按整词动，不会把单词拆开。关掉后指针柔光、墨点、字浪也一起静下来。</p></div>' +
      ruleSettingsHTML(s) +
      '<div class="field"><div class="field-label"><span>主题</span><b>' + themeName(s.theme) + '</b></div>' +
      '<div class="seg" data-seg="theme">' +
      ['paper', 'night', 'ink'].map((t) => '<button data-val="' + t + '" class="' + (s.theme === t ? 'on' : '') + '">' + themeName(t) + '</button>').join('') +
      '</div></div>' +
      '<div class="field"><div class="field-label"><span>正文字号</span><b id="lblBase">' + s.base + 'px</b></div>' +
      '<input type="range" id="rngBase" min="18" max="38" step="1" value="' + s.base + '"></div>' +
      '<div class="field"><div class="field-label"><span>字号呼吸强度</span><b id="lblInt">' + Math.round(s.intensity * 100) + '%</b></div>' +
      '<input type="range" id="rngInt" min="0" max="100" step="5" value="' + Math.round(s.intensity * 100) + '"></div>' +
      '<div class="field"><div class="field-label"><span>自动播放间隔</span><b id="lblSpeed">' + s.autoSpeed.toFixed(1) + 's</b></div>' +
      '<input type="range" id="rngSpeed" min="10" max="60" step="2" value="' + Math.round(s.autoSpeed * 10) + '">' +
      '<p class="seg-note">点 ▷ 开始（A 也行），再点 ❚❚ 停。逐句 / 沉浸：每个间隔走一句；阅读模式：每个间隔把下一句推到屏幕顶上（间隔越短越快）。设置只是暂停，关掉会接着走。</p></div>' +
      '<div class="field">' +
      '<div class="toggle"><span>逐字显影（短句）</span><button class="switch ' + (s.typewriter ? 'on' : '') + '" id="tgTyping" aria-label="逐字显影"></button></div>' +
      '<div class="toggle"><span>跳出关键词</span><button class="switch ' + (s.marks ? 'on' : '') + '" id="tgMarks" aria-label="跳出关键词"></button></div>' +
      '</div><hr>' +
      '<button class="btn full" data-act="chapters">☰ 目录</button>' +
      '<button class="btn full" data-act="words">✦ 回声簿（' + Object.keys(S.notebook).length + '）</button>' +
      '<button class="btn full" data-act="marks">✎ 书签与笔记（' + (S.markCount || 0) + '）</button>' +
      '<button class="btn full" data-act="stories">❖ 番外 · 分支</button>' +
      '<button class="btn full" data-act="generator-config">✎ 剧情生成设置</button>' +
      '<button class="btn full" data-act="tts-config">♪ 朗读设置</button>' +
      syncSettingsHTML() +
      backupSettingsHTML() +
      '<button class="btn full" data-act="restart">↺ 重读本章</button>' +
      '<button class="btn full ghost" data-act="shelf">⌂ 回到书架</button>' +
      '<p class="drawer-foot">空格 / → 继续（章末直接进下一章），← 退回一句（章首再按回到上一章），A 自动播放，M 目录，Esc 关闭。<br>默认不联网；云同步 / AI 只在你手动开启后才用。永远不改动原文的一个字。</p>';
    bindSettings();
  }

  function themeName(t) {
    return t === 'night' ? '夜' : t === 'ink' ? '墨' : '纸';
  }

  function bindSettings() {
    const s = S.settings;
    D.settings.querySelectorAll('[data-seg="mode"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if ((s.mode || 'read') === btn.dataset.val) return;
        s.mode = btn.dataset.val;
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
      });
    });
    D.settings.querySelectorAll('[data-seg="mood"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if ((s.mood || 'normal') === btn.dataset.val) return;
        s.mood = btn.dataset.val;
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
        toast('读法：' + MOODS[s.mood].name + ' —— ' + MOODS[s.mood].note);
      });
    });
    D.settings.querySelectorAll('[data-seg="granularity"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (s.granularity === btn.dataset.val) return;
        s.granularity = btn.dataset.val;
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
      });
    });
    D.settings.querySelectorAll('[data-seg="stageUnit"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const unit = btn.dataset.val === 'sentence' ? 'sentence' : 'paragraph';
        if ((s.stageUnit === 'sentence' ? 'sentence' : 'paragraph') === unit) return;
        s.stageUnit = unit;
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
      });
    });
    D.settings.querySelectorAll('[data-seg="stageKeep"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = +btn.dataset.val;
        if (stageKeep() === k) return;
        s.stageKeep = k;
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
      });
    });
    const rulePat = $('#rulePat', D.settings);
    if (rulePat) {
      rulePat.addEventListener('input', () => {
        S.ruleDraft.pat = rulePat.value;
        scheduleRuleTest();
      });
      rulePat.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addRule(); }
      });
    }
    const ruleAct = $('#ruleAct', D.settings);
    if (ruleAct) {
      ruleAct.addEventListener('change', () => {
        S.ruleDraft.act = ruleAct.value;
        const row = $('#ruleReplRow', D.settings);
        if (row) row.hidden = S.ruleDraft.act !== 'replace';
        if (S.ruleDraft.act === 'replace') {
          const rr = $('#ruleRepl', D.settings);
          if (rr) rr.focus();
        }
        scheduleRuleTest(0);
      });
    }
    const ruleRepl = $('#ruleRepl', D.settings);
    if (ruleRepl) {
      ruleRepl.addEventListener('input', () => {
        S.ruleDraft.repl = ruleRepl.value;
        scheduleRuleTest();
      });
      ruleRepl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addRule(); }
      });
    }
    D.settings.querySelectorAll('[data-seg="density"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (String(s.density) === btn.dataset.val) return;
        s.density = +btn.dataset.val;
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
      });
    });
    D.settings.querySelectorAll('[data-seg="gateOn"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const on = btn.dataset.val === '1';
        if (s.gateOn === on) return;
        s.gateOn = on;
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
      });
    });
    D.settings.querySelectorAll('[data-seg="gateUnit"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const unit = btn.dataset.val === 'paragraph' ? 'paragraph' : 'sentence';
        if (s.gateUnit === unit) return;
        s.gateUnit = unit;
        const lo = unit === 'paragraph' ? 1 : 2;
        const hi = unit === 'paragraph' ? 15 : 30;
        s.gateEvery = Math.min(hi, Math.max(lo, Math.round(s.gateEvery || 6)));
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
      });
    });
    D.settings.querySelectorAll('[data-seg="gateAhead"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ahead = btn.dataset.val !== '0';
        if ((s.gateAhead !== false) === ahead) return;
        s.gateAhead = ahead;
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
      });
    });
    const gs = $('#rngGate', D.settings);
    if (gs) {
      gs.addEventListener('input', () => {
        s.gateEvery = +gs.value;
        const lbl = $('#lblGate', D.settings);
        if (lbl) lbl.textContent = s.gateEvery + ' ' + gateUnitWord(s.gateUnit);
        applySettings();
      });
      gs.addEventListener('change', () => {
        rebuildChapter(true);
        openDrawer('settings');
      });
    }
    D.settings.querySelectorAll('[data-seg="jump"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (String(s.jump || 0) === btn.dataset.val) return;
        s.jump = +btn.dataset.val;
        applySettings();
        rebuildChapter(true);
        openDrawer('settings');
      });
    });
    D.settings.querySelectorAll('[data-seg="theme"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        s.theme = btn.dataset.val;
        applySettings();
        renderSettings();
      });
    });
    const base = $('#rngBase', D.settings);
    if (base) base.addEventListener('input', () => {
      s.base = +base.value;
      applySettings();
      $('#lblBase', D.settings).textContent = s.base + 'px';
    });
    const inten = $('#rngInt', D.settings);
    if (inten) inten.addEventListener('input', () => {
      s.intensity = +inten.value / 100;
      applySettings();
      $('#lblInt', D.settings).textContent = inten.value + '%';
    });
    const spd = $('#rngSpeed', D.settings);
    if (spd) spd.addEventListener('input', () => {
      s.autoSpeed = +spd.value / 10;
      applySettings();
      $('#lblSpeed', D.settings).textContent = s.autoSpeed.toFixed(1) + 's';
    });
    const tt = $('#tgTyping', D.settings);
    if (tt) tt.addEventListener('click', () => {
      s.typewriter = !s.typewriter;
      tt.classList.toggle('on', s.typewriter);
      applySettings();
      toast(s.typewriter ? '逐字显影：开' : '逐字显影：关');
    });
    const tm = $('#tgMarks', D.settings);
    if (tm) tm.addEventListener('click', () => {
      s.marks = !s.marks;
      tm.classList.toggle('on', s.marks);
      applySettings();
      rebuildChapter(true);
    });
  }

  function renderGeneratorConfig() {
    const g = XR.Store.loadGenerator();
    const name = { offline: '离线', llm: '外部 AI', local: '本地模型' };
    D.settings.innerHTML =
      drawerHead('剧情生成') +
      '<div class="field"><div class="field-label"><span>生成方式</span><b>' + (name[g.backend] || '离线') + '</b></div>' +
      '<div class="seg">' +
      ['offline', 'llm', 'local'].map((v) =>
        '<button data-act="gen-backend" data-val="' + v + '" class="' + (g.backend === v ? 'on' : '') + '">' + name[v] + '</button>').join('') +
      '</div><p class="seg-note">默认「离线」：不联网、零依赖，导入 txt/epub 即可用。外部 AI / 本地模型需自行配置，仅在你启用后才联网。</p></div>' +
      '<div class="field"><div class="field-label"><span>外部 AI（OpenAI 兼容）</span><b>可选</b></div>' +
      '<input class="gen-input" id="genLlmUrl" placeholder="Base URL" value="' + escAttr(g.llm.baseURL || '') + '">' +
      '<input class="gen-input" id="genLlmKey" placeholder="API Key" value="' + escAttr(g.llm.apiKey || '') + '">' +
      '<input class="gen-input" id="genLlmModel" placeholder="模型名" value="' + escAttr(g.llm.model || '') + '"></div>' +
      '<div class="field"><div class="field-label"><span>本地模型（Ollama 等）</span><b>可选</b></div>' +
      '<input class="gen-input" id="genLocalUrl" placeholder="Base URL" value="' + escAttr(g.local.baseURL || '') + '">' +
      '<input class="gen-input" id="genLocalModel" placeholder="模型名" value="' + escAttr(g.local.model || '') + '">' +
      '<p class="gen-note">浏览器直连本地模型可能被 CORS 拦；必要时给 Ollama 开跨域。</p></div>' +
      '<div class="field"><div class="field-label"><span>风格</span><b></b></div>' +
      '<input class="gen-input" id="genStyle" placeholder="风格提示" value="' + escAttr(g.style || '') + '"></div>' +
      '<button class="btn full" data-act="gen-save">保存设置</button>' +
      '<p class="drawer-foot">API Key 存在本机 localStorage，请使用最小权限、定期轮换。</p>';
  }

  function rebuildChapter(keepPos) {
    if (!S.book) return;
    // 整章模式按滚动比例记位置，逐句模式按句号记 —— 以前整章模式会一路跳到章尾
    let ratio = 0;
    if (keepPos && S.beats.length) {
      if (S.allShown) {
        const max = D.stage.scrollHeight - D.stage.clientHeight;
        ratio = max > 6 ? Math.max(0, Math.min(1, D.stage.scrollTop / max)) : 0;
      } else {
        ratio = Math.max(0, S.index + 1) / S.beats.length;
      }
    }
    closeAll();
    loadChapter(S.chapterIndex, -1);
    if (ratio > 0 && S.beats.length > 1) {
      const idx = Math.max(0, Math.min(S.beats.length - 1, Math.round(ratio * S.beats.length) - 1));
      if (idx > 0) loadChapter(S.chapterIndex, idx);
    }
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  function bind() {
    // 导入
    D.dropzone.addEventListener('click', () => D.fileInput.click());
    D.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); D.fileInput.click(); }
    });
    D.fileInput.addEventListener('change', () => {
      importFiles(D.fileInput.files);
      D.fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
      e.preventDefault();
      if (S.view === 'shelf') D.dropzone.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files.length) {
        D.dropzone.classList.remove('over');
        importFiles(e.dataTransfer.files);
      }
      if (ev === 'dragleave' && e.target === D.dropzone) D.dropzone.classList.remove('over');
    }));

    D.btnSample.addEventListener('click', async () => {
      const book = XR.Sample.get();
      await XR.Store.saveBook(book);
      openBook(book.id);
    });

    D.btnTheme.addEventListener('click', () => {
      const order = ['paper', 'night', 'ink'];
      const i = order.indexOf(S.settings.theme);
      S.settings.theme = order[(i + 1) % order.length];
      applySettings();
      toast('主题：' + themeName(S.settings.theme));
    });

    D.bookList.addEventListener('click', (e) => {
      const del = e.target.closest('.bc-del');
      if (del) {
        e.stopPropagation();
        const id = del.dataset.del;
        if (confirm('确定删除这本书？进度也会一起删掉。')) {
          XR.Store.deleteBook(id).then(async () => {
            await renderShelf();
            XR.Store.markDirty('books');
            queueAutoSync();
          });
        }
        return;
      }
      const card = e.target.closest('.book-card');
      if (card) openBook(card.dataset.id);
    });

    // 阅读器
    D.btnBack.addEventListener('click', backToShelf);
    D.btnNext.addEventListener('click', () => advance());
    D.btnAuto.addEventListener('click', toggleAuto);
    D.btnChapters.addEventListener('click', () => openDrawer('chapters'));
    if (D.btnSearch) D.btnSearch.addEventListener('click', () => openSearch());
    D.btnSettings.addEventListener('click', () => openDrawer('settings'));
    if (D.btnStory) D.btnStory.addEventListener('click', () => openDrawer('stories'));
    if (D.btnCompanion) D.btnCompanion.addEventListener('click', () => openCompanion());
    if (D.btnMarks) D.btnMarks.addEventListener('click', () => openDrawer('marks'));
    if (D.btnTts) D.btnTts.addEventListener('click', () => ttsToggle());
    if (D.companionBubble) D.companionBubble.addEventListener('click', () => { D.companionBubble.hidden = true; openCompanion(); });
    if (D.companionPanel) D.companionPanel.addEventListener('click', (e) => { if (e.target === D.companionPanel) closeCompanionPanel(); });
    D.chapterTitle.addEventListener('click', () => openDrawer('chapters'));

    // 整页阅读面都能点：正文、左右留白、顶栏空白、页脚空白、本章完的空白处
    // 只有真正的控件（按钮、进度条、目录标题、抽屉、浮层）才不接管
    D.reader.addEventListener('click', (e) => {
      const t = e.target;

      // 刚拖过进度条 / 刚长按选完字：这一下不翻页，也不打断选区
      if (performance.now() < S.ignoreClickUntil) return;

      const kw = t.closest('.kw');
      if (kw) {
        e.stopPropagation();
        if (S.motion) S.motion.spark(kw.dataset.word, e.clientX, e.clientY);
        clearSelection(); hideChip(); openEcho(kw.dataset.word, beatTextOf(kw)); return;
      }

      const cstrip = t.closest('.choice-strip');
      if (cstrip) {
        e.stopPropagation();
        if (cstrip._choiceBeat) openStoryChoice(cstrip._choiceBeat);
        return;
      }

      const strip = t.closest('.gate-strip');
      if (strip) {
        e.stopPropagation();
        const g = S.gates.find((x) => x.el === strip);
        if (g && !g.done) { openGate(g); return; }
        // 这张卡已经弹过了：这一下就当普通空白继续往下读（以前这里点着没反应）
        advance();
        return;
      }

      // 卡页 / 回声层自己处理点击（点一下就关）
      if (!D.gateLayer.hidden) return;
      if (!D.wordLayer.hidden) return;

      // 最后一章读完了：那一层自己处理（点背景收起），点层外的空白什么都不做
      if (!D.choiceLayer.hidden) return;

      if (t.closest('button, a, input, select, textarea, .progress, .chapter-title, .sel-chip, .drawer, .toast, .crash, .layer')) return;

      if (!D.settings.hidden) { closeDrawer(); return; }

      // 点正文：落一小圈墨；点到哪一行，哪一行应一下
      if (S.motion) {
        S.motion.ripple(e.clientX, e.clientY);
        const line = t.closest ? t.closest('.beat') : null;
        if (line) S.motion.tap(line);
      }

      // 手上有真的选区时，这一次点击既收掉选区，也接着往下读（不再白吞这一下）
      const selText = window.getSelection ? String(window.getSelection()).trim() : '';
      if (selText.length >= 2) {
        clearSelection();
        hideChip();
        advance();
        return;
      }
      // 可能还留着个“空壳选区”（切换到不可选状态后浏览器不会自己清掉），这里一起收掉
      clearSelection();
      hideChip();
      advance();
    });

    // 选字只认长按：点一下 / 双击 / 拖动都不会选中文字
    // 同步设置：输入即存（token 只在本机）
    D.settings.addEventListener('change', (e) => {
      const inp = e.target && e.target.closest ? e.target.closest('.sync-input') : null;
      if (!inp) return;
      const cfg = XR.Store.loadSync();
      cfg[inp.dataset.key] = inp.value;
      XR.Store.saveSync(cfg);
    });
    D.settings.addEventListener('change', (e) => {
      if (!e.target || e.target.id !== 'backupFile') return;
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) importBackup(f);
    });

    D.reader.addEventListener('pointerdown', pressDown);
    D.reader.addEventListener('pointermove', pressMove);
    // 鼠标走过的地方泛起一点光：只是加一层视觉，不拦任何事件
    D.reader.addEventListener('pointermove', (e) => {
      if (S.motion) S.motion.point(e.clientX, e.clientY);
    }, { passive: true });
    D.reader.addEventListener('pointerleave', () => {
      if (S.motion) S.motion.pointOff();
    });
    D.reader.addEventListener('pointerup', pressUp);
    D.reader.addEventListener('pointercancel', pressCancel);
    document.addEventListener('selectstart', onSelectStart);

    D.stage.addEventListener('wheel', (e) => {
      if (!D.wordLayer.hidden || !D.choiceLayer.hidden || !D.settings.hidden) return;
      // 自己滚了：自动播放正在推的那一下先让出来，别把手指/滚轮顶回去
      if (S.auto && S.autoGlide) { S.autoGlide = null; S.autoStepAt = performance.now() + autoWait(); }
      if (S.allShown) {
        // 整章滚动读：已经在最底了还往下滚 = 接着读下一章（跟小说阅读器一样）
        if (e.deltaY <= 0) return;
        const max = D.stage.scrollHeight - D.stage.clientHeight;
        if (max > 6 && D.stage.scrollTop < max - 6) return;
        const now = performance.now();
        if (now - S.lastWheel < 700) return;
        S.lastWheel = now;
        if (tryLooseGate()) return;
        autoNext();
        return;
      }
      const atBottom = D.stage.scrollHeight - D.stage.scrollTop - D.stage.clientHeight < 6;
      if (e.deltaY <= 0) return;
      // 沉浸模式：先让用户滚回当前这一块，再往下滚才是“下一段”，不会把正在看的段落跳过去
      if (S.immersive) {
        if (D.stage.scrollTop < (S.immersiveTarget || 0) - 24) return;
      } else if (!atBottom) {
        return;
      }
      const now = performance.now();
      if (now - S.lastWheel < 700) return;
      S.lastWheel = now;
      advance();
    }, { passive: true });

    // 进度条拖动
    const track = D.progressTrack;
    if (track) {
      track.addEventListener('pointerdown', (e) => {
        if (!S.book) return;
        e.preventDefault();
        S.scrubbing = true;
        try { track.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        previewSeek(ratioFromEvent(e), e.clientX);
      });
      track.addEventListener('pointermove', (e) => {
        if (!S.scrubbing) return;
        previewSeek(ratioFromEvent(e), e.clientX);
      });
      track.addEventListener('pointerup', (e) => {
        if (!S.scrubbing) return;
        S.scrubbing = false;
        S.ignoreClickUntil = performance.now() + 320;
        commitSeek(ratioFromEvent(e));
      });
      track.addEventListener('pointercancel', () => {
        S.scrubbing = false;
        S.ignoreClickUntil = performance.now() + 320;
        D.progressTip.hidden = true;
        track.classList.remove('scrubbing');
      });
    }

    // 整章模式：滚动即进度
    let scrollTick = 0;
    D.stage.addEventListener('scroll', () => {
      if (!S.allShown) return;
      if (scrollTick) return;
      scrollTick = requestAnimationFrame(() => {
        scrollTick = 0;
        if (!S.gateArmed && Math.abs(D.stage.scrollTop - S.scrollBase) > 8) S.gateArmed = true;
        updateChrome();
        saveProgress();
        checkGates();
      });
    }, { passive: true });

    // 手指滚动也算“开始读了”
    D.stage.addEventListener('touchmove', () => {
      if (S.auto && S.autoGlide) { S.autoGlide = null; S.autoStepAt = performance.now() + autoWait(); }
      if (S.allShown && !S.gateArmed && Math.abs(D.stage.scrollTop - S.scrollBase) > 8) S.gateArmed = true;
    }, { passive: true });

    // 卡页：点一下 / 滚一下 / 按空格都关掉
    D.gateLayer.addEventListener('click', (e) => {
      e.stopPropagation();
      closeGate();
    });
    D.gateLayer.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY > 2) closeGate();
    }, { passive: false });
    D.gateLayer.addEventListener('touchstart', () => { /* 让 click 处理 */ }, { passive: true });

    // 划词 → 回声
    document.addEventListener('mouseup', () => setTimeout(handleSelection, 10));
    document.addEventListener('touchend', () => setTimeout(handleSelection, 60));
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) hideChip();
    });

    D.selChip.addEventListener('click', (e) => {
      e.stopPropagation();
      const word = D.selChip.dataset.word;
      hideChip();
      clearSelection();
      if (word) openEcho(word, D.selChip.dataset.cur || '');
    });

    // 浮层 / 抽屉里的按钮统一走委托
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      if (act === 'close-drawer') {
        closeDrawer();
      } else if (act === 'echo-close') {
        D.wordLayer.hidden = true;
        D.wordLayer.innerHTML = '';
        echoState = null;
        advance();
      } else if (act === 'echo-next') {
        if (!echoState) return;
        echoState.i = (echoState.i + 1) % echoState.res.refs.length;
        paintEcho();
      } else if (act === 'next') {
        closeAll();
        if (!autoNext()) toast('已经是最后一章了');
      } else if (act === 'prev-ch') {
        jumpChapter(S.chapterIndex - 1);
      } else if (act === 'next-ch') {
        jumpChapter(S.chapterIndex + 1);
      } else if (act === 'chapters') {
        openDrawer('chapters');
      } else if (act === 'words') {
        openDrawer('words');
      } else if (act === 'stories') {
        openDrawer('stories');
      } else if (act === 'restart') {
        setAuto(false);
        closeAll();
        loadChapter(S.chapterIndex, -1);
      } else if (act === 'try-gate') {
        previewGate();
      } else if (act === 'story-read') {
        const id = el.dataset.id;
        const story = (S.stories || []).find((s) => s.id === id);
        closeDrawer();
        if (story) enterStory(story);
      } else if (act === 'story-del') {
        const id = el.dataset.id;
        if (id && confirm('删除这段番外 / 分支？')) {
          XR.Store.deleteStory(id).then(async () => {
            XR.Store.markDirty('stories');
            queueAutoSync();
            S.stories = await XR.Store.listStories(S.book ? S.book.id : '');
            renderStoryList();
            if (S.book) rebuildChapter(true);
          });
        }
      } else if (act === 'gen-run') {
        runGenerator();
      } else if (act === 'generator-config') {
        openDrawer('generator');
      } else if (act === 'gen-backend') {
        const g = XR.Store.loadGenerator();
        g.backend = el.dataset.val;
        XR.Store.saveGenerator(g);
        renderGeneratorConfig();
      } else if (act === 'gen-save') {
        const g = XR.Store.loadGenerator();
        const val = (sel) => { const n = $(sel, D.settings); return n ? n.value : ''; };
        g.llm.baseURL = val('#genLlmUrl');
        g.llm.apiKey = val('#genLlmKey');
        g.llm.model = val('#genLlmModel');
        g.local.baseURL = val('#genLocalUrl');
        g.local.model = val('#genLocalModel');
        g.style = val('#genStyle');
        XR.Store.saveGenerator(g);
        toast('已保存剧情生成设置');
      } else if (act === 'choice-pick') {
        const i = +el.dataset.i;
        const opt = (S.choiceOptions || [])[i];
        closeChoiceLayer();
        if (opt) resolveChoice(opt);
      } else if (act === 'companion-reply') {
        const i = +el.dataset.i;
        const opt = (S.companionReply || [])[i];
        if (opt) {
          const txt = D.companionPanel.querySelector('.cp-text');
          if (txt) txt.textContent = opt.text;
          const optsEl = D.companionPanel.querySelector('.cp-opts');
          if (optsEl) optsEl.innerHTML = '<button class="cp-opt" data-act="companion-more">再聊一句</button>';
        }
      } else if (act === 'companion-more') {
        openCompanion('');
      } else if (act === 'marks') {
        openDrawer('marks');
      } else if (act === 'tts-config') {
        openDrawer('tts');
      } else if (act === 'tts-toggle') {
        ttsToggle();
      } else if (act === 'tts-stop') {
        ttsStop();
      } else if (act === 'tts-test') {
        const tc = XR.Store.loadTts();
        XR.Tts.speak('字流，读到一句，停一下。', { rate: tc.rate, pitch: tc.pitch, volume: tc.volume, voice: tc.voice, lang: 'zh-CN' });
      } else if (act === 'bm-add') {
        addBookmarkNow();
      } else if (act === 'note-add') {
        startNote();
      } else if (act === 'note-save') {
        saveNoteDraft();
      } else if (act === 'note-cancel') {
        cancelNoteDraft();
      } else if (act === 'mark-del') {
        deleteMark(el.dataset.kind, el.dataset.id);
      } else if (act === 'mark-jump') {
        jumpToMark(+el.dataset.ch, +el.dataset.i);
      } else if (act === 'sync-toggle') {
        const cfg = XR.Store.loadSync();
        cfg.enabled = !cfg.enabled;
        XR.Store.saveSync(cfg);
        renderSettings();
        initAutoSync();
        renderSyncDock();
        if (cfg.enabled) toast(cfg.token ? '同步已开：右下角悬浮按钮可随时上传 / 下载' : '同步已开：默认仓库已填好，粘贴令牌即可');
      } else if (act === 'sync-auto') {
        const cfg = XR.Store.loadSync();
        cfg.auto = !cfg.auto;
        XR.Store.saveSync(cfg);
        renderSettings();
        initAutoSync();
      } else if (act === 'sync-content') {
        const cfg = XR.Store.loadSync();
        cfg.content = cfg.content === false; // 当前关 → 开；当前开 → 关
        XR.Store.saveSync(cfg);
        renderSettings();
        toast(cfg.content ? '正文也会同步（只文字，不含插图）' : '正文只留在本机');
        if (cfg.content && cfg.enabled) runSync('both');
      } else if (act === 'sync-test') {
        testSync();
      } else if (act === 'sync-now') {
        runSync('both');
      } else if (act === 'sync-push') {
        runSync('push');
      } else if (act === 'sync-pull') {
        runSync('pull');
      } else if (act === 'sync-content-all') {
        pushAllContent();
      } else if (act === 'sync-repo') {
        const cfg2 = XR.Store.loadSync();
        if (!cfg2.owner || !cfg2.repo) { toast('先填用户名和仓库名'); return; }
        window.open('https://github.com/' + encodeURIComponent(cfg2.owner) + '/' + encodeURIComponent(cfg2.repo) + '/tree/' + encodeURIComponent(cfg2.branch || 'main') + '/' + String(cfg2.dir || 'data').split('/').map(encodeURIComponent).join('/'), '_blank', 'noopener');
      } else if (act === 'export-all') {
        exportBackup(true);
      } else if (act === 'export-sync') {
        exportBackup(false);
      } else if (act === 'import-pick') {
        const inp = $('#backupFile', D.settings);
        if (inp) inp.click();
      } else if (act === 'shelf') {
        backToShelf();
      }
    });

    D.settings.addEventListener('click', (e) => {
      const add = e.target.closest('[data-act="rule-add"]');
      if (add) { addRule(); return; }
      const del = e.target.closest('[data-act="rule-del"]');
      if (del) {
        const row = del.closest('.rule-row');
        if (row) delRule(+row.dataset.i);
        return;
      }
      const tg = e.target.closest('[data-act="rule-toggle"]');
      if (tg) {
        const row = tg.closest('.rule-row');
        if (row) toggleRule(+row.dataset.i);
        return;
      }
      const chap = e.target.closest('.chap-item');
      if (chap) { jumpChapter(+chap.dataset.ch); return; }
      const nb = e.target.closest('.nb-item');
      if (nb) {
        const word = nb.dataset.word;
        closeDrawer();
        openEcho(word);
      }
    });

    D.choiceLayer.addEventListener('click', (e) => {
      if (e.target.closest('.choice-opt')) return;  // 按钮交给 data-act 委托
      e.stopPropagation();
      if (S.choiceKind === 'entry') { closeChoiceLayer(); advance(); return; }
      if (S.choiceKind === 'story-end') { closeChoiceLayer(); S.ended = false; exitStory(); return; }
      // 「全书完」轻点空白就收起，还能回头再看看最后几句；再点一下还会出来
      const wasEnded = S.ended;
      D.choiceLayer.hidden = true;
      D.choiceLayer.innerHTML = '';
      S.ended = false;
      if (wasEnded) {
        S.index = Math.max(0, S.beats.length - 1);
        updateChrome();
        saveProgress();
      }
    });

    D.wordLayer.addEventListener('click', (e) => {
      if (e.target === D.wordLayer) {
        e.stopPropagation();
        D.wordLayer.hidden = true;
        D.wordLayer.innerHTML = '';
        echoState = null;
        advance();
      }
    });

    // 键盘
    document.addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (S.view !== 'reader') {
        if (e.key === 'Enter' && S.view === 'shelf') D.dropzone.click();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key === 'Escape') {
        if (!D.settings.hidden) { closeDrawer(); return; }
        closeAll();
        return;
      }
      if (!D.settings.hidden) return;
      if (!D.gateLayer.hidden) {
        if (/^( |Enter|Escape|ArrowRight|ArrowDown|PageDown)$/.test(e.key)) {
          e.preventDefault();
          closeGate();
        }
        return;
      }
      if (!D.choiceLayer.hidden) {
        if (/^( |Enter|ArrowRight|ArrowDown|PageDown)$/.test(e.key)) {
          e.preventDefault();
          if (S.choiceKind === 'entry') { closeChoiceLayer(); advance(); return; }
          if (S.choiceKind === 'story-end') { closeChoiceLayer(); S.ended = false; exitStory(); return; }
          const wasEnded = S.ended;
          D.choiceLayer.hidden = true;
          D.choiceLayer.innerHTML = '';
          S.ended = false;
          if (wasEnded) {
            S.index = Math.max(0, S.beats.length - 1);
            updateChrome();
            saveProgress();
          }
        }
        return;
      }
      if (!D.wordLayer.hidden) {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
          e.preventDefault();
          D.wordLayer.hidden = true;
          D.wordLayer.innerHTML = '';
          echoState = null;
          advance();
        }
        return;
      }
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        advance();
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault();
        goBack();
      } else if (e.key === 'a' || e.key === 'A') {
        toggleAuto();
      } else if (e.key === 'm' || e.key === 'M') {
        openDrawer('chapters');
      } else if (e.key === '/') {
        e.preventDefault();
        openSearch();
      } else if (e.key === '[') {
        jumpChapter(S.chapterIndex - 1);
      } else if (e.key === ']') {
        jumpChapter(S.chapterIndex + 1);
      } else if (e.key === 'c' || e.key === 'C') {
        openCompanion();
      } else if (e.key === 'x' || e.key === 'X') {
        openDrawer('stories');
      } else if (e.key === 'z' || e.key === 'Z') {
        const lines = D.beats.querySelectorAll('.beat');
        if (S.motion && lines.length) S.motion.wave(lines[lines.length - 1]);
      } else if (e.key === 'b' || e.key === 'B') {
        addBookmarkNow();
      } else if (e.key === 'n' || e.key === 'N') {
        startNote();
      } else if (e.key === 't' || e.key === 'T') {
        ttsToggle();
      }
    });
  }

  /* ============================================================
     书签 / 笔记
     ============================================================ */
  function beatIndexAtView() {
    if (!S.beats.length) return 0;
    if (!S.allShown) return Math.max(0, Math.min(S.beats.length - 1, S.index));
    // 整章模式：取视野里最靠上的一句，作为“我读到这儿了”
    const top = D.stage.getBoundingClientRect().top + 40;
    const list = D.beats.querySelectorAll('.beat');
    let idx = 0;
    for (const el of list) {
      if (!el._beat) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > top) { idx = Math.max(0, S.beats.indexOf(el._beat)); break; }
    }
    return idx;
  }

  function posNow() {
    const idx = beatIndexAtView();
    const b = S.beats[idx];
    return {
      chapterIndex: S.chapterIndex,
      index: idx,
      quote: b && b.text ? String(b.text).slice(0, 90) : ''
    };
  }

  async function refreshMarks() {
    if (!S.book) { S.marks = { bookmarks: [], notes: [] }; S.markCount = 0; return; }
    S.marks = {
      bookmarks: await XR.Store.listBookmarks(S.book.id),
      notes: await XR.Store.listNotes(S.book.id)
    };
    S.markCount = S.marks.bookmarks.length + S.marks.notes.length;
  }

  async function addBookmarkNow() {
    if (!S.book) { toast('先打开一本书'); return; }
    const p = posNow();
    await XR.Store.saveBookmark({
      bookId: S.book.id, chapterIndex: p.chapterIndex, index: p.index, scene: p.quote
    });
    await XR.Store.markDirty('bookmarks');
    queueAutoSync();
    await refreshMarks();
    toast('已夹上书签 · 第 ' + (p.chapterIndex + 1) + ' 章');
    if (S.drawerView === 'marks') renderMarks();
  }

  function startNote() {
    if (!S.book) { toast('先打开一本书'); return; }
    const p = posNow();
    S.noteDraft = { chapterIndex: p.chapterIndex, index: p.index, quote: p.quote, text: '' };
    // 已经在书签页时不能再走 openDrawer（那会当成“再点一次 = 关掉”）
    if (D.settings.hidden) openDrawer('marks');
    else { S.drawerView = 'marks'; D.settings.scrollTop = 0; renderMarks(); }
  }

  async function saveNoteDraft() {
    if (!S.book || !S.noteDraft) return;
    const ta = $('#noteText', D.settings);
    const text = ta ? ta.value.trim() : '';
    if (!text) { toast('笔记还是空的'); return; }
    await XR.Store.saveNote({
      bookId: S.book.id,
      chapterIndex: S.noteDraft.chapterIndex,
      index: S.noteDraft.index,
      quote: S.noteDraft.quote,
      text
    });
    await XR.Store.markDirty('notes');
    queueAutoSync();
    S.noteDraft = null;
    await refreshMarks();
    renderMarks();
    toast('笔记已收进这本书');
  }

  function cancelNoteDraft() {
    S.noteDraft = null;
    renderMarks();
  }

  function jumpToMark(chapterIndex, index) {
    if (!S.book) return;
    closeDrawer();
    setAuto(false);
    const ci = Math.max(0, Math.min((S.book.chapters.length || 1) - 1, Number(chapterIndex) || 0));
    loadChapter(ci, typeof index === 'number' && index >= 0 ? index : -1);
  }

  async function deleteMark(kind, id) {
    if (!id) return;
    if (!confirm(kind === 'note' ? '删掉这条笔记？' : '取掉这枚书签？')) return;
    if (kind === 'note') await XR.Store.deleteNote(id);
    else await XR.Store.deleteBookmark(id);
    await XR.Store.markDirty(kind === 'note' ? 'notes' : 'bookmarks');
    queueAutoSync();
    await refreshMarks();
    renderMarks();
  }

  function markWhen(t) {
    const d = new Date(Number(t) || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  async function renderMarks() {
    if (!S.book) {
      D.settings.innerHTML = drawerHead('书签与笔记') + '<p class="story-empty">先打开一本书。</p>';
      return;
    }
    await refreshMarks();
    const bms = S.marks.bookmarks.map((b) =>
      '<div class="mark-item">' +
      '<button class="mi-main" data-act="mark-jump" data-ch="' + b.chapterIndex + '" data-i="' + b.index + '">' +
      '<span class="mi-meta">书签 · 第 ' + (b.chapterIndex + 1) + ' 章 · ' + markWhen(b.createdAt) + '</span>' +
      '<span class="mi-text">' + esc(b.scene || '（这一句）') + '</span>' +
      '</button>' +
      '<button class="mi-del" data-act="mark-del" data-kind="bookmark" data-id="' + escAttr(b.id) + '" aria-label="删除书签">✕</button>' +
      '</div>').join('');
    const nts = S.marks.notes.map((n) =>
      '<div class="mark-item note">' +
      '<button class="mi-main" data-act="mark-jump" data-ch="' + n.chapterIndex + '" data-i="' + n.index + '">' +
      '<span class="mi-meta">笔记 · 第 ' + (n.chapterIndex + 1) + ' 章 · ' + markWhen(n.createdAt) + '</span>' +
      (n.quote ? '<span class="mi-quote">「' + esc(n.quote) + '」</span>' : '') +
      '<span class="mi-text">' + esc(n.text) + '</span>' +
      '</button>' +
      '<button class="mi-del" data-act="mark-del" data-kind="note" data-id="' + escAttr(n.id) + '" aria-label="删除笔记">✕</button>' +
      '</div>').join('');

    const draft = S.noteDraft
      ? '<div class="note-draft">' +
        (S.noteDraft.quote ? '<p class="nd-quote">「' + esc(S.noteDraft.quote) + '」</p>' : '') +
        '<textarea class="gen-area" id="noteText" placeholder="这一句让你想到什么？">' + esc(S.noteDraft.text || '') + '</textarea>' +
        '<div class="sync-row"><button class="btn small" data-act="note-save">保存笔记</button>' +
        '<button class="btn small ghost" data-act="note-cancel">取消</button></div></div>'
      : '<div class="sync-row"><button class="btn small" data-act="bm-add">＋ 夹书签</button>' +
        '<button class="btn small" data-act="note-add">✎ 写笔记</button></div>';

    D.settings.innerHTML =
      drawerHead('书签与笔记') +
      '<div class="field"><div class="field-label"><span>这一句</span><b>' +
      (S.marks.bookmarks.length + S.marks.notes.length) + ' 条</b></div>' + draft + '</div>' +
      (bms || nts
        ? '<div class="mark-list">' + bms + nts + '</div>'
        : '<p class="story-empty">还没有书签或笔记。读到想留住的地方，按 B 夹书签，按 N 写笔记。</p>');
  }

  /* ============================================================
     朗读（本地 Web Speech，不联网）
     ============================================================ */
  function ttsBeats() {
    return Array.from(D.beats.querySelectorAll('.beat')).filter(
      (el) => el._beat && el._beat.kind === 'line' && el._beat.text
    );
  }

  function ttsHighlight(el) {
    D.beats.querySelectorAll('.beat.tts-on').forEach((x) => x.classList.remove('tts-on'));
    if (!el) return;
    el.classList.add('tts-on');
    const cfg = XR.Store.loadTts();
    if (cfg.scroll !== false && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ }
    }
  }

  function ttsSpeakIndex(i) {
    const list = ttsBeats();
    if (!list.length) { ttsStop(true); return; }
    const idx = Math.max(0, Math.min(list.length - 1, i));
    const el = list[idx];
    S.tts.cursor = idx;
    ttsHighlight(el);
    const cfg = XR.Store.loadTts();
    const text = (el._beat && el._beat.text) || el.textContent || '';
    const lang = /[\u3400-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
    XR.Tts.speak(text, {
      rate: cfg.rate, pitch: cfg.pitch, volume: cfg.volume, voice: cfg.voice, lang, tag: idx
    });
  }

  function ttsNext() {
    if (!S.tts.on) return;
    const cfg = XR.Store.loadTts();
    if (cfg.follow === false) { ttsStop(true); return; }
    const list = ttsBeats();
    if (S.tts.cursor + 1 < list.length) { ttsSpeakIndex(S.tts.cursor + 1); return; }
    // 本章这一屏读完了：整章模式直接下一章；逐句模式先放一句出来再读
    if (S.allShown) {
      if (autoNext()) setTimeout(() => { if (S.tts.on) ttsSpeakIndex(0); }, 500);
      else ttsStop(true);
      return;
    }
    S.tts.step = true;
    advance();
    setTimeout(() => {
      S.tts.step = false;
      if (!S.tts.on) return;
      const now = ttsBeats();
      if (now.length > S.tts.cursor) ttsSpeakIndex(S.tts.cursor + 1);
      else ttsStop(true);
    }, 420);
  }

  function ttsStart() {
    if (!XR.Tts.supported()) { toast('这个浏览器不支持本地朗读', true); return; }
    if (!S.book) { toast('先打开一本书'); return; }
    setAuto(false);
    S.tts.on = true;
    if (D.btnTts) { D.btnTts.textContent = '❚❚'; D.btnTts.classList.add('on'); }
    const list = ttsBeats();
    const top = D.stage.getBoundingClientRect().top + 40;
    let i = list.findIndex((el) => el.getBoundingClientRect().bottom > top);
    if (i < 0) i = Math.max(0, list.length - 1);
    ttsSpeakIndex(i);
    toast('开始朗读 · 再点一下停');
  }

  function ttsStop(silent) {
    S.tts.on = false;
    S.tts.cursor = -1;
    S.tts.step = false;
    try { XR.Tts.stop(); } catch (e) { /* ignore */ }
    D.beats.querySelectorAll('.beat.tts-on').forEach((x) => x.classList.remove('tts-on'));
    if (D.btnTts) { D.btnTts.textContent = '♪'; D.btnTts.classList.remove('on'); }
    if (!silent) toast('朗读已停');
  }

  function ttsToggle() {
    if (S.tts.on) ttsStop();
    else ttsStart();
  }

  function renderTtsConfig() {
    const cfg = XR.Store.loadTts();
    const voices = XR.Tts.voices();
    const opts = ['<option value="">跟随系统</option>'].concat(
      voices.map((v) => '<option value="' + escAttr(v.voiceURI) + '"' +
        (cfg.voice === v.voiceURI ? ' selected' : '') + '>' +
        esc(v.name) + ' · ' + esc(v.lang) + '</option>')
    ).join('');
    D.settings.innerHTML =
      drawerHead('朗读') +
      '<div class="field"><div class="field-label"><span>语速</span><b id="lblTtsRate">' + cfg.rate.toFixed(1) + '×</b></div>' +
      '<input type="range" id="rngTtsRate" min="6" max="20" step="1" value="' + Math.round(cfg.rate * 10) + '"></div>' +
      '<div class="field"><div class="field-label"><span>音色</span><b>' + (voices.length || 0) + ' 个可选</b></div>' +
      '<select class="gen-input" id="selTtsVoice">' + opts + '</select>' +
      '<p class="gen-note">用的是系统自带语音，不联网、不上传文本。Chrome 里音色列表有时要等一秒才出来。</p></div>' +
      '<div class="field"><div class="toggle"><span>读完一句自动读下一句</span><button class="switch ' + (cfg.follow ? 'on' : '') + '" id="tgTtsFollow"></button></div>' +
      '<div class="toggle"><span>读到哪句就滚到哪句</span><button class="switch ' + (cfg.scroll ? 'on' : '') + '" id="tgTtsScroll"></button></div></div>' +
      '<div class="sync-row"><button class="btn small" data-act="tts-test">试听一句</button>' +
      '<button class="btn small ghost" data-act="tts-stop">停止</button></div>' +
      '<button class="btn full" data-act="tts-toggle">♪ 从当前这句开始读</button>' +
      '<p class="drawer-foot">快捷键 T 开关朗读；朗读时手动翻页会先停下，避免抢节奏。</p>';
    bindTtsConfig();
  }

  function bindTtsConfig() {
    const cfg = XR.Store.loadTts();
    const rate = $('#rngTtsRate', D.settings);
    if (rate) {
      rate.addEventListener('input', () => {
        cfg.rate = Math.max(0.5, Math.min(2, (+rate.value) / 10));
        const lbl = $('#lblTtsRate', D.settings);
        if (lbl) lbl.textContent = cfg.rate.toFixed(1) + '×';
        XR.Store.saveTts(cfg);
      });
    }
    const voice = $('#selTtsVoice', D.settings);
    if (voice) {
      voice.addEventListener('change', () => {
        cfg.voice = voice.value;
        XR.Store.saveTts(cfg);
      });
    }
    const follow = $('#tgTtsFollow', D.settings);
    if (follow) {
      follow.addEventListener('click', () => {
        cfg.follow = !cfg.follow;
        follow.classList.toggle('on', cfg.follow);
        XR.Store.saveTts(cfg);
      });
    }
    const scroll = $('#tgTtsScroll', D.settings);
    if (scroll) {
      scroll.addEventListener('click', () => {
        cfg.scroll = !cfg.scroll;
        scroll.classList.toggle('on', cfg.scroll);
        XR.Store.saveTts(cfg);
      });
    }
  }

  /* ============================================================
     云同步（GitHub 私有仓库）
     ============================================================ */
  /* 令牌长得对不对：gho_/ghp_/ghu_/ghs_（经典 / OAuth）或 github_pat_（fine-grained）。
     私有仓库 + 无效令牌时 GitHub 返回的是 404，看起来像“仓库找不到”，
     所以先在这里拦一道，省得对着仓库名怀疑半天。 */
  function tokenLooksOk(t) {
    const v = String(t || '').trim();
    return /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(v);
  }

  /* ?sync=owner/repo&branch=main&dir=data —— 只预填仓库名，不带令牌 */
  function applySyncPreset() {
    try {
      const q = new URLSearchParams(location.search);
      const raw = q.get('sync');
      if (!raw) return null;
      const parts = String(raw).split('/').map((x) => x.trim()).filter(Boolean);
      if (parts.length < 2) return null;
      const cfg = XR.Store.loadSync();
      cfg.owner = parts[0];
      cfg.repo = parts[1];
      if (q.get('branch')) cfg.branch = q.get('branch');
      if (q.get('dir')) cfg.dir = q.get('dir');
      XR.Store.saveSync(cfg);
      return cfg.owner + '/' + cfg.repo;
    } catch (e) {
      return null;
    }
  }

  function syncWhen(t) {
    if (!t) return '还没同步过';
    return new Date(Number(t)).toLocaleString();
  }

  function syncSettingsHTML() {
    const cfg = XR.Store.loadSync();
    const st = S.syncState || {};
    const state = st.lastError
      ? '上次出错：' + esc(st.lastError)
      : '上次同步：' + syncWhen(st.lastPushAt || st.lastPullAt);
    return '<div class="field sync-field"><div class="field-label"><span>云同步 · GitHub 私有仓库</span><b>' +
      (cfg.enabled ? '已开' : '关') + '</b></div>' +
      '<div class="toggle"><span>启用同步</span><button class="switch ' + (cfg.enabled ? 'on' : '') + '" data-act="sync-toggle"></button></div>' +
      '<input class="gen-input sync-input" id="syncOwner" data-key="owner" placeholder="GitHub 用户名" value="' + escAttr(cfg.owner) + '">' +
      '<input class="gen-input sync-input" id="syncRepo" data-key="repo" placeholder="仓库名（私有）" value="' + escAttr(cfg.repo) + '">' +
      '<input class="gen-input sync-input" id="syncBranch" data-key="branch" placeholder="分支（默认 main）" value="' + escAttr(cfg.branch) + '">' +
      '<input class="gen-input sync-input" id="syncDir" data-key="dir" placeholder="目录（默认 data）" value="' + escAttr(cfg.dir) + '">' +
      '<input class="gen-input sync-input" id="syncToken" data-key="token" type="password" autocomplete="off" spellcheck="false" placeholder="访问令牌：ghp_… 或 github_pat_…" value="' + escAttr(cfg.token) + '">' +
      '<div class="toggle"><span>自动同步（启动 / 每 ' + cfg.interval + ' 分钟 / 联网时）</span><button class="switch ' +
      (cfg.auto ? 'on' : '') + '" data-act="sync-auto"></button></div>' +
      '<div class="toggle"><span>正文也同步（默认开：换设备点书即自动下载）</span><button class="switch ' +
      (cfg.content !== false ? 'on' : '') + '" data-act="sync-content"></button></div>' +
      '<div class="sync-row"><button class="btn small" data-act="sync-test">测试连接</button>' +
      '<button class="btn small" data-act="sync-now">⟲ 双向同步</button></div>' +
      '<div class="sync-row"><button class="btn small ghost" data-act="sync-push">↑ 仅上传</button>' +
      '<button class="btn small ghost" data-act="sync-pull">↓ 仅下载</button></div>' +
      '<div class="sync-row"><button class="btn small ghost" data-act="sync-content-all">⧉ 补传全部正文</button>' +
      '<button class="btn small ghost" data-act="sync-repo">打开数据仓库</button></div>' +
      '<p class="sync-state" id="syncState">' + state + '</p>' +
      '<p class="gen-note">默认仓库已填好 <b>' + esc(cfg.owner || 'rregjn24fw') + '/' + esc(cfg.repo || 'ziliu-sync') + '</b>，只差令牌。' +
      '首次配置：<a href="https://github.com/settings/personal-access-tokens/new?name=ziliu-sync&description=%E5%AD%97%E6%B5%81%E9%98%85%E8%AF%BB%E6%95%B0%E6%8D%AE%E5%90%8C%E6%AD%A5&expires_in=90&contents=write&metadata=read" target="_blank" rel="noopener">生成令牌</a>（Repository access 选这个仓库，Contents 选 Read and write）→ 粘贴到上面 → 测试连接 → 立即同步。令牌只存本机 localStorage，不会上传。' +
      '冲突按每条记录的更新时间取新；删除会留墓碑，不会“复活”。离线时照常读写本地，联网或下次启动自动补同步。</p></div>';
  }

  function backupSettingsHTML() {
    return '<div class="field"><div class="field-label"><span>备份 · 导入导出</span><b>JSON</b></div>' +
      '<div class="sync-row"><button class="btn small" data-act="export-all">导出全部（含正文）</button>' +
      '<button class="btn small ghost" data-act="export-sync">只导阅读数据</button></div>' +
      '<div class="sync-row"><button class="btn small ghost" data-act="import-pick">导入备份…</button></div>' +
      '<input type="file" id="backupFile" accept=".json,application/json" hidden>' +
      '<p class="gen-note">导出文件包含书清单、进度、书签、笔记、番外、阿泠与设置；「含正文」会大一些，但换设备能直接读。插图不导出。</p></div>';
  }

  function downloadJSON(name, obj) {
    try {
      const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    } catch (e) {
      toast('导出失败：' + e.message, true);
    }
  }

  async function exportBackup(withContent) {
    const snap = await XR.Store.exportAll({ content: withContent });
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = 'ziliu-' + (withContent ? 'backup' : 'reading') + '-' +
      d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
    downloadJSON(name, snap);
    toast('已导出 ' + name);
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const snap = JSON.parse(text);
      const counts = await XR.Store.importAll(snap);
      await refreshMarks();
      await renderShelf();
      toast('已导入：书 ' + counts.books + ' · 进度 ' + counts.progress +
        ' · 书签 ' + counts.bookmarks + ' · 笔记 ' + counts.notes);
    } catch (e) {
      toast('导入失败：' + (e && e.message ? e.message : e), true);
    }
  }

  async function runSync(mode) {
    if (S.syncBusy) return;
    const cfg = XR.Store.loadSync();
    if (!cfg.enabled) { toast('先在设置里打开「启用同步」'); return; }
    if (!cfg.owner || !cfg.repo || !cfg.token) { toast('用户名 / 仓库 / 令牌还没填全'); return; }
    if (!tokenLooksOk(cfg.token)) { toast('令牌看起来不对：应以 gho_ / ghp_ / github_pat_ 开头（现在填的是「' + String(cfg.token).slice(0, 6) + '…」）', true); return; }
    S.syncBusy = true;
    if (D.syncMain) D.syncMain.classList.add('busy');
    dockState('busy', '同步中…');
    const label = mode === 'pull' ? '拉取中…' : mode === 'push' ? '上传中…' : '同步中…';
    toast(label);
    try {
      const sum = await XR.Sync.syncNow(cfg, {
        // 仅上传：先拉一次合并再推，但不应用远端覆盖（避免把本机正在读的书换掉）
        push: mode !== 'pull',
        skipApply: mode === 'push',
        confirmPull: async (info) => {
          if (mode === 'push') return false;
          const labels = { books: '书清单', progress: '阅读进度', bookmarks: '书签', notes: '笔记', stories: '番外', companion: '阿泠', settings: '设置' };
          const parts = info.kinds.map((k) => (labels[k.kind] || k.kind) + ' ' + k.n + ' 处').join('、');
          return window.confirm('云端有 ' + info.total + ' 处更新比本地新（' + parts + '）。\n\n确定 = 用云端覆盖本地\n取消 = 保留本地，跳过这些数据');
        }
      });
      S.syncState = await XR.Store.getSyncState();
      cfg.lastAt = Date.now();
      cfg.lastStatus = sum.errors.length ? sum.errors[0] : 'ok';
      XR.Store.saveSync(cfg);
      await refreshMarks();
      if (S.drawerView === 'settings') renderSettings();
      if (S.drawerView === 'marks') renderMarks();
      if (sum.errors.length) {
        dockState('err', sum.errors[0]);
        toast('同步有问题：' + sum.errors[0], true);
      } else if (sum.contentPushed || sum.contentPulled) {
        dockState('ok', '正文 上传 ' + sum.contentPushed + ' / 下载 ' + sum.contentPulled);
        toast('✓ 同步成功 · 正文上传 ' + sum.contentPushed + ' 本 / 下载 ' + sum.contentPulled + ' 本' +
          (sum.pushed || sum.pulled ? '，数据 ' + sum.pushed + ' 推 / ' + sum.pulled + ' 拉' : ''));
      } else if (sum.pushed > 0 && sum.pulled > 0) {
        dockState('ok', '上次同步：' + syncWhen(Date.now()));
        toast('✓ 同步成功 · 推送到云端 ' + sum.pushed + ' 处，拉取 ' + sum.pulled + ' 处');
      } else if (sum.pushed > 0) {
        dockState('ok', '上次同步：' + syncWhen(Date.now()));
        toast('✓ 已推送到云端 ' + sum.pushed + ' 处' + (sum.files.length ? '（' + sum.files.length + ' 个文件）' : ''));
      } else if (sum.pulled > 0) {
        dockState('ok', '上次同步：' + syncWhen(Date.now()));
        toast('✓ 已从云端拉取 ' + sum.pulled + ' 处');
      } else {
        dockState('ok', '已是最新');
        toast('✓ 已是最新，无需同步');
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      cfg.lastStatus = msg;
      XR.Store.saveSync(cfg);
      dockState('err', msg);
      toast('同步失败：' + msg, true);
    } finally {
      S.syncBusy = false;
      if (D.syncMain) D.syncMain.classList.remove('busy');
    }
  }

  /* ============================================================
     悬浮同步坞
     ============================================================ */
  function dockState(state, tip) {
    if (!D.syncDot) return;
    D.syncDot.dataset.state = state || 'off';
    if (tip) D.syncDot.title = tip;
  }

  function renderSyncDock() {
    if (!D.syncDock) return;
    const cfg = XR.Store.loadSync();
    const ready = cfg.enabled && cfg.owner && cfg.repo && cfg.token;
    D.syncDock.hidden = !cfg.enabled;
    if (!cfg.enabled) return;
    const st = S.syncState || {};
    if (!ready) dockState('off', '还缺仓库信息或令牌');
    else if (st.lastError) dockState('err', '上次出错：' + st.lastError);
    else if (st.lastPushAt || st.lastPullAt) dockState('ok', '上次同步：' + syncWhen(st.lastPushAt || st.lastPullAt));
    else dockState('off', '还没同步过');
  }

  /* 正文专项：把所有本机有正文的书重新推一遍（用于早期版本漏传） */
  async function pushAllContent() {
    const cfg = XR.Store.loadSync();
    if (!cfg.enabled || !cfg.owner || !cfg.repo || !cfg.token) { toast('先配好同步仓库和令牌', true); return; }
    if (S.syncBusy) return;
    S.syncBusy = true;
    dockState('busy', '正在上传正文…');
    toast('正在上传全部正文…');
    try {
      const snap = await XR.Store.syncSnapshot();
      const books = (snap.books || []).filter((b) => !b.deleted && !b.ghost);
      let ok = 0;
      const errs = [];
      for (const b of books) {
        try {
          const local = await XR.Store.getBookContent(b.id);
          if (!local || !local.chapters || !local.chapters.length) continue;
          const path = (cfg.dir || 'data') + '/content/' + b.id + '.json';
          const remote = await XR.Sync.getFile(cfg, path);
          const text = JSON.stringify({ id: b.id, title: b.title || '', updatedAt: Number(b.updatedAt) || Date.now(), chapters: local.chapters, stats: local.stats || {} });
          await XR.Sync.putFile(cfg, path, text, (remote && remote.sha) || '', 'ziliu: content ' + (b.title || b.id));
          ok++;
        } catch (e) {
          errs.push((b.title || b.id) + '：' + (e && e.message ? e.message : e));
        }
      }
      if (errs.length) {
        dockState('err', errs[0]);
        toast('正文上传 ' + ok + ' 本，失败 ' + errs.length + ' 本：' + errs[0], true);
      } else if (ok) {
        dockState('ok', '正文已上传 ' + ok + ' 本');
        toast('✓ 正文已上传 ' + ok + ' 本到 GitHub');
      } else {
        toast('本机没有可上传的正文（书都是云端记录）', true);
      }
    } finally {
      S.syncBusy = false;
    }
  }

  function bindSyncDock() {
    if (!D.syncDock) return;
    // 触屏没有 hover：点一下主按钮先展开（再点执行同步）
    D.syncDock.addEventListener('touchstart', () => D.syncDock.classList.add('open'), { passive: true });
    D.syncMain.addEventListener('click', () => {
      if (!D.syncDock.classList.contains('open') && matchMedia('(hover: none)').matches) {
        D.syncDock.classList.add('open');
        return; // 第一次点只展开
      }
    }, true);
    D.syncDock.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sd]');
      if (!btn) return;
      const act = btn.dataset.sd;
      if (S.syncBusy && act !== 'settings') { toast('正在同步中，稍等…'); return; }
      if (act === 'both') runSync('both');
      else if (act === 'push') runSync('push');
      else if (act === 'pull') runSync('pull');
      else if (act === 'content') pushAllContent();
      else if (act === 'settings') {
        // 设置抽屉挂在阅读器里；书架上点 ⚙ 就直接打开同步开关
        if (D.reader && !D.reader.hidden) openDrawer('settings');
        else {
          const cfg2 = XR.Store.loadSync();
          if (!cfg2.enabled) {
            cfg2.enabled = true;
            XR.Store.saveSync(cfg2);
            initAutoSync();
            toast('同步已开启：阅读页面 ⚙ 里粘贴令牌即可使用');
          } else {
            toast('设置在阅读页面：打开一本书 → ⚙ → 云同步');
          }
        }
      }
    });
  }

  async function testSync() {
    const cfg = XR.Store.loadSync();
    if (!cfg.owner || !cfg.repo || !cfg.token) { toast('用户名 / 仓库 / 令牌还没填全'); return; }
    if (!tokenLooksOk(cfg.token)) { toast('令牌看起来不对：应以 gho_ / ghp_ / github_pat_ 开头', true); return; }
    toast('正在测试…');
    try {
      const r = await XR.Sync.test(cfg);
      let extra = '';
      if (r.canWrite === false) extra = ' · 令牌只有读权限（同步还需要写权限）';
      else if (r.canWrite === null) extra = ' · 已能读到仓库，写权限将在同步时验证';
      toast('连接成功：' + r.fullName + (r.private ? '（私有）' : '（公开）') + extra);
    } catch (e) {
      toast('连接失败：' + (e && e.message ? e.message : e), true);
    }
  }

  function queueAutoSync(delay) {
    const cfg = XR.Store.loadSync();
    if (!cfg.enabled || !cfg.auto) return;
    clearTimeout(S.syncTimer);
    S.syncTimer = setTimeout(() => { runSync('both'); }, Math.max(1500, delay || 3000));
  }

  function initAutoSync() {
    const cfg = XR.Store.loadSync();
    clearInterval(S.syncLoop);
    renderSyncDock();
    // 关掉自动同步时，悬浮坞仍要显示（手动同步随时可用）
    if (!cfg.enabled || !cfg.auto) return;
    S.syncLoop = setInterval(() => {
      if (!document.hidden) runSync('both');
    }, cfg.interval * 60000);
    queueAutoSync(2500);
    // 换设备首次打开：同步开着就立刻拉一轮，把云端书直接落到书架
    if (!cfg.lastAt) setTimeout(() => { runSync('both'); }, 600);
    if (!S.onlineBound && typeof window !== 'undefined') {
      S.onlineBound = true;
      window.addEventListener('online', () => queueAutoSync(1200));
    }
  }

  /* ============================================================
     启动
     ============================================================ */
  function cache() {
    D.shelf = $('#shelf');
    D.dropzone = $('#dropzone');
    D.fileInput = $('#fileInput');
    D.status = $('#status');
    D.bookList = $('#bookList');
    D.shelfEmpty = $('#shelfEmpty');
    D.btnSample = $('#btnSample');
    D.btnTheme = $('#btnTheme');

    D.reader = $('#reader');
    D.btnBack = $('#btnBack');
    D.chapterTitle = $('#chapterTitle');
    D.progressTrack = $('#progressTrack');
    D.progressBar = $('#progressBar');
    D.progressKnob = $('#progressKnob');
    D.progressTip = $('#progressTip');
    D.btnChapters = $('#btnChapters');
    D.btnSearch = $('#btnSearch');
    D.btnStory = $('#btnStory');
    D.btnCompanion = $('#btnCompanion');
    D.btnMarks = $('#btnMarks');
    D.btnTts = $('#btnTts');
    D.btnAuto = $('#btnAuto');
    D.btnSettings = $('#btnSettings');
    D.stage = $('#stage');
    D.beats = $('#beats');
    D.btnNext = $('#btnNext');
    D.wordLayer = $('#wordLayer');
    D.choiceLayer = $('#choiceLayer');
    D.gateLayer = $('#gateLayer');
    D.settings = $('#settings');
    D.selChip = $('#selChip');
    D.companionBubble = $('#companionBubble');
    D.companionPanel = $('#companionPanel');

    D.toast = $('#toast');
    D.syncDock = $('#syncDock');
    D.syncMain = $('#syncDock .sd-main');
    D.syncDot = $('#syncDock .sd-dot');
    bindSyncDock();
    D.crash = $('#crash');
    D.crashMsg = $('#crashMsg');
  }

  function setupIO() {
    if (typeof IntersectionObserver === 'undefined') return;
    S.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        en.target.classList.add('alive');
      }
    }, { root: D.stage, rootMargin: '16% 0px 16% 0px', threshold: 0.1 });
  }

  async function init() {
    cache();
    S.settings = XR.Store.loadSettings();
    if (window.innerWidth < 560 && S.settings.base === 26) S.settings.base = 21;
    try {
      S.companion = (await XR.Store.getCompanion()) || XR.Companion.defaultState();
    } catch (e) {
      S.companion = XR.Companion.defaultState();
    }
    try { S.syncState = await XR.Store.getSyncState(); } catch (e) { S.syncState = null; }
    S.syncPreset = applySyncPreset();
    try { await refreshMarks(); } catch (e) { /* ignore */ }
    applySettings();
    setupIO();
    bind();
    if (XR.Motion) {
      S.motion = XR.Motion.attach({
        stage: D.stage,
        beats: D.beats,
        getLevel: () => S.settings.jump || 0
      });
    }
    if (XR.Tts && XR.Tts.supported()) {
      // Chrome 的音色列表是异步加载的：加载完如果正停在朗读设置页，重画一次
      if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
        window.speechSynthesis.addEventListener('voiceschanged', () => {
          if (S.drawerView === 'tts') renderTtsConfig();
        });
      }
      XR.Tts.on('end', () => { if (S.tts.on && !S.tts.step) ttsNext(); });
      XR.Tts.on('error', (e) => {
        if (!S.tts.on || (e && (e.error === 'interrupted' || e.error === 'canceled'))) return;
        ttsStop(true);
        toast('朗读中断了：' + ((e && e.error) || '未知原因'), true);
      });
    }
    initAutoSync();
    renderShelf().catch((e) => console.error(e));
    if (S.syncPreset) {
      setTimeout(() => toast('云同步仓库已填好：' + S.syncPreset + ' · 打开一本书 → 设置 → 云同步，粘贴令牌即可'), 900);
    }
    if (!XR.Store.getFlag('hello')) {
      XR.Store.setFlag('hello', 1);
      setTimeout(() => companionSay('first-open', {}), 1000);
    }
  }

  window.addEventListener('error', (e) => {
    if (!D.crash) return;
    D.crash.hidden = false;
    D.crashMsg.textContent = (e.message || '未知错误') + '\n' + (e.filename || '') + ':' + (e.lineno || '') + '\n\n' + (e.error && e.error.stack ? e.error.stack : '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (!D.crash) return;
    const r = e.reason;
    D.crash.hidden = false;
    D.crashMsg.textContent = 'Promise 未捕获：' + (r && r.message ? r.message : r) + '\n\n' + (r && r.stack ? r.stack : '');
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

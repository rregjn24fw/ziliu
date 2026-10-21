/* ============================================================
   store.js — 书的持久化（IndexedDB，失败自动降级到内存）
   ============================================================ */
(function () {
  'use strict';
  const XR = (window.XR = window.XR || {});

  const DB_NAME = 'ziliu';
  const DB_VER = 2;
  const SETTINGS_KEY = 'ziliu.settings.v1';

  const memory = { books: new Map(), progress: new Map(), stories: new Map(), companion: null };
  let db = null;
  let mode = 'memory';

  function openDB() {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        return resolve(null);
      }
      const timer = setTimeout(() => resolve(null), 2500);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('progress')) d.createObjectStore('progress', { keyPath: 'bookId' });
        if (!d.objectStoreNames.contains('stories')) d.createObjectStore('stories', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('companion')) d.createObjectStore('companion', { keyPath: 'id' });
      };
      req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
      req.onerror = () => { clearTimeout(timer); resolve(null); };
      req.onblocked = () => { clearTimeout(timer); resolve(null); };
    });
  }

  const ready = openDB().then((d) => {
    db = d;
    mode = d ? 'idb' : 'memory';
    return d;
  });

  function tx(store, mode2) {
    return db.transaction(store, mode2).objectStore(store);
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB 操作失败'));
    });
  }

  async function saveBook(book) {
    await ready;
    if (!db) { memory.books.set(book.id, book); return book.id; }
    try {
      await wrap(tx('books', 'readwrite').put(book));
    } catch (e) {
      memory.books.set(book.id, book);
      mode = 'memory';
    }
    return book.id;
  }

  async function getBook(id) {
    await ready;
    if (memory.books.has(id)) return memory.books.get(id);
    if (!db) return null;
    try {
      return await wrap(tx('books', 'readonly').get(id));
    } catch (e) {
      return null;
    }
  }

  async function listBooks() {
    await ready;
    const out = [];
    if (db) {
      try {
        const all = await wrap(tx('books', 'readonly').getAll());
        for (const b of all) out.push(meta(b));
      } catch (e) { /* ignore */ }
    }
    for (const b of memory.books.values()) {
      if (!out.some((x) => x.id === b.id)) out.push(meta(b));
    }
    out.sort((a, b) => b.addedAt - a.addedAt);
    return out;
  }

  function meta(b) {
    const st = b.stats || {};
    return {
      id: b.id,
      title: b.title,
      author: b.author || '',
      source: b.source || 'txt',
      addedAt: b.addedAt || 0,
      chapters: (b.chapters || []).length,
      chars: st.chars || 0,
      words: st.words || 0,
      images: st.images || 0,
      lang: st.lang || 'cjk'
    };
  }

  async function deleteBook(id) {
    await ready;
    memory.books.delete(id);
    memory.progress.delete(id);
    if (!db) return;
    try {
      await wrap(tx('books', 'readwrite').delete(id));
      await wrap(tx('progress', 'readwrite').delete(id));
    } catch (e) { /* ignore */ }
  }

  async function saveProgress(bookId, p) {
    await ready;
    memory.progress.set(bookId, p);
    if (!db) return;
    try {
      await wrap(tx('progress', 'readwrite').put({ bookId, ...p, at: Date.now() }));
    } catch (e) { /* ignore */ }
  }

  async function getProgress(bookId) {
    await ready;
    if (!db) return memory.progress.get(bookId) || null;
    try {
      const r = await wrap(tx('progress', 'readonly').get(bookId));
      return r || memory.progress.get(bookId) || null;
    } catch (e) {
      return memory.progress.get(bookId) || null;
    }
  }

  /* ---------------- 分支剧情（stories） ---------------- */
  async function saveStory(story) {
    await ready;
    memory.stories.set(story.id, story);
    if (!db) return story.id;
    try {
      await wrap(tx('stories', 'readwrite').put(story));
    } catch (e) {
      memory.stories.set(story.id, story);
      mode = 'memory';
    }
    return story.id;
  }

  async function getStory(id) {
    await ready;
    if (memory.stories.has(id)) return memory.stories.get(id);
    if (!db) return null;
    try {
      return await wrap(tx('stories', 'readonly').get(id));
    } catch (e) {
      return null;
    }
  }

  async function listStories(bookId) {
    await ready;
    const out = [];
    if (db) {
      try {
        const all = await wrap(tx('stories', 'readonly').getAll());
        for (const s of all) if (!bookId || s.bookId === bookId) out.push(s);
      } catch (e) { /* ignore */ }
    }
    for (const s of memory.stories.values()) {
      if ((!bookId || s.bookId === bookId) && !out.some((x) => x.id === s.id)) out.push(s);
    }
    out.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return out;
  }

  async function deleteStory(id) {
    await ready;
    memory.stories.delete(id);
    if (!db) return;
    try {
      await wrap(tx('stories', 'readwrite').delete(id));
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 陪伴角色（companion，单例 id='main'） ---------------- */
  async function getCompanion() {
    await ready;
    if (memory.companion) return memory.companion;
    if (!db) return null;
    try {
      const r = await wrap(tx('companion', 'readonly').get('main'));
      return r || null;
    } catch (e) {
      return null;
    }
  }

  async function saveCompanion(c) {
    await ready;
    memory.companion = c;
    if (!db) return;
    try {
      await wrap(tx('companion', 'readwrite').put(c));
    } catch (e) {
      memory.companion = c;
      mode = 'memory';
    }
  }

  /* ---------------- 设置（localStorage，读写失败也不致命） ---------------- */
  const DEFAULTS = {
    ver: 4,
    theme: 'paper',
    base: 26,
    intensity: 0.75,
    autoSpeed: 2.6,
    auto: false,
    mode: 'read',           // read 阅读 | play 互动 | immersive 沉浸
    typewriter: true,
    granularity: 'paragraph',
    density: 0,
    marks: true,
    /* 读法：normal 正常 | near 凑近 | far 退后 | still 安静
       只在设置里定，正文里不会弹出来问 */
    mood: 'normal',
    gates: 2,        // 老字段，只用来迁移
    jump: 2,
    /* 卡页：自己定“隔多少句 / 多少段来一张” */
    gateOn: true,
    gateEvery: 6,
    gateUnit: 'sentence',   // sentence | paragraph
    gateAhead: true,        // true = 卡片抽“接下来要读的那句”
    /* 沉浸模式：一页一句还是一段、上面留几段历史 */
    stageUnit: 'paragraph', // sentence | paragraph
    stageKeep: 2,           // 0~4
    /* 用户自定义正则美化：[{pat, action, repl, on}] */
    rules: []
  };

  function loadSettings() {
    const out = Object.assign({}, DEFAULTS);
    let saved = null;
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        saved = JSON.parse(raw);
        Object.assign(out, saved);
        // 老配置（只有 0/1/2 三档）折算成“隔几句一张”
        if (Number(saved.ver) < 3) {
          const lv = Number(saved.gates);
          out.gateOn = lv > 0;
          out.gateEvery = lv >= 2 ? 6 : 12;
          out.gateUnit = 'sentence';
          out.gateAhead = true;
          out.jump = Number(saved.jump) || 2;
          out.marks = saved.marks !== false;
        }
      }
    } catch (e) { /* ignore */ }
    out.ver = 4;
    delete out.choices;      // 老字段：以前是“章节中段弹一次抉择”，现在只在设置里定读法
    if (['read', 'play', 'immersive'].indexOf(out.mode) < 0) out.mode = 'read';
    if (['normal', 'near', 'far', 'still'].indexOf(out.mood) < 0) out.mood = 'normal';
    if (!(Number(out.gateEvery) > 0)) out.gateEvery = 9;
    if (out.gateUnit !== 'paragraph') out.gateUnit = 'sentence';
    out.gateOn = out.gateOn !== false;
    if (out.stageUnit !== 'sentence') out.stageUnit = 'paragraph';
    const keep = Math.round(Number(out.stageKeep));
    out.stageKeep = Number.isFinite(keep) ? Math.max(0, Math.min(4, keep)) : 2;
    out.rules = (Array.isArray(out.rules) ? out.rules : []).slice(0, 16);
    return out;
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  /* ---------------- 剧情生成器设置（localStorage，默认离线） ---------------- */
  const GENERATOR_KEY = 'ziliu.generator.v1';
  const GENERATOR_DEFAULTS = {
    backend: 'offline',           // offline | llm | local
    llm: { baseURL: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' },
    local: { baseURL: 'http://localhost:11434/v1', model: 'llama3' },
    style: '克制',
    maxTokens: 1200
  };

  function loadGenerator() {
    const out = JSON.parse(JSON.stringify(GENERATOR_DEFAULTS));
    try {
      const raw = localStorage.getItem(GENERATOR_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        Object.assign(out, saved);
        if (saved.llm) Object.assign(out.llm, saved.llm);
        if (saved.local) Object.assign(out.local, saved.local);
      }
    } catch (e) { /* ignore */ }
    if (['offline', 'llm', 'local'].indexOf(out.backend) < 0) out.backend = 'offline';
    return out;
  }

  function saveGenerator(g) {
    try { localStorage.setItem(GENERATOR_KEY, JSON.stringify(g)); } catch (e) { /* ignore */ }
  }

  /* file:// 或隐私模式下 localStorage 可能直接抛异常，这里全部兜住 */
  function getFlag(key) {
    try { return localStorage.getItem('ziliu.' + key); } catch (e) { return null; }
  }
  function setFlag(key, value) {
    try { localStorage.setItem('ziliu.' + key, String(value)); } catch (e) { /* ignore */ }
  }

  XR.Store = {
    ready,
    get mode() { return mode; },
    saveBook, getBook, listBooks, deleteBook,
    saveProgress, getProgress,
    saveStory, getStory, listStories, deleteStory,
    getCompanion, saveCompanion,
    loadSettings, saveSettings, DEFAULTS,
    loadGenerator, saveGenerator, GENERATOR_DEFAULTS,
    getFlag, setFlag
  };
})();

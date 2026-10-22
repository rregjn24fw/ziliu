/* ============================================================
   store.js — 书的持久化（IndexedDB，失败自动降级到内存）
   ============================================================ */
(function () {
  'use strict';
  const XR = (window.XR = window.XR || {});

  const DB_NAME = 'ziliu';
  const DB_VER = 3;
  const SETTINGS_KEY = 'ziliu.settings.v1';

  const memory = {
    books: new Map(), progress: new Map(), stories: new Map(), companion: null,
    bookmarks: new Map(), notes: new Map(), sync: null
  };
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
        if (!d.objectStoreNames.contains('bookmarks')) {
          d.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('bookId', 'bookId', { unique: false });
        }
        if (!d.objectStoreNames.contains('notes')) {
          d.createObjectStore('notes', { keyPath: 'id' }).createIndex('bookId', 'bookId', { unique: false });
        }
        if (!d.objectStoreNames.contains('sync')) d.createObjectStore('sync', { keyPath: 'id' });
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

  /* ---------------- 书（books） ----------------
     删除采用「墓碑」：记录不真删，只把正文清空并标 deleted，
     这样别的设备同步时才知道这本书是被删了，而不是没同步到。 */
  async function saveBook(book) {
    await ready;
    const rec = Object.assign({}, book);
    rec.updatedAt = Date.now();
    rec.deleted = false;
    if (db) {
      try { await wrap(tx('books', 'readwrite').put(rec)); } catch (e) { mode = 'memory'; }
    }
    memory.books.set(rec.id, rec);
    return rec.id;
  }

  async function getBook(id) {
    await ready;
    let b = memory.books.get(id) || null;
    if (!b && db) {
      try { b = await wrap(tx('books', 'readonly').get(id)); } catch (e) { /* ignore */ }
    }
    if (!b || b.deleted) return null;
    return b;
  }

  async function listBooks() {
    await ready;
    const out = [];
    const seen = new Set();
    if (db) {
      try {
        const all = await wrap(tx('books', 'readonly').getAll());
        for (const b of all) {
          if (b.deleted) continue;
          out.push(meta(b));
          seen.add(b.id);
        }
      } catch (e) { /* ignore */ }
    }
    for (const b of memory.books.values()) {
      if (b.deleted || seen.has(b.id)) continue;
      out.push(meta(b));
      seen.add(b.id);
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
      updatedAt: b.updatedAt || b.addedAt || 0,
      chapters: (b.chapters || []).length,
      chars: st.chars || 0,
      words: st.words || 0,
      images: st.images || 0,
      lang: st.lang || 'cjk',
      ghost: !!b.ghost || !(b.chapters && b.chapters.length)
    };
  }

  async function deleteBook(id) {
    await ready;
    const old = await getBook(id);
    const stamp = Date.now();
    // 墓碑：只留元信息，正文和插图清掉（正文不进云，留着只占地方）
    const tomb = {
      id,
      title: (old && old.title) || '',
      author: (old && old.author) || '',
      source: (old && old.source) || 'txt',
      addedAt: (old && old.addedAt) || 0,
      stats: (old && old.stats) || {},
      chapters: [],
      images: {},
      deleted: true,
      updatedAt: stamp
    };
    memory.books.set(id, tomb);
    memory.progress.set(id, { bookId: id, deleted: true, updatedAt: stamp });
    if (!db) return;
    try {
      await wrap(tx('books', 'readwrite').put(tomb));
      await wrap(tx('progress', 'readwrite').put({ bookId: id, deleted: true, updatedAt: stamp }));
    } catch (e) { /* ignore */ }
  }

  async function saveProgress(bookId, p) {
    await ready;
    const stamp = Date.now();
    const rec = Object.assign({ bookId, deleted: false, updatedAt: stamp, at: stamp }, p);
    memory.progress.set(bookId, rec);
    if (!db) return;
    try {
      await wrap(tx('progress', 'readwrite').put(rec));
    } catch (e) { /* ignore */ }
  }

  async function getProgress(bookId) {
    await ready;
    let r = memory.progress.get(bookId) || null;
    if (!r && db) {
      try { r = await wrap(tx('progress', 'readonly').get(bookId)); } catch (e) { /* ignore */ }
    }
    if (!r || r.deleted) return null;
    return r;
  }

  /* ---------------- 分支剧情（stories） ---------------- */
  async function saveStory(story) {
    await ready;
    const rec = Object.assign({}, story);
    rec.updatedAt = Date.now();
    rec.deleted = false;
    memory.stories.set(rec.id, rec);
    if (!db) return rec.id;
    try {
      await wrap(tx('stories', 'readwrite').put(rec));
    } catch (e) {
      memory.stories.set(rec.id, rec);
      mode = 'memory';
    }
    return rec.id;
  }

  async function getStory(id) {
    await ready;
    const s = memory.stories.get(id);
    if (s) return s.deleted ? null : s;
    if (!db) return null;
    try {
      const r = await wrap(tx('stories', 'readonly').get(id));
      return r && !r.deleted ? r : null;
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
        for (const s of all) if (!s.deleted && (!bookId || s.bookId === bookId)) out.push(s);
      } catch (e) { /* ignore */ }
    }
    for (const s of memory.stories.values()) {
      if (s.deleted) continue;
      if ((!bookId || s.bookId === bookId) && !out.some((x) => x.id === s.id)) out.push(s);
    }
    out.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return out;
  }

  async function deleteStory(id) {
    await ready;
    const old = memory.stories.get(id) || (db ? await wrap(tx('stories', 'readonly').get(id)).catch(() => null) : null);
    const tomb = Object.assign({}, old || {}, { id, deleted: true, updatedAt: Date.now() });
    tomb.text = '';
    tomb.options = [];
    memory.stories.set(id, tomb);
    if (!db) return;
    try {
      await wrap(tx('stories', 'readwrite').put(tomb));
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
    const rec = Object.assign({}, c, { id: 'main', updatedAt: Date.now() });
    memory.companion = rec;
    if (!db) return;
    try {
      await wrap(tx('companion', 'readwrite').put(rec));
    } catch (e) {
      memory.companion = rec;
      mode = 'memory';
    }
  }

  /* ---------------- 书签 / 笔记 ----------------
     两者都是独立实体，按 bookId 关联，位置用 {chapterIndex, index}；
     删除同样走墓碑（deleted + updatedAt），否则同步时会被别的设备“复活”。 */
  function stampId(prefix) {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return prefix + c.randomUUID();
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normMark(m, kind) {
    const o = Object.assign({}, m || {});
    o.id = o.id || stampId(kind === 'note' ? 'n_' : 'b_');
    o.bookId = String(o.bookId || '');
    o.chapterIndex = Math.max(0, Math.round(Number(o.chapterIndex) || 0));
    o.index = Math.max(-1, Math.round(Number(o.index) || 0));
    o.createdAt = Number(o.createdAt) || Date.now();
    o.updatedAt = Number(o.updatedAt) || o.createdAt;
    o.deleted = !!o.deleted;
    if (kind === 'note') {
      o.quote = String(o.quote || '').slice(0, 400);
      o.text = String(o.text || '').slice(0, 4000);
    } else {
      o.scene = String(o.scene || '').slice(0, 120);
      o.note = String(o.note || '').slice(0, 400);
    }
    return o;
  }

  async function putItem(store, map, rec) {
    await ready;
    map.set(rec.id, rec);
    if (!db) return rec.id;
    try {
      await wrap(tx(store, 'readwrite').put(rec));
    } catch (e) { /* 内存里已有，继续 */ }
    return rec.id;
  }

  async function listItems(store, map, bookId) {
    await ready;
    const out = [];
    const seen = new Set();
    if (db) {
      try {
        const all = await wrap(tx(store, 'readonly').getAll());
        for (const it of all) {
          if (it.deleted) continue;
          if (bookId && it.bookId !== bookId) continue;
          out.push(it);
          seen.add(it.id);
        }
      } catch (e) { /* ignore */ }
    }
    for (const it of map.values()) {
      if (it.deleted || seen.has(it.id)) continue;
      if (bookId && it.bookId !== bookId) continue;
      out.push(it);
    }
    out.sort((a, b) => (a.chapterIndex - b.chapterIndex) || (a.index - b.index));
    return out;
  }

  async function getItem(store, map, id) {
    await ready;
    const it = map.get(id);
    if (it) return it;
    if (!db) return null;
    try { return await wrap(tx(store, 'readonly').get(id)); } catch (e) { return null; }
  }

  async function tombstone(store, map, id) {
    const old = await getItem(store, map, id);
    if (!old) return;
    const rec = Object.assign({}, old, { deleted: true, updatedAt: Date.now() });
    if (store === 'notes') rec.text = '';
    if (store === 'bookmarks') { rec.scene = ''; rec.note = ''; }
    await putItem(store, map, rec);
  }

  async function saveBookmark(bm) {
    return putItem('bookmarks', memory.bookmarks, normMark(bm, 'bookmark'));
  }
  async function listBookmarks(bookId) {
    return listItems('bookmarks', memory.bookmarks, bookId);
  }
  async function deleteBookmark(id) {
    return tombstone('bookmarks', memory.bookmarks, id);
  }

  async function saveNote(n) {
    return putItem('notes', memory.notes, normMark(n, 'note'));
  }
  async function listNotes(bookId) {
    return listItems('notes', memory.notes, bookId);
  }
  async function deleteNote(id) {
    return tombstone('notes', memory.notes, id);
  }

  /* ---------------- 同步状态（sync 单例 id='state'） ---------------- */
  const SYNC_ID = 'state';
  const SYNC_DEFAULT = {
    id: SYNC_ID,
    deviceId: '',
    shas: {},         // 云端文件 → 上次 PUT 之后的 sha
    dirty: {},        // 数据集 → 最后改动时间（有待推送）
    lastPushAt: 0,
    lastPullAt: 0,
    lastError: '',
    remoteOnly: 0     // 云端有、本机没有正文的书
  };

  async function getSyncState() {
    await ready;
    let rec = memory.sync;
    if (!rec && db) {
      try { rec = await wrap(tx('sync', 'readonly').get(SYNC_ID)); } catch (e) { /* ignore */ }
    }
    const out = Object.assign({}, SYNC_DEFAULT, rec || {});
    out.shas = Object.assign({}, out.shas || {});
    out.dirty = Object.assign({}, out.dirty || {});
    if (!out.deviceId) {
      out.deviceId = stampId('dev_').slice(0, 14);
      saveSyncState({ deviceId: out.deviceId });
    }
    memory.sync = out;
    return out;
  }

  async function saveSyncState(patch) {
    await ready;
    const cur = Object.assign({}, SYNC_DEFAULT, memory.sync || {});
    const next = Object.assign({}, cur, patch || {});
    next.id = SYNC_ID;
    next.shas = Object.assign({}, cur.shas || {}, (patch && patch.shas) || {});
    next.dirty = Object.assign({}, cur.dirty || {}, (patch && patch.dirty) || {});
    if (patch && patch.clearDirty) {
      for (const k of [].concat(patch.clearDirty)) delete next.dirty[k];
    }
    delete next.clearDirty;
    memory.sync = next;
    if (db) {
      try { await wrap(tx('sync', 'readwrite').put(next)); } catch (e) { /* ignore */ }
    }
    return next;
  }

  async function markDirty(kind) {
    const st = await getSyncState();
    const dirty = Object.assign({}, st.dirty, { [kind]: Date.now() });
    return saveSyncState({ dirty });
  }

  async function dirtyKinds() {
    const st = await getSyncState();
    return Object.keys(st.dirty);
  }

  /* ---------------- 同步快照 / 应用远端 / 备份 ----------------
     同步只搬「阅读数据」：书清单（元信息＋墓碑）、进度、书签、笔记、剧情、阿泠、设置。
     正文与插图默认不进云（可单独开关），备份导出时才可选带上。 */
  async function listRaw(store, map, keyOf) {
    await ready;
    const out = [];
    const seen = new Set();
    if (db) {
      try {
        const all = await wrap(tx(store, 'readonly').getAll());
        for (const it of all) {
          out.push(it);
          seen.add(keyOf(it));
        }
      } catch (e) { /* ignore */ }
    }
    for (const [k, v] of map) {
      const key = keyOf(v) || k;
      if (!seen.has(key)) out.push(v);
    }
    return out;
  }

  function bookRow(b) {
    return {
      id: b.id,
      title: b.title || '',
      author: b.author || '',
      source: b.source || 'txt',
      addedAt: b.addedAt || 0,
      updatedAt: b.updatedAt || b.addedAt || 0,
      stats: b.stats || {},
      deleted: !!b.deleted
    };
  }

  async function syncSnapshot() {
    const books = (await listRaw('books', memory.books, (b) => b.id)).map(bookRow);
    const progress = await listRaw('progress', memory.progress, (p) => p.bookId);
    const bookmarks = await listRaw('bookmarks', memory.bookmarks, (x) => x.id);
    const notes = await listRaw('notes', memory.notes, (x) => x.id);
    const stories = await listRaw('stories', memory.stories, (x) => x.id);
    let companion = null;
    try { companion = await getCompanion(); } catch (e) { /* ignore */ }
    return {
      books, progress, bookmarks, notes, stories,
      companion: companion || null,
      settings: loadSettings()
    };
  }

  async function applyRemote(kind, items) {
    if (!items) return 0;
    let n = 0;
    if (kind === 'books') {
      for (const it of items) {
        if (!it || !it.id) continue;
        const stamp = Number(it.updatedAt) || Date.now();
        if (it.deleted) {
          const tomb = { id: it.id, title: it.title || '', addedAt: it.addedAt || 0, stats: it.stats || {}, chapters: [], images: {}, deleted: true, updatedAt: stamp };
          memory.books.set(it.id, tomb);
          if (db) await wrap(tx('books', 'readwrite').put(tomb)).catch(() => {});
          n++;
          continue;
        }
        const local = await getBook(it.id);
        if (local) {
          // 本机有正文：只更新元信息，正文一个字不动
          const rec = Object.assign({}, local, {
            title: it.title || local.title,
            author: it.author != null ? it.author : local.author,
            stats: it.stats || local.stats,
            updatedAt: stamp
          });
          memory.books.set(rec.id, rec);
          if (db) await wrap(tx('books', 'readwrite').put(rec)).catch(() => {});
          n++;
        } else {
          // 本机没有正文：立一个“只有元信息”的条目，等用户重新导入同一本书再合并
          const ghost = {
            id: it.id, title: it.title || '（云端书籍）', author: it.author || '',
            source: it.source || 'txt', addedAt: it.addedAt || 0, stats: it.stats || {},
            chapters: [], images: {}, ghost: true, updatedAt: stamp
          };
          memory.books.set(it.id, ghost);
          if (db) await wrap(tx('books', 'readwrite').put(ghost)).catch(() => {});
          n++;
        }
      }
      return n;
    }
    if (kind === 'progress') {
      for (const it of items) {
        if (!it || !it.bookId) continue;
        const rec = Object.assign({}, it, { updatedAt: Number(it.updatedAt) || Number(it.at) || Date.now() });
        memory.progress.set(rec.bookId, rec);
        if (db) await wrap(tx('progress', 'readwrite').put(rec)).catch(() => {});
        n++;
      }
      return n;
    }
    if (kind === 'stories' || kind === 'bookmarks' || kind === 'notes') {
      const map = kind === 'stories' ? memory.stories : kind === 'bookmarks' ? memory.bookmarks : memory.notes;
      for (const it of items) {
        if (!it || !it.id) continue;
        const rec = kind === 'stories' ? it : normMark(it, kind === 'notes' ? 'note' : 'bookmark');
        map.set(rec.id, rec);
        if (db) await wrap(tx(kind, 'readwrite').put(rec)).catch(() => {});
        n++;
      }
      return n;
    }
    if (kind === 'companion') {
      const c = Array.isArray(items) ? items[0] : items;
      if (c && typeof c === 'object') {
        await saveCompanion(Object.assign({}, c, { id: 'main' }));
        n++;
      }
      return n;
    }
    if (kind === 'settings') {
      const s = Array.isArray(items) ? items[0] : items;
      if (s && typeof s === 'object') {
        const local = loadSettings();
        saveSettings(Object.assign({}, local, s, { ver: local.ver }));
        // 沿用云端的时间戳，别刚拉下来就变成“本机更新”
        if (s.updatedAt) {
          try { localStorage.setItem('ziliu.settings.at', String(Number(s.updatedAt) || Date.now())); } catch (e) { /* ignore */ }
        }
        n++;
      }
      return n;
    }
    return n;
  }

  /* 单本书的正文（仅当用户开启「正文也同步」时才用） */
  async function getBookContent(id) {
    const b = await getBook(id);
    if (!b) return null;
    return { id: b.id, chapters: b.chapters || [], stats: b.stats || {} };
  }

  async function applyBookContent(id, content) {
    if (!id || !content || !Array.isArray(content.chapters) || !content.chapters.length) return 0;
    const local = await getBook(id);
    const meta0 = local || (await getRawBook(id)) || {};
    const rec = Object.assign({}, meta0, {
      id,
      title: meta0.title || content.title || '（云端书籍）',
      author: meta0.author || '',
      source: meta0.source || 'txt',
      addedAt: meta0.addedAt || Date.now(),
      stats: content.stats || meta0.stats || {},
      chapters: content.chapters,
      images: meta0.images || {},
      ghost: false,
      deleted: false,
      updatedAt: Date.now()
    });
    memory.books.set(id, rec);
    if (db) await wrap(tx('books', 'readwrite').put(rec)).catch(() => {});
    return 1;
  }

  async function getRawBook(id) {
    await ready;
    if (memory.books.has(id)) return memory.books.get(id);
    if (!db) return null;
    try { return await wrap(tx('books', 'readonly').get(id)); } catch (e) { return null; }
  }

  /* 全量备份：content=true 时连正文（不含插图 dataURL，太大）一起导出 */
  async function exportAll(opts) {
    const withContent = !!(opts && opts.content);
    const snap = await syncSnapshot();
    const out = {
      app: 'ziliu',
      schema: 1,
      exportedAt: Date.now(),
      books: snap.books.filter((b) => !b.deleted),
      progress: snap.progress.filter((p) => !p.deleted),
      bookmarks: snap.bookmarks.filter((b) => !b.deleted),
      notes: snap.notes.filter((n) => !n.deleted),
      stories: snap.stories.filter((s) => !s.deleted),
      companion: snap.companion,
      settings: snap.settings,
      generator: loadGenerator()
    };
    if (withContent) {
      out.content = {};
      for (const b of out.books) {
        const full = await getBook(b.id);
        if (full && full.chapters && full.chapters.length) {
          out.content[b.id] = { chapters: full.chapters, stats: full.stats || {} };
        }
      }
    }
    return out;
  }

  async function importAll(snap, opts) {
    const counts = { books: 0, progress: 0, bookmarks: 0, notes: 0, stories: 0, companion: 0, settings: 0 };
    if (!snap || typeof snap !== 'object') throw new Error('这不是字流的备份文件');
    if (snap.app && snap.app !== 'ziliu') throw new Error('备份文件格式不对');
    const content = (opts && opts.content !== false && snap.content) || null;
    if (content) {
      for (const id of Object.keys(content)) {
        counts.books += await applyBookContent(id, content[id]);
      }
    }
    if (Array.isArray(snap.books)) {
      for (const b of snap.books) {
        if (!b || !b.id) continue;
        const local = await getBook(b.id);
        if (local) {
          const rec = Object.assign({}, local, { title: b.title || local.title, author: b.author || local.author, updatedAt: Date.now() });
          memory.books.set(rec.id, rec);
          if (db) await wrap(tx('books', 'readwrite').put(rec)).catch(() => {});
          counts.books++;
        } else if (!content || !content[b.id]) {
          // 没有正文可恢复：先立元信息墓碑以外的“幽灵”，别把书架弄脏
          const ghost = { id: b.id, title: b.title || '', author: b.author || '', source: b.source || 'txt', addedAt: b.addedAt || 0, stats: b.stats || {}, chapters: [], images: {}, ghost: true, updatedAt: Date.now() };
          memory.books.set(ghost.id, ghost);
          if (db) await wrap(tx('books', 'readwrite').put(ghost)).catch(() => {});
          counts.books++;
        }
      }
    }
    counts.progress += await applyRemote('progress', snap.progress || []);
    counts.bookmarks += await applyRemote('bookmarks', snap.bookmarks || []);
    counts.notes += await applyRemote('notes', snap.notes || []);
    counts.stories += await applyRemote('stories', snap.stories || []);
    if (snap.companion) counts.companion += await applyRemote('companion', snap.companion);
    if (snap.settings) counts.settings += await applyRemote('settings', snap.settings);
    if (snap.generator) saveGenerator(Object.assign(loadGenerator(), snap.generator));
    return counts;
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
    try {
      const prev = localStorage.getItem(SETTINGS_KEY);
      const next = JSON.stringify(s);
      localStorage.setItem(SETTINGS_KEY, next);
      // 只有内容真的变了才更新时间戳：启动时重存一次不算“新改动”，
      // 否则每次开页面都会把云端的设置盖掉。
      if (prev !== next) localStorage.setItem('ziliu.settings.at', String(Date.now()));
    } catch (e) { /* ignore */ }
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

  /* ---------------- 朗读设置（localStorage，纯本地） ---------------- */
  const TTS_KEY = 'ziliu.tts.v1';
  const TTS_DEFAULTS = {
    rate: 1,
    pitch: 1,
    volume: 1,
    voice: '',        // voiceURI，空 = 跟随系统默认
    follow: true,     // 读完一句自动读下一句
    scroll: true      // 朗读时把当前句滚到视野里
  };

  function loadTts() {
    const out = Object.assign({}, TTS_DEFAULTS);
    try {
      const raw = localStorage.getItem(TTS_KEY);
      if (raw) Object.assign(out, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    out.rate = Math.max(0.5, Math.min(2.5, Number(out.rate) || 1));
    out.pitch = Math.max(0, Math.min(2, Number(out.pitch) || 1));
    out.volume = Math.max(0, Math.min(1, out.volume === 0 ? 0 : (Number(out.volume) || 1)));
    out.follow = out.follow !== false;
    out.scroll = out.scroll !== false;
    return out;
  }

  function saveTts(s) {
    try { localStorage.setItem(TTS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  /* ---------------- 云同步设置（localStorage；token 只在本机） ----------------
     注意：PAT 是明文存在本机 localStorage 里的，UI 上写清楚了；
     只在用户自己填了 owner/repo/token 之后才会联网。 */
  const SYNC_KEY = 'ziliu.sync.v1';
  const SYNC_DEFAULTS = {
    enabled: false,
    owner: '',
    repo: '',
    branch: 'main',
    dir: 'data',
    token: '',
    auto: true,
    interval: 5,      // 分钟
    content: false,   // 正文是否也同步
    lastAt: 0,
    lastStatus: ''
  };

  function loadSync() {
    const out = Object.assign({}, SYNC_DEFAULTS);
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      if (raw) Object.assign(out, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    out.owner = String(out.owner || '').trim();
    out.repo = String(out.repo || '').trim();
    out.branch = String(out.branch || 'main').trim() || 'main';
    out.dir = String(out.dir || 'data').replace(/^\/+|\/+$/g, '') || 'ziliu-sync';
    out.interval = Math.max(1, Math.min(120, Number(out.interval) || 5));
    out.auto = out.auto !== false;
    out.content = !!out.content;
    out.enabled = !!out.enabled;
    return out;
  }

  function saveSync(s) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
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
    saveBook, getBook, listBooks, deleteBook, getRawBook,
    saveProgress, getProgress,
    saveStory, getStory, listStories, deleteStory,
    saveBookmark, listBookmarks, deleteBookmark,
    saveNote, listNotes, deleteNote,
    getCompanion, saveCompanion,
    loadSettings, saveSettings, DEFAULTS,
    loadGenerator, saveGenerator, GENERATOR_DEFAULTS,
    loadTts, saveTts, TTS_DEFAULTS,
    loadSync, saveSync, SYNC_DEFAULTS,
    getSyncState, saveSyncState, markDirty, dirtyKinds,
    syncSnapshot, applyRemote, getBookContent, applyBookContent,
    exportAll, importAll,
    getFlag, setFlag
  };
})();

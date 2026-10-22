/* ============================================================
   sync.js — 用 GitHub 私有仓库做远程后端（可离线）
   · 纯函数：mergeItems / buildPayload / parsePayload / toB64 / fromB64
   · 客户端：Contents API（GET / PUT），只读写 cfg.dir 下的几个 JSON
   · 冲突：每个实体按 updatedAt 取新（LWW），同时间戳时删除（墓碑）优先
   依赖 XR.Store 取本地数据；没有任何网络时不会抛到界面上，只回错误摘要。
   ============================================================ */
(function (root) {
  'use strict';
  const XR = (root.XR = root.XR || {});

  const SCHEMA = 1;
  const API = 'https://api.github.com';

  /* 参与同步的数据集：文件名固定，便于跨设备对齐 */
  const FILES = {
    books: 'books.json',
    progress: 'progress.json',
    bookmarks: 'bookmarks.json',
    notes: 'notes.json',
    stories: 'stories.json',
    companion: 'companion.json',
    settings: 'settings.json'
  };
  const KINDS = Object.keys(FILES);

  /* ---------------- 纯函数 ---------------- */

  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  function toB64(str) {
    const s = String(str == null ? '' : str);
    if (enc && typeof btoa === 'function') {
      const bytes = enc.encode(s);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return btoa(bin);
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
    return '';
  }

  function fromB64(b64) {
    const raw = String(b64 == null ? '' : b64).replace(/\s+/g, '');
    if (typeof atob === 'function') {
      const bin = atob(raw);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return dec ? dec.decode(bytes) : bin;
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(raw, 'base64').toString('utf8');
    return '';
  }

  function pathFor(cfg, kind) {
    const dir = String((cfg && cfg.dir) || 'data').replace(/^\/+|\/+$/g, '') || 'ziliu-sync';
    return dir + '/' + (FILES[kind] || kind + '.json');
  }

  function keyOf(kind, item) {
    if (!item) return '';
    if (kind === 'books') return String(item.id || '');
    if (kind === 'progress') return String(item.bookId || '');
    if (kind === 'settings' || kind === 'companion') return 'singleton';
    return String(item.id || '');
  }

  function stampOf(item) {
    if (!item) return 0;
    return Number(item.updatedAt || item.at || 0) || 0;
  }

  function fingerprint(kind, items) {
    const list = (items || []).map((it) => {
      const o = Object.assign({}, it);
      delete o.updatedAt;
      delete o.at;
      delete o.shas;
      return o;
    });
    list.sort((a, b) => (keyOf(kind, a) < keyOf(kind, b) ? -1 : keyOf(kind, a) > keyOf(kind, b) ? 1 : 0));
    return JSON.stringify(list);
  }

  /* 合并两份列表：同一实体取 updatedAt 新的；时间戳相同则“删掉的”赢。
     返回 { items, conflicts, changed } —— changed 表示合并结果和本地不一样。 */
  function mergeItems(kind, local, remote) {
    const loc = Array.isArray(local) ? local : [];
    const rem = Array.isArray(remote) ? remote : [];
    const map = new Map();
    const put = (it, from) => {
      const k = keyOf(kind, it);
      if (!k) return;
      const prev = map.get(k);
      if (!prev) { map.set(k, { item: it, from }); return; }
      const a = stampOf(prev.item);
      const b = stampOf(it);
      if (b > a || (b === a && it.deleted && !prev.item.deleted)) map.set(k, { item: it, from });
    };
    for (const it of loc) put(it, 'local');
    for (const it of rem) put(it, 'remote');
    const items = [];
    let conflicts = 0;
    for (const it of loc) {
      const k = keyOf(kind, it);
      const win = map.get(k);
      if (win && win.from === 'remote' && stampOf(it) > 0 && stampOf(win.item) > stampOf(it)) conflicts++;
    }
    for (const v of map.values()) items.push(v.item);
    items.sort((a, b) => (keyOf(kind, a) < keyOf(kind, b) ? -1 : 1));
    const changed = fingerprint(kind, items) !== fingerprint(kind, loc);
    return { items, conflicts, changed };
  }

  function buildPayload(kind, items, device) {
    return {
      app: 'ziliu-sync',
      schema: SCHEMA,
      kind,
      updatedAt: Date.now(),
      device: String(device || ''),
      items: Array.isArray(items) ? items : []
    };
  }

  function parsePayload(kind, text) {
    let obj = null;
    if (typeof text === 'string') {
      try { obj = JSON.parse(text); } catch (e) { return []; }
    } else {
      obj = text;
    }
    if (!obj || !Array.isArray(obj.items)) return [];
    return obj.items;
  }

  function describeError(status, body) {
    const msg = body && body.message ? String(body.message) : '';
    if (status === 401) return '令牌无效或已过期（401）';
    if (status === 403) return '没有权限或触发了限流（403）' + (msg ? '：' + msg : '');
    if (status === 404) return '找不到仓库，或令牌没有这个私有仓库的权限（404）' + (msg ? '：' + msg : '');
    if (status === 409 || status === 422) return '云端文件刚被别处改过，稍后重试（' + status + '）';
    if (status === 429) return '请求太频繁，被 GitHub 限流了（429）';
    return 'GitHub 返回 ' + status + (msg ? '：' + msg : '');
  }

  /* ---------------- 客户端 ---------------- */

  function headers(cfg) {
    return {
      Authorization: 'Bearer ' + String((cfg && cfg.token) || ''),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  function repoURL(cfg) {
    const owner = String((cfg && cfg.owner) || '').trim();
    const repo = String((cfg && cfg.repo) || '').trim();
    if (!owner || !repo) throw new Error('还没填 GitHub 用户名和仓库名');
    if (!cfg.token) throw new Error('还没填访问令牌（PAT）');
    return API + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
  }

  async function req(cfg, method, url, body) {
    const res = await fetch(url, {
      method,
      headers: headers(cfg),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error(describeError(res.status, data));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function getFile(cfg, path) {
    const url = repoURL(cfg) + '/contents/' + path.split('/').map(encodeURIComponent).join('/') +
      '?ref=' + encodeURIComponent(cfg.branch || 'main');
    try {
      const data = await req(cfg, 'GET', url);
      if (!data || data.type !== 'file') return null;
      const text = fromB64(data.content || '');
      return { text, sha: data.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function putFile(cfg, path, text, sha, message) {
    const url = repoURL(cfg) + '/contents/' + path.split('/').map(encodeURIComponent).join('/');
    const body = {
      message: message || 'ziliu: sync',
      content: toB64(text),
      branch: cfg.branch || 'main'
    };
    if (sha) body.sha = sha;
    const data = await req(cfg, 'PUT', url, body);
    return data && data.content ? data.content.sha : '';
  }

  async function test(cfg) {
    let info;
    try {
      info = await req(cfg, 'GET', repoURL(cfg));
    } catch (e) {
      if (e.status === 404) {
        throw new Error('访问不到仓库（404）：确认用户名 / 仓库名拼写正确，并确认令牌的 Repository access 勾了这个私有仓库（选「Public repositories」是看不到私有仓库的）');
      }
      if (e.status === 401) throw new Error('令牌无效或已过期（401）：请重新生成');
      if (e.status === 403) throw new Error('令牌没有权限访问这个仓库（403）');
      throw e;
    }
    const perm = info.permissions || {};
    // OAuth 令牌有 push 字段；Fine-grained 令牌通常没有，此时无法从仓库信息判断写权限，交给实际同步去验证
    const canWrite = perm.push !== undefined ? !!perm.push : null;
    return {
      ok: true,
      fullName: info.full_name,
      private: !!info.private,
      branch: cfg.branch || 'main',
      canWrite
    };
  }

  /* 同步前先探一次仓库：私有仓库 + 没授权的令牌，GitHub 对任何请求都回 404
     （不泄露仓库是否存在），和「文件还不存在」的 404 一模一样。
     不先探这里，用户只会看到「books：找不到仓库」，误以为仓库名填错了。 */
  async function probeAccess(cfg) {
    const owner = String((cfg && cfg.owner) || '').trim();
    const repo = String((cfg && cfg.repo) || '').trim();
    try {
      await req(cfg, 'GET', repoURL(cfg));
    } catch (e) {
      if (e.status === 404) {
        throw new Error('访问不到 ' + owner + '/' + repo + '（404）。可能是：① 仓库名拼写不对；② 令牌的 Repository access 没勾这个私有仓库；③ 令牌没保存或复制不全');
      }
      if (e.status === 401) throw new Error('令牌无效或已过期（401）：请重新生成');
      if (e.status === 403) throw new Error('令牌没有权限访问 ' + owner + '/' + repo + '（403）');
      throw e;
    }
  }

  /* ---------------- 编排：拉 → 合 → 推 ---------------- */

  async function localItems(kind) {
    const Store = XR.Store;
    if (kind === 'settings') {
      const s = Store.loadSettings();
      const at = Number(Store.getFlag('settings.at')) || 0;
      return [Object.assign({}, s, { updatedAt: at })];
    }
    if (kind === 'companion') {
      const c = await Store.getCompanion();
      return c ? [Object.assign({}, c, { id: 'main' })] : [];
    }
    const snap = await Store.syncSnapshot();
    return snap[kind] || [];
  }

  async function syncNow(cfg, opts) {
    const o = opts || {};
    const Store = XR.Store;
    const summary = { pulled: 0, pushed: 0, conflicts: 0, files: [], errors: [], at: Date.now() };
    if (!cfg || !cfg.enabled) {
      summary.errors.push('同步没开：先在设置里填好仓库并打开「启用同步」');
      return summary;
    }
    // 先探一次仓库：访问不到就直接停，别再等逐个文件报 404
    try {
      await probeAccess(cfg);
    } catch (e) {
      summary.errors.push(e.message);
      await Store.saveSyncState({ lastError: e.message });
      return summary;
    }
    const st = await Store.getSyncState();
    const cleared = [];
    const device = st.deviceId || '';
    const types = o.kinds && o.kinds.length ? o.kinds : KINDS;

    // 阶段 1：拉取 + 合并，先算出「云端会覆盖本地」的清单，问过用户再动手
    const plan = [];
    for (const kind of types) {
      const path = pathFor(cfg, kind);
      let remote = null;
      try {
        remote = await getFile(cfg, path);
      } catch (e) {
        summary.errors.push(kind + '：' + e.message);
        continue;
      }
      const local = await localItems(kind);
      const merged = mergeItems(kind, local, remote ? parsePayload(kind, remote.text) : []);
      summary.conflicts += merged.conflicts;
      plan.push({ kind, path, remote, merged, wins: merged.conflicts });
    }

    // 阶段 2：云端有比本地新的数据时，先问一声，别默默覆盖
    let rejectPull = false;
    if (summary.conflicts > 0 && typeof o.confirmPull === 'function') {
      const info = {
        total: summary.conflicts,
        kinds: plan.filter((p) => p.wins > 0).map((p) => ({ kind: p.kind, n: p.wins }))
      };
      rejectPull = !(await o.confirmPull(info));
    }

    // 阶段 3：应用合并结果 + 推送
    for (const p of plan) {
      const skip = rejectPull && p.wins > 0;
      if (p.merged.changed && !skip) {
        await Store.applyRemote(p.kind, p.merged.items);
        summary.pulled += p.merged.items.length;
      }
      const payload = buildPayload(p.kind, p.merged.items, device);
      const text = JSON.stringify(payload, null, 2);
      const same = p.remote && fingerprint(p.kind, parsePayload(p.kind, p.remote.text)) === fingerprint(p.kind, p.merged.items);
      const dirty = !!(st.dirty && st.dirty[p.kind]);
      if (skip || o.push === false || (same && !dirty)) continue;
      // 云端没有、本地也没有的数据集，不必推一个空文件上去
      if (!p.merged.items || p.merged.items.length === 0) continue;
      try {
        const sha = await putFile(cfg, p.path, text, (p.remote && p.remote.sha) || (st.shas && st.shas[p.path]) || '', 'ziliu: sync ' + p.kind);
        summary.pushed += p.merged.items.length;
        summary.files.push(p.path);
        st.shas[p.path] = sha;
        delete st.dirty[p.kind];
        cleared.push(p.kind);
      } catch (e) {
        // 云端刚被别人改过：重取一次 sha 再试一遍
        if (e.status === 409 || e.status === 422) {
          try {
            const again = await getFile(cfg, p.path);
            const sha2 = await putFile(cfg, p.path, text, (again && again.sha) || '', 'ziliu: sync ' + p.kind);
            summary.pushed += p.merged.items.length;
            summary.files.push(p.path);
            st.shas[p.path] = sha2;
            delete st.dirty[p.kind];
            cleared.push(p.kind);
          } catch (e2) {
            summary.errors.push(p.kind + '：' + e2.message);
          }
        } else if (e.status === 404 || e.status === 403) {
          // 能读到仓库（probeAccess 已过）却写不进文件：令牌只有读权限
          summary.errors.push(p.kind + '：写入被拒（' + e.status + '）。令牌能读这个仓库但写不进去 —— 它的 Contents 权限要选「Read and write」，现在多半只有「Read」（只读）。到令牌设置里把 Contents 改成 Read and write');
        } else {
          summary.errors.push(p.kind + '：' + e.message);
        }
      }
    }

    // 正文：只有用户明确打开才同步（一本书一个文件）
    if (cfg.content && o.content !== false) {
      try {
        const books = (await Store.syncSnapshot()).books.filter((b) => !b.deleted);
        for (const b of books) {
          const path = (cfg.dir || 'data') + '/content/' + b.id + '.json';
          const local = await Store.getBookContent(b.id);
          if (!local) continue;
          const remote = await getFile(cfg, path);
          const localStamp = Number(b.updatedAt) || 0;
          const remoteStamp = remote ? (Number((JSON.parse(remote.text || '{}')).updatedAt) || 0) : 0;
          if (remote && remoteStamp > localStamp) {
            const keep = JSON.parse(remote.text);
            await Store.applyBookContent(b.id, keep);
            summary.pulled++;
            continue;
          }
          if (remote && remoteStamp === localStamp) continue;
          const text = JSON.stringify({ id: b.id, updatedAt: localStamp, chapters: local.chapters, stats: local.stats });
          const sha = await putFile(cfg, path, text, (remote && remote.sha) || '', 'ziliu: sync content ' + b.title);
          summary.files.push(path);
          summary.pushed++;
          st.shas[path] = sha;
        }
      } catch (e) {
        summary.errors.push('正文：' + e.message);
      }
    }

    await Store.saveSyncState({
      shas: st.shas,
      clearDirty: cleared,
      lastPullAt: summary.pulled ? summary.at : st.lastPullAt,
      lastPushAt: summary.pushed ? summary.at : st.lastPushAt,
      lastError: summary.errors.length ? summary.errors[0] : '',
      remoteOnly: (await Store.syncSnapshot()).books.filter((b) => b.ghost && !b.deleted).length
    });
    return summary;
  }

  const Sync = {
    SCHEMA, FILES, KINDS,
    toB64, fromB64, pathFor, keyOf, stampOf, fingerprint,
    mergeItems, buildPayload, parsePayload, describeError,
    test, syncNow, probeAccess, getFile, putFile
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Sync;
  if (root) root.XR.Sync = Sync;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

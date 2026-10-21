/* EPUB 专项检查：图片、英文互动、卡页
   node tools/epub-check.mjs [epub] [--shot 前缀]
   需要先起 node tools/serve.mjs（PORT=xxxx） */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 300);
const WEB = process.env.PORT || 8931;
const target = process.argv[2] || 'example/Wimpy 风格.epub';
const shotPrefix = (process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'tools/shot-epub');
const urlTarget = encodeURI('/' + target.replace(/^\.?\//, ''));
const URL_APP = `http://127.0.0.1:${WEB}/index.html`;

const profile = path.join(os.tmpdir(), 'ziliu-ep-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--window-size=1280,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

function killTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
}
const watchdog = setTimeout(() => { console.error('超时'); killTree(edge.pid); process.exit(2); }, 150000);

let ws, seq = 0;
const pending = new Map();
const LOGFILE = 'tools/epub-check.log';
try { fs.writeFileSync(LOGFILE, ''); } catch (e) { /* ignore */ }
const log = (m) => {
  const s = typeof m === 'string' ? m : JSON.stringify(m);
  console.log(s);
  try { fs.appendFileSync(LOGFILE, s + '\n'); } catch (e) { /* ignore */ }
};

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}
async function evalJs(expression) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    sleep(30000).then(() => ({ __timeout: true }))
  ]);
  if (r.__timeout) return { __err: 'evaluate 超时' };
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    return { __err: (d.exception && d.exception.description) || d.text };
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function shot(file) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r && r.result && r.result.data) {
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    log('shot → ' + file);
  }
}

async function main() {
  let t = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      t = list.find((x) => x.type === 'page');
      if (t) break;
    } catch (e) { /* not up */ }
    await sleep(200);
  }
  if (!t) { console.error('CDP 没就绪'); return; }

  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_APP });
  await sleep(2200);

  await evalJs(`window.__errs = [];
    window.addEventListener('error', e => window.__errs.push(String(e.message)));
    window.addEventListener('unhandledrejection', e => window.__errs.push('reject: ' + (e.reason && e.reason.message || e.reason)));`);

  /* ---------- 1. 直接解析，看导入结果 ---------- */
  const parsed = await evalJs(`(async () => {
    try {
      const buf = await fetch(${JSON.stringify(urlTarget)}).then(r => r.arrayBuffer());
      const file = new File([buf], 'wimpy.epub', { type: 'application/epub+zip' });
      const t0 = performance.now();
      const book = await XR.Import.fromFile(file);
      const keys = Object.keys(book.images || {});
      const sizes = keys.map(k => book.images[k].length).sort((a,b) => b-a);
      const samples = keys.slice(0, 4).map(k => k + ' → ' + book.images[k].slice(0, 22) + ' (' + Math.round(book.images[k].length/1024) + 'KB)');
      return {
        ms: Math.round(performance.now() - t0),
        title: book.title,
        chapters: book.chapters.map(c => ({ t: c.title, chars: XR.Import.textCount(c.text), imgs: (c.text.match(/\\u0001IMG:/g) || []).length })),
        images: keys.length,
        imageFiles: book.stats.imageFiles,
        failedImages: book.stats.failedImages,
        lang: book.stats.lang,
        biggestKB: sizes.length ? Math.round(sizes[0] / 1024) : 0,
        samples
      };
    } catch (e) { return { __err: e.message + '\\n' + e.stack }; }
  })()`);
  log('=== 解析结果 ===');
  log(parsed);

  /* ---------- 1.5 引擎层：同一章在两种模式下各长什么样 ---------- */
  const modes = await evalJs(`(async () => {
    try {
      const buf = await fetch(${JSON.stringify(urlTarget)}).then(r => r.arrayBuffer());
      const book = await XR.Import.fromFile(new File([buf], 'x.epub', { type: 'application/epub+zip' }));
      return book.chapters.slice(0, 8).map((c, i) => {
        const play = XR.Engine.buildChapter(c, { granularity: 'sentence', density: 1, marks: true });
        const read = XR.Engine.buildChapter(c, { granularity: 'sentence', density: 0, marks: true, restrained: true, gates: 1 });
        const count = (bs, f) => bs.filter(f).length;
        const flat = read.filter(b => b.kind === 'line' && Math.abs(b.scale - 1) < 0.02).length;
        return {
          i, title: c.title.slice(0, 18),
          play: {
            beats: play.length,
            line: count(play, b => b.kind === 'line'),
            dialogue: count(play, b => b.style === 'dialogue'),
            loud: count(play, b => b.tone === 'loud'),
            marks: count(play, b => b.marks && b.marks.length),
          },
          read: {
            beats: read.length,
            line: count(read, b => b.kind === 'line'),
            flat: read.length ? +(flat / Math.max(1, count(read, b => b.kind === 'line'))).toFixed(2) : 0,
            marks: count(read, b => b.marks && b.marks.length),
            gates: count(read, b => b.kind === 'gate'),
            gateWords: read.filter(b => b.kind === 'gate').map(b => b.word || '(句)')
          }
        };
      });
    } catch (e) { return { __err: e.message }; }
  })()`);
  log('=== 两种模式 ===');
  for (const m of (Array.isArray(modes) ? modes : [modes])) log(m);

  /* ---------- 2. 走正常导入流程（拖文件） ---------- */
  const dropped = await evalJs(`(async () => {
    try {
      const buf = await fetch(${JSON.stringify(urlTarget)}).then(r => r.arrayBuffer());
      const file = new File([buf], 'wimpy.epub', { type: 'application/epub+zip' });
      const dt = new DataTransfer(); dt.items.add(file);
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
      document.dispatchEvent(ev);
      return 'ok ' + buf.byteLength;
    } catch (e) { return 'ERR ' + e.message; }
  })()`);
  log('drop: ' + JSON.stringify(dropped));
  await sleep(4200);

  const shelf = await evalJs(`(() => ({
    cards: document.querySelectorAll('.book-card').length,
    meta: Array.from(document.querySelectorAll('.book-card .bc-meta')).map(e => e.textContent),
    reader: !document.getElementById('reader').hidden,
    status: document.getElementById('status').textContent
  }))()`);
  log('shelf: ' + JSON.stringify(shelf));

  const listCount = await evalJs(`(() => {
    document.getElementById('btnChapters').click();
    const n = document.querySelectorAll('.chap-item').length;
    const names = Array.from(document.querySelectorAll('.chap-item .ci-title')).map(e => e.textContent);
    document.querySelector('[data-act="close-drawer"]').click();
    return { n, names };
  })()`);
  log('目录: ' + JSON.stringify(listCount));

  /* ---------- 3. 逐章看渲染 ---------- */
  const probe = `(() => ({
    title: document.getElementById('chapterTitle').textContent,
    beats: document.querySelectorAll('#beats .beat').length,
    imgN: document.querySelectorAll('#beats img').length,
    imgOk: Array.from(document.querySelectorAll('#beats img')).filter(i => i.complete && i.naturalWidth > 0).length,
    imgSample: Array.from(document.querySelectorAll('#beats img')).slice(0, 2).map(i => i.naturalWidth + 'x' + i.naturalHeight),
    missing: document.querySelectorAll('.beat-img .img-missing').length,
    marks: document.querySelectorAll('#beats .kw').length,
    gates: document.querySelectorAll('#beats .gate-strip').length,
    dialogue: document.querySelectorAll('#beats .beat.dialogue').length,
    loud: document.querySelectorAll('#beats .beat.tone-loud').length,
    big: document.querySelectorAll('#beats .beat[data-huge]').length,
    wave: document.querySelectorAll('#beats .zg').length,
    crash: !document.getElementById('crash').hidden
  }))()`;

  const n = (listCount && listCount.n) || 0;
  const rows = [];
  for (let i = 0; i < Math.min(n, 8); i++) {
    await evalJs(`(async () => {
      document.getElementById('btnChapters').click();
      await new Promise(r => setTimeout(r, 200));
      const items = document.querySelectorAll('.chap-item');
      if (items[${i}]) items[${i}].click();
      await new Promise(r => setTimeout(r, 900));
      return 1;
    })()`);
    const st = await evalJs(probe);
    rows.push({ i, ...st });
    log(JSON.stringify({ i, ...st }));
  }

  /* ---------- 4. 卡页：滚到卡页那里，看它弹不弹 ---------- */
  const gate = await evalJs(`(async () => {
    const strips = Array.from(document.querySelectorAll('#beats .gate-strip'));
    if (!strips.length) return { ok: false, why: '这一章没有卡页' };
    const stage = document.getElementById('stage');
    const s = strips[0];
    const r = s.getBoundingClientRect();
    stage.scrollTop += r.top - stage.clientHeight * 0.35;   // 把卡页翻到视窗中线以上，越过它就该弹
    await new Promise(r2 => setTimeout(r2, 1500));
    const layer = document.getElementById('gateLayer');
    const open = !layer.hidden;
    const card = layer.querySelector('.gate-card');
    const info = card ? {
      kicker: (card.querySelector('.gate-kicker') || {}).textContent,
      word: (card.querySelector('.gate-word') || {}).textContent,
      quote: (card.querySelector('.gate-quote') || {}).textContent,
      from: (card.querySelector('.echo-from') || {}).textContent,
      tap: (card.querySelector('.gate-tap') || {}).textContent,
      wave: card.querySelectorAll('.wv').length
    } : null;
    return { ok: open, info, strips: strips.length };
  })()`);
  log('卡页: ' + JSON.stringify(gate));
  if (gate && gate.ok) {
    await shot(shotPrefix + '-gate.png');
    await evalJs(`(() => { document.getElementById('gateLayer').click(); return 1; })()`);
    await sleep(300);
    const closed = await evalJs(`document.getElementById('gateLayer').hidden`);
    log('卡页关闭: ' + JSON.stringify(closed));
  }

  /* ---------- 4.5 活字：动的不是整句，是句子里几个单独的字 ---------- */
  const anim = await evalJs(`(async () => {
    const alive = Array.from(document.querySelectorAll('#beats .beat.alive'));
    const zg = Array.from(document.querySelectorAll('#beats .beat.alive .zg'));
    const ln = document.querySelector('#beats .beat.alive .ln');
    const lnName = ln ? getComputedStyle(ln).animationName : '';
    const seen = [];
    let name = '';
    for (const node of zg.slice(0, 8)) {
      const nm = getComputedStyle(node).animationName;
      if (!nm || nm === 'none') continue;
      const frames = [];
      for (let i = 0; i < 6; i++) {
        frames.push(getComputedStyle(node).transform);
        await new Promise(r => setTimeout(r, 180));
      }
      const uniq = Array.from(new Set(frames));
      if (uniq.length > 1) { name = nm; seen.push.apply(seen, uniq); break; }
    }
    return {
      ok: seen.length > 1, frames: seen.length, name,
      lnStill: lnName === 'none' || lnName === '',
      zg: zg.length, alive: alive.length
    };
  })()`);
  log('活字: ' + JSON.stringify(anim));

  /* ---------- 5. 截图：找一章有图的 ---------- */
  const withImg = rows.find((r) => r.imgs && r.imgs.some((x) => x.ok));
  if (withImg) {
    await evalJs(`(async () => {
      document.getElementById('btnChapters').click();
      await new Promise(r => setTimeout(r, 200));
      const items = document.querySelectorAll('.chap-item');
      items[${withImg.i}].click();
      await new Promise(r => setTimeout(r, 800));
      return 1;
    })()`);
    await shot(shotPrefix + '-images.png');
    await evalJs(`(() => {
      const stage = document.getElementById('stage');
      const img = document.querySelector('#beats img');
      if (img) stage.scrollTop = img.getBoundingClientRect().top + stage.scrollTop - 200;
      return 1;
    })()`);
    await sleep(400);
    await shot(shotPrefix + '-image-close.png');
  }

  /* ---------- 6. 切到互动模式 ---------- */
  const playMode = await evalJs(`(async () => {
    document.getElementById('btnSettings').click();
    await new Promise(r => setTimeout(r, 260));
    const b = document.querySelector('[data-seg="mode"] [data-val="play"]');
    if (b) b.click();
    await new Promise(r => setTimeout(r, 900));
    const c = document.querySelector('[data-act="close-drawer"]');
    if (c) c.click();
    await new Promise(r => setTimeout(r, 500));
    return {
      mode: XR.Store.loadSettings().mode,
      beats: document.querySelectorAll('#beats .beat').length,
      dialogue: document.querySelectorAll('#beats .beat.dialogue').length,
      kw: document.querySelectorAll('#beats .kw').length,
      gates: document.querySelectorAll('#beats .gate-strip').length,
      crash: !document.getElementById('crash').hidden
    };
  })()`);
  log('互动模式: ' + JSON.stringify(playMode));
  await shot(shotPrefix + '-play.png');

  log('errors: ' + JSON.stringify(await evalJs('window.__errs')));
  ws.close();}

try { await main(); } catch (e) { console.error('出错：', e && e.message); }
finally { clearTimeout(watchdog); killTree(edge.pid); await sleep(300); process.exit(0); }

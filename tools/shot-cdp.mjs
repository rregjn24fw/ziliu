/* 用 CDP 精确控制时机截图：node tools/shot-cdp.mjs <scenario> <out.png>
   scenario: reader | read | seam | immersive | rules | search | chapters | select | echo | night | mood | shelf */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 400);
const WEB = process.env.PORT || 8931;
const scenario = process.argv[2] || 'reader';
const out = path.resolve(process.argv[3] || `tools/shot-${scenario}.png`);
const URL_APP = `http://127.0.0.1:${WEB}/index.html`;
const VW = Number(process.env.VW || 1280);
const VH = Number(process.env.VH || 900);

const profile = path.join(os.tmpdir(), 'ziliu-cdp-' + Date.now() + '-' + PORT);
const edgeFlags = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio', `--window-size=${VW},${VH}`];
if (process.env.SHOWSCROLL !== '1') edgeFlags.push('--hide-scrollbars');
const edge = spawn(EDGE, [...edgeFlags,
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

function killTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
}

const watchdog = setTimeout(() => {
  console.error('超时');
  killTree(edge.pid);
  process.exit(2);
}, 50000);

const SCRIPTS = {
  reader: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1000);
    document.getElementById('btnSettings').click();
    await sleep(300);
    const pb = document.querySelector('#settings [data-seg="mode"] [data-val="play"]');
    if (pb) pb.click();
    await sleep(900);
    const cb = document.querySelector('[data-act="close-drawer"]');
    if (cb) cb.click();
    await sleep(400);
    for (let i = 0; i < 7; i++) { document.getElementById('stage').click(); await sleep(520); }
    await sleep(1500);
    return 'mode=play beats=' + document.querySelectorAll('#beats .beat').length;
  `,
  paragraph: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(900);
    document.getElementById('stage').scrollTop = 180;
    await sleep(900);
    return 'beats=' + document.querySelectorAll('#beats .beat').length;
  `,
  images: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const buf = await fetch('/example/%E5%8E%8B%E5%8A%9B%E6%B5%8B%E8%AF%95.epub').then(r => r.arrayBuffer());
    const file = new File([buf], 'stress.epub', { type: 'application/epub+zip' });
    const dt = new DataTransfer(); dt.items.add(file);
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    document.dispatchEvent(ev);
    await sleep(3200);
    document.getElementById('btnChapters').click();
    await sleep(400);
    const items = document.querySelectorAll('.chap-item');
    if (items[3]) items[3].click();
    await sleep(1200);
    return 'imgs=' + document.querySelectorAll('#beats img').length;
  `,
  chapter: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(900);
    document.getElementById('btnSettings').click();
    await sleep(300);
    document.querySelector('#settings [data-seg="granularity"] [data-val="chapter"]').click();
    await sleep(900);
    document.querySelector('[data-act="close-drawer"]').click();
    await sleep(500);
    document.getElementById('stage').scrollTop = 260;
    await sleep(700);
    return 'beats=' + document.querySelectorAll('#beats .beat').length;
  `,
  scrub: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(900);
    for (let i = 0; i < 3; i++) { document.getElementById('stage').click(); await sleep(400); }
    const track = document.getElementById('progressTrack');
    const r = track.getBoundingClientRect();
    const x = r.left + r.width * 0.52;
    track.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, pointerId: 1 }));
    track.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, pointerId: 1 }));
    await sleep(500);
    return 'tip=' + document.getElementById('progressTip').textContent;
  `,
  chapters: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(900);
    for (let i = 0; i < 5; i++) { document.getElementById('stage').click(); await sleep(520); }
    document.getElementById('btnChapters').click();
    await sleep(600);
    return 'items=' + document.querySelectorAll('.chap-item').length;
  `,
  select: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1100);
    document.getElementById('btnSettings').click();
    await sleep(320);
    const off = document.querySelector('#settings [data-seg="gateOn"] [data-val="0"]');
    if (off) { off.click(); await sleep(800); }
    const cd = document.querySelector('[data-act="close-drawer"]');
    if (cd) cd.click();
    await sleep(500);
    const stage = document.getElementById('stage');
    stage.scrollTop = stage.scrollHeight;
    await sleep(800);
    const sr = stage.getBoundingClientRect();
    let beat = null;
    for (const b of Array.from(document.querySelectorAll('#beats .beat')).reverse()) {
      const r = b.getBoundingClientRect();
      if (r.top > sr.top + 40 && r.bottom < sr.bottom - 60 && r.width > 160 && b.textContent.length > 8) { beat = b; break; }
    }
    if (!beat) return 'no-beat';
    const r = beat.getBoundingClientRect();
    const x = Math.round(r.left + Math.min(80, r.width / 2));
    const y = Math.round(r.top + r.height / 2);
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 2, pointerType: 'mouse' };
    beat.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(640);
    const sel = window.getSelection();
    const got = sel.toString();
    beat.dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(500);
    return 'sel=' + got + ' chip=' + (!document.getElementById('selChip').hidden);
  `,
  gateopts: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1200);
    document.getElementById('btnSettings').click();
    await sleep(500);
    const f = document.querySelector('#settings .field.sub');
    if (f) f.scrollIntoView({ block: 'center' });
    await sleep(500);
    const lbl = document.querySelector('#settings #lblGate');
    return 'gate=' + (lbl ? lbl.textContent : 'none');
  `,
  echo: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const buf = await fetch('/example/%E9%95%BF%E5%A4%9C%E8%A1%8C.txt').then(r => r.arrayBuffer());
    const file = new File([buf], '长夜行.txt', { type: 'text/plain' });
    const dt = new DataTransfer(); dt.items.add(file);
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    document.dispatchEvent(ev);
    await sleep(3200);
    const Engine = window.XR.Engine;
    const metas = await window.XR.Store.listBooks();
    const book = await window.XR.Store.getBook(metas[0].id);
    let target = null;
    for (let i = 0; i < 90 && !target; i++) {
      for (const kw of document.querySelectorAll('#beats .kw')) {
        const beat = kw.closest('.beat');
        const txt = beat && beat._beat ? beat._beat.text : (beat ? beat.textContent : '');
        if (Engine.findEcho(book, kw.dataset.word, 0, txt).refs.length) { target = kw; break; }
      }
      if (!target) { document.getElementById('stage').click(); await sleep(240); }
    }
    if (target) { target.click(); await sleep(900); }
    return target ? 'word=' + target.dataset.word : 'no-kw';
  `,
  night: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(900);
    document.getElementById('btnTheme').click();
    await sleep(300);
    for (let i = 0; i < 6; i++) { document.getElementById('stage').click(); await sleep(480); }
    await sleep(1200);
    return 'theme=' + document.body.dataset.theme;
  `,
  shelf: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(800);
    for (let i = 0; i < 5; i++) { document.getElementById('stage').click(); await sleep(300); }
    document.getElementById('btnBack').click();
    await sleep(700);
    return 'shelf';
  `,
  move: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1400);
    const stage = document.getElementById('stage');
    stage.scrollTop = (stage.scrollHeight - stage.clientHeight) * 0.18;
    await sleep(1200);
    return 'beats=' + document.querySelectorAll('#beats .beat').length +
      ' zg=' + document.querySelectorAll('#beats .zg').length +
      ' alive=' + document.querySelectorAll('#beats .beat.alive').length +
      ' moves=' + JSON.stringify(Array.from(document.querySelectorAll('#beats .zg')).reduce((a, b) => (a[b.dataset.m] = (a[b.dataset.m] || 0) + 1, a), {})) +
      ' kw=' + JSON.stringify(Array.from(document.querySelectorAll('#beats .kw')).map((k) => k.dataset.mk));
  `,
  settings: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1200);
    document.getElementById('btnSettings').click();
    await sleep(600);
    return 'settings=' + (!document.getElementById('settings').hidden);
  `,
  mood: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1200);
    document.getElementById('btnSettings').click();
    await sleep(500);
    const seg = document.querySelector('#settings [data-seg="mood"]');
    if (seg) seg.scrollIntoView({ block: 'center' });
    await sleep(700);
    return 'mood=' + (seg ? seg.querySelectorAll('button').length : 0);
  `,
  gate: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1000);
    const stage = document.getElementById('stage');
    const strips = Array.from(document.querySelectorAll('#beats .gate-strip'));
    for (let k = 0; k < 40 && document.getElementById('gateLayer').hidden; k++) {
      const s = strips[0];
      if (!s) break;
      const r = s.getBoundingClientRect();
      stage.scrollTop += Math.max(50, r.top - stage.clientHeight * 0.5);
      await sleep(150);
    }
    await sleep(700);
    const info = document.querySelector('#gateLayer .gate-card');
    return 'gate=' + (!document.getElementById('gateLayer').hidden) + ' text=' + (info ? info.textContent.slice(0, 40) : '');
  `,
  card: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const buf = await fetch('/example/%E9%95%BF%E5%A4%9C%E8%A1%8C.txt').then(r => r.arrayBuffer());
    const file = new File([buf], '长夜行.txt', { type: 'text/plain' });
    const dt = new DataTransfer(); dt.items.add(file);
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    document.dispatchEvent(ev);
    await sleep(3000);
    const stage = document.getElementById('stage');
    const Engine = window.XR.Engine;
    const metas = await window.XR.Store.listBooks();
    const book = await window.XR.Store.getBook(metas.find((m) => /长夜行/.test(m.title)).id);
    let target = null;
    for (const kw of document.querySelectorAll('#beats .kw')) {
      if (Engine.findEcho(book, kw.dataset.word, 0, '').refs.length) target = kw;
    }
    if (target) {
      const r = target.getBoundingClientRect();
      const stR = stage.getBoundingClientRect();
      const abs = r.top - stR.top + stage.scrollTop;
      stage.scrollTop = Math.max(0, abs - stage.clientHeight * 0.45);
      await sleep(700);
    }
    // 再确认一下屏幕中间那行的第一个词是不是它；不是就用这行的卡
    document.getElementById('btnSettings').click();
    await sleep(320);
    const b = document.querySelector('#settings [data-act="try-gate"]');
    if (b) b.click();
    await sleep(700);
    const card = document.querySelector('#gateLayer .gate-card');
    return 'kw=' + (target ? target.dataset.word : 'none') +
      ' echo=' + !!document.querySelector('.gate-echo') +
      ' card=' + (card ? card.textContent.replace(/\\s+/g, ' ').slice(0, 56) : 'none');
  `,
  seam: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1000);
    document.getElementById('btnSettings').click();
    await sleep(300);
    const rb = document.querySelector('#settings [data-seg="mode"] [data-val="read"]');
    if (rb) rb.click();
    await sleep(800);
    const gz = document.querySelector('#settings [data-seg="gateOn"] [data-val="0"]');
    if (gz) gz.click();
    await sleep(700);
    document.querySelector('[data-act="close-drawer"]').click();
    await sleep(400);
    const stage = document.getElementById('stage');
    stage.scrollTop = stage.scrollHeight;
    await sleep(500);
    stage.click();
    await sleep(220);
    const seamSeen = document.getElementById('beats').classList.contains('seam');
    await sleep(820);
    return 'ch=' + document.getElementById('chapterTitle').textContent.slice(0, 18) +
      ' seam=' + seamSeen +
      ' sheet=' + !document.getElementById('choiceLayer').hidden +
      ' card=' + !!document.querySelector('#beats .chapter-card');
  `,
  read: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1000);
    document.getElementById('btnSettings').click();
    await sleep(300);
    const rb = document.querySelector('#settings [data-seg="mode"] [data-val="read"]');
    if (rb) rb.click();
    await sleep(900);
    const gz = document.querySelector('#settings [data-seg="gateOn"] [data-val="0"]');
    if (gz) gz.click();
    await sleep(900);
    document.querySelector('[data-act="close-drawer"]').click();
    await sleep(600);
    const stage = document.getElementById('stage');
    stage.scrollTop = (stage.scrollHeight - stage.clientHeight) * 0.32;
    await sleep(1200);
    return 'beats=' + document.querySelectorAll('#beats .beat').length + ' wv=' + document.querySelectorAll('#beats .wv').length;
  `,
  enplay: `    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const buf = await fetch('/example/Wimpy%20%E9%A3%8E%E6%A0%BC.epub').then(r => r.arrayBuffer());
    const file = new File([buf], 'wimpy.epub', { type: 'application/epub+zip' });
    const dt = new DataTransfer(); dt.items.add(file);
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    document.dispatchEvent(ev);
    await sleep(3600);
    document.getElementById('btnSettings').click();
    await sleep(300);
    document.querySelector('#settings [data-seg="mode"] [data-val="play"]').click();
    await sleep(900);
    document.querySelector('[data-act="close-drawer"]').click();
    await sleep(400);
    document.getElementById('btnChapters').click();
    await sleep(400);
    const items = document.querySelectorAll('.chap-item');
    if (items[2]) items[2].click();
    await sleep(900);
    for (let i = 0; i < 4; i++) { document.getElementById('stage').click(); await sleep(700); }
    await sleep(900);
    return 'beats=' + document.querySelectorAll('#beats .beat').length + ' dialogue=' + document.querySelectorAll('#beats .beat.dialogue').length;
  `,
  immersive: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1000);
    document.getElementById('btnSettings').click();
    await sleep(300);
    const off = document.querySelector('#settings [data-seg="gateOn"] [data-val="0"]');
    if (off) { off.click(); await sleep(700); }
    const rs = document.querySelector('#settings [data-act="restart"]');
    if (rs) { rs.click(); await sleep(800); }
    document.getElementById('btnSettings').click();
    await sleep(300);
    document.querySelector('#settings [data-seg="mode"] [data-val="immersive"]').click();
    await sleep(800);
    document.querySelector('#settings [data-seg="stageUnit"] [data-val="paragraph"]').click();
    await sleep(500);
    document.querySelector('#settings [data-seg="stageKeep"] [data-val="2"]').click();
    await sleep(500);
    document.querySelector('[data-act="close-drawer"]').click();
    await sleep(500);
    for (let i = 0; i < 4; i++) { document.getElementById('stage').click(); await sleep(750); }
    await sleep(1200);
    return 'beats=' + document.querySelectorAll('#beats .beat').length +
      ' depth=' + Array.from(document.querySelectorAll('#beats .beat')).map((e) => e.dataset.depth || '-').join(',');
  `,
  rules: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1000);
    document.getElementById('btnSettings').click();
    await sleep(350);
    const act = document.getElementById('ruleAct');
    act.value = 'glow';
    act.dispatchEvent(new Event('change', { bubbles: true }));
    const pat = document.getElementById('rulePat');
    pat.value = '「[^」]+」';
    pat.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(600);
    document.querySelector('[data-act="rule-add"]').click();
    await sleep(900);
    const act2 = document.getElementById('ruleAct');
    act2.value = 'replace';
    act2.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
    const pat2 = document.getElementById('rulePat');
    pat2.value = '…{2,}';
    pat2.dispatchEvent(new Event('input', { bubbles: true }));
    const repl = document.getElementById('ruleRepl');
    repl.value = '……';
    repl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);
    document.querySelector('[data-act="rule-add"]').click();
    await sleep(900);
    const pat3 = document.getElementById('rulePat');
    pat3.value = '「[^」]+」';
    pat3.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(700);
    const list = document.querySelector('#settings .rule-list');
    if (list) list.scrollIntoView({ block: 'center' });
    await sleep(900);
    return 'rules=' + document.querySelectorAll('#settings .rule-row').length +
      ' test=' + (document.getElementById('ruleTest') ? document.getElementById('ruleTest').textContent.slice(0, 30) : '');
  `,
  search: `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('btnSample').click();
    await sleep(1000);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(500);
    const inp = document.getElementById('searchInput');
    inp.value = '雨';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(900);
    const hits = document.querySelectorAll('#searchList .search-hit');
    if (hits[0]) { hits[0].click(); await sleep(900); }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(700);
    return 'hits=' + document.querySelectorAll('#searchList .search-hit').length +
      ' mark=' + document.querySelectorAll('#beats mark.hit').length;
  `
};

async function main() {
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  if (!target) { console.error('CDP 没有就绪'); return; }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res) => pending.set(id, res));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_APP });
  await sleep(1800);

  const body = SCRIPTS[scenario];
  if (!body) { console.error('未知场景：' + scenario); ws.close(); return; }

  const res = await send('Runtime.evaluate', {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const value = res.result && res.result.result && res.result.result.value;
  const exc = res.result && res.result.exceptionDetails;
  console.log(scenario, '=>', value, exc ? ' 异常: ' + JSON.stringify(exc).slice(0, 300) : '');

  await sleep(700);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('saved', out, fs.statSync(out).size);
  } else {
    console.error('截图失败', JSON.stringify(shot).slice(0, 300));
  }
  ws.close();
}

try {
  await main();
} catch (e) {
  console.error('出错：', e && e.message);
} finally {
  clearTimeout(watchdog);
  killTree(edge.pid);
  await sleep(300);
  process.exit(0);
}


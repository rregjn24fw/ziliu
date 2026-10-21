/* 章节跳转压力测试（逐步驱动，避免长任务卡死）：node tools/chapter-test.mjs [epub] */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 300);
const WEB = process.env.PORT || 8931;
const target = process.argv[2] || 'example/压力测试.epub';
const urlTarget = encodeURI('/' + target.replace(/^\.?\//, ''));
const URL_APP = `http://127.0.0.1:${WEB}/index.html`;

const profile = path.join(os.tmpdir(), 'ziliu-ch-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--window-size=1280,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

function killTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
}
const watchdog = setTimeout(() => { console.error('超时'); killTree(edge.pid); process.exit(2); }, 120000);

let ws, seq = 0;
const pending = new Map();
const LOGFILE = 'tools/chapter-test.log';
try { fs.writeFileSync(LOGFILE, ''); } catch (e) { /* ignore */ }
const log = (m) => { const s = typeof m === 'string' ? m : JSON.stringify(m); try { fs.appendFileSync(LOGFILE, s + '\n'); } catch (e) { /* ignore */ } };
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}
async function evalJs(expression) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    sleep(20000).then(() => ({ __timeout: true }))
  ]);
  if (r.__timeout) return { __err: 'evaluate 超时' };
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    return { __err: (d.exception && d.exception.description) || d.text };
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
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
  await sleep(2000);

  await evalJs(`window.__errs = []; window.addEventListener('error', e => window.__errs.push(String(e.message)));
                  window.addEventListener('unhandledrejection', e => window.__errs.push('reject: ' + (e.reason && e.reason.message || e.reason)));`);

  const imported = await evalJs(`(async () => {
    try {
      const buf = await fetch(${JSON.stringify(urlTarget)}).then(r => r.arrayBuffer());
      const file = new File([buf], 'stress.epub', { type: 'application/epub+zip' });
      const dt = new DataTransfer(); dt.items.add(file);
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
      document.dispatchEvent(ev);
      return 'dropped ' + buf.byteLength;
    } catch (e) { return 'ERR ' + e.message; }
  })()`);
  log('import: ' + JSON.stringify(imported));
  await sleep(3500);

  const state = `(() => ({
    beats: document.querySelectorAll('#beats .beat').length,
    imgs: document.querySelectorAll('#beats img').length,
    crash: !document.getElementById('crash').hidden,
    crashText: document.getElementById('crash').hidden ? '' : document.getElementById('crashMsg').textContent.slice(0, 200),
    title: document.getElementById('chapterTitle').textContent,
    reader: !document.getElementById('reader').hidden,
    mode: document.getElementById('settings').hidden ? '' : ''
  }))()`;
  log('after import: ' + JSON.stringify(await evalJs(state)));

  const openList = await evalJs(`(() => { document.getElementById('btnChapters').click(); return document.querySelectorAll('.chap-item').length; })()`);
  log('chapters in list: ' + JSON.stringify(openList));
  await evalJs(`(() => { const c = document.querySelector('[data-act="close-drawer"]'); if (c) c.click(); return 1; })()`);
  await sleep(200);

  const results = [];
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      await evalJs(`(async () => {
        document.getElementById('btnSettings').click();
        await new Promise(r => setTimeout(r, 250));
        const b = document.querySelector('[data-seg="mode"] [data-val="play"]');
        if (b) b.click();
        await new Promise(r => setTimeout(r, 500));
        const c = document.querySelector('[data-act="close-drawer"]');
        if (c) c.click();
        return 1;
      })()`);
      await sleep(800);
      log('--- 切到互动模式 ---');
    }

    for (let i = 0; i < 12; i++) {
      const r = await evalJs(`(async () => {
        const gl = document.getElementById('gateLayer');
        if (gl && !gl.hidden) gl.click();
        document.getElementById('btnChapters').click();
        await new Promise(r => setTimeout(r, 220));
        const items = document.querySelectorAll('.chap-item');
        if (!items[${i}]) { document.querySelector('[data-act="close-drawer"]').click(); return 'no-item'; }
        items[${i}].click();
        await new Promise(r => setTimeout(r, 650));
        return 1;
      })()`);
      if (r === 'no-item') break;
      const st = await evalJs(state);
      results.push({ pass, i, ...st });
      log(JSON.stringify({ pass, i, ...st }));
      if (st && st.crash) {
        await evalJs(`(() => { document.getElementById('crash').hidden = true; return 1; })()`);
      }
    }
  }

  log('errors: ' + JSON.stringify(await evalJs('window.__errs')));
  ws.close();
}

try { await main(); } catch (e) { console.error('出错：', e && e.message); }
finally { clearTimeout(watchdog); killTree(edge.pid); await sleep(300); process.exit(0); }

/* 字的手感截图：node tools/shot-motion.mjs <cn|en> <out.png>
   前置：node tools/serve.mjs（同一 PORT）
   用途：看跳词底色、英文按词排版、指针柔光是否正常 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 400);
const WEB = process.env.PORT || 8931;
const scenario = process.argv[2] || 'cn';
const out = path.resolve(process.argv[3] || `tools/shot-motion-${scenario}.png`);
const VW = Number(process.env.VW || 1280);
const VH = Number(process.env.VH || 900);
const profile = path.join(os.tmpdir(), 'ziliu-shot-' + Date.now() + '-' + PORT);

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', `--window-size=${VW},${VH}`,
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

function killTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
}
const watchdog = setTimeout(() => { console.error('超时'); killTree(edge.pid); process.exit(2); }, 60000);

let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error('CDP 超时：' + method)); }, 40000);
    pending.set(id, (r) => { clearTimeout(t); resolve(r); });
  });
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval error');
  return r && r.result ? r.result.value : undefined;
}

async function main() {
  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((x) => x.type === 'page');
      if (target) break;
    } catch (e) { /* not up */ }
    await sleep(200);
  }
  if (!target) throw new Error('连不上 CDP');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: Number(process.env.DPR || 1), mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${WEB}/index.html` });
  await sleep(1500);

  const URL_APP = `http://127.0.0.1:${WEB}/index.html`;
  let bookId = '';

  // 先关掉卡页与逐字显影，画面干净好比较
  await evaljs(`(function(){
    const s = XR.Store.loadSettings();
    s.gateOn = false;
    s.typewriter = false;
    XR.Store.saveSettings(s);
  })()`);

  if (scenario === 'en') {
    bookId = await evaljs(`(async () => {
      const txt = 'Chapter 1\\n\\nThe rain had stopped before the librarian looked up. He turned a page, and the lantern swayed over the well-known shelves, as if the room itself were breathing.\\n\\nShe said, "Do not hurry. The night is long, and every word here has been waiting for you."\\n\\nOutside, the street lamps came on one by one.';
      const file = new File([txt], 'english-sample.txt', { type: 'text/plain' });
      const book = await XR.Import.fromFile(file);
      await XR.Store.saveBook(book);
      return book.id;
    })()`);
  }

  // 重新进页面，让设置生效
  await send('Page.navigate', { url: URL_APP });
  await sleep(1600);

  if (scenario === 'en' && bookId) {
    await evaljs(`document.querySelector('.book-card[data-id="${bookId}"]').click()`);
    await sleep(1400);
  } else {
    await evaljs(`document.getElementById('btnSample').click()`);
    await sleep(1400);
  }

  // 让自动播放走几句，画面里有几段文字
  for (let i = 0; i < 6; i++) { await evaljs(`document.getElementById('stage').click()`); await sleep(260); }
  await evaljs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(200);
  const hover = (process.env.HOVER || '620,420').split(',').map(Number);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover[0], y: hover[1], buttons: 0 });
  await sleep(500);

  const clipArg = process.env.CLIP;
  const clip = clipArg ? (([x, y, width, height]) => ({ x, y, width, height, scale: 2 }))(clipArg.split(',').map(Number)) : undefined;
  const shot = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
}

try {
  await main();
} catch (e) {
  console.error('失败：' + (e && e.message ? e.message : e));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  try { ws && ws.close(); } catch (e) { /* ignore */ }
  killTree(edge.pid);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

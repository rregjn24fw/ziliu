/* 测试 file:// 直接打开的场景：node tools/file-test.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9344;
const fileUrl = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');

const profile = path.join(os.tmpdir(), 'ziliu-file-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--window-size=1280,900',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch (e) { /* not up */ }
  await sleep(200);
}
if (!target) { console.error('CDP 未就绪'); edge.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res, { once: true }));
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
await send('Page.navigate', { url: fileUrl });
await sleep(2200);

const epubB64 = fs.readFileSync('example/雨停之前.epub').toString('base64');

const expr = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};
  out.storeMode = window.XR && XR.Store ? XR.Store.mode : 'no-XR';
  out.crashVisible = !document.getElementById('crash').hidden;

  const bin = atob(${JSON.stringify(epubB64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], '雨停之前.epub', { type: 'application/epub+zip' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
  Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
  document.dispatchEvent(ev);
  await sleep(2500);

  const card = document.querySelector('.book-card');
  out.imported = !!card;
  out.title = card ? card.querySelector('.bc-title').textContent : '';
  if (card) {
    card.click();
    await sleep(1200);
    out.readerOpen = !document.getElementById('reader').hidden;
    out.beats = document.querySelectorAll('#beats .beat').length;
    document.getElementById('stage').click();
    await sleep(300);
    out.beatsAfterClick = document.querySelectorAll('#beats .beat').length;
    out.chapterTitle = document.getElementById('chapterTitle').textContent;
  }
  return JSON.stringify(out);
})()`;

const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log('file:// 结果:', res.result && res.result.result && res.result.result.value);
if (res.result && res.result.exceptionDetails) console.log('异常:', JSON.stringify(res.result.exceptionDetails).slice(0, 500));

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result && shot.result.data) {
  fs.writeFileSync('tools/shot-file.png', Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot saved');
}

ws.close();
edge.kill();
await sleep(300);
process.exit(0);

/* 跑端到端测试页：node tools/run-page.mjs [端口]
   需要先起 node tools/serve.mjs（同一个 PORT） */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9500 + Math.floor(Math.random() * 300);
const WEB = process.argv[2] || process.env.PORT || 8931;
const REPORT = path.join('tools', 'report.txt');

try { fs.unlinkSync(REPORT); } catch (e) { /* ignore */ }

const profile = path.join(os.tmpdir(), 'ziliu-page-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--window-size=1320,920',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

function killTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
}
const watchdog = setTimeout(() => { console.error('超时'); killTree(edge.pid); process.exit(2); }, 300000);

let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}

async function main() {
  let t = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${WEB}/tools/test-page.html` });

  for (let i = 0; i < 300; i++) {
    await sleep(500);
    if (fs.existsSync(REPORT)) {
      const txt = fs.readFileSync(REPORT, 'utf8');
      if (txt.trim().length) break;
    }
  }
  await sleep(600);
  ws.close();
}

try { await main(); } catch (e) { console.error('出错：', e && e.message); }
finally {
  clearTimeout(watchdog);
  killTree(edge.pid);
  await sleep(300);
  if (!fs.existsSync(REPORT)) { console.log('没有拿到报告'); process.exit(1); }
  const txt = fs.readFileSync(REPORT, 'utf8');
  const lines = txt.split('\n').filter((l) => /^(PASS|FAIL)/.test(l));
  const fails = lines.filter((l) => l.startsWith('FAIL'));
  console.log(txt.trim());
  console.log('\n—— ' + lines.length + ' 项，' + fails.length + ' 项失败 ——');
  process.exit(fails.length ? 1 : 0);
}

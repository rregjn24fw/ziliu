/* 桌面端（真鼠标）回归：node tools/desktop-test.mjs
   —— 用 CDP 的 Input.dispatchMouseEvent 发真实的鼠标按下/抬起，验证：
      1. 正文、左右留白、页脚空白、顶栏空白，点哪儿都能继续翻页
      2. 读到章末直接进下一章，全程不弹「本章完」确认
      3. 正常长度的章，点着读也能弹出卡页
      4. 每章只有几行的书，读几章也能遇到卡页
      5. 点击 / 双击 / 手抖拖一下都不选中文字，只有长按才选（真鼠标）
      · 真鼠标点 ▷ 自动播放会自己往下走、跨章不停，再点一下就停
   需要先起 node tools/serve.mjs（同一个 PORT）。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 400);
const WEB = process.env.PORT || 8944;
const URL_APP = `http://127.0.0.1:${WEB}/index.html`;
const W = Number(process.env.W || 1440);
const H = Number(process.env.H || 900);
const LOG = path.join('tools', 'desktop-test.log');

const out = [];
const flushLog = () => { try { fs.writeFileSync(LOG, out.join('\n') + '\n'); } catch (e) { /* ignore */ } };
const log = (ok, name, detail) => {
  out.push((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''));
  flushLog();
  console.log(out[out.length - 1]);
};
const mark = (name) => { console.log('···· ' + name); };

const profile = path.join(os.tmpdir(), 'ziliu-desk-' + Date.now() + '-' + PORT);
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', `--window-size=${W},${H}`,
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

const killTree = (pid) => {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
};
const watchdog = setTimeout(() => { console.error('超时'); killTree(edge.pid); process.exit(2); }, 300000);

let seq = 0;
const pending = new Map();
let ws;

const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
};
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  const d0 = r.result;
  if (d0 && d0.exceptionDetails) return { error: String(d0.exceptionDetails.text) + ' ' + String(d0.exceptionDetails.exception && d0.exceptionDetails.exception.description).slice(0, 200) };
  const v = d0 && d0.result ? d0.result.value : undefined;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return v; }
};
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const state = () => evaluate(`
  const st = document.getElementById('stage');
  return JSON.stringify({
    top: Math.round(st.scrollTop),
    max: Math.round(st.scrollHeight - st.clientHeight),
    gate: !document.getElementById('gateLayer').hidden,
    choice: !document.getElementById('choiceLayer').hidden,
    word: !document.getElementById('wordLayer').hidden,
    drawer: !document.getElementById('settings').hidden,
    ch: document.getElementById('chapterTitle').textContent.slice(0, 16),
    strips: document.querySelectorAll('#beats .gate-strip').length,
    beats: document.querySelectorAll('#beats .beat').length
  });
`);

async function reset() {
  await evaluate(`
    const st = document.getElementById('stage');
    if (!document.getElementById('gateLayer').hidden) document.getElementById('gateLayer').click();
    if (!document.getElementById('wordLayer').hidden) { document.getElementById('wordLayer').hidden = true; }
    if (!document.getElementById('settings').hidden) { document.querySelector('[data-act="close-drawer"]').click(); }
    if (!document.getElementById('choiceLayer').hidden) {
      const b = document.querySelector('#choiceLayer [data-act="restart"]');
      if (b) b.click();
      else document.getElementById('choiceLayer').hidden = true;
    }
    await new Promise((r) => setTimeout(r, 700));
    st.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 300));
    return 1;
  `);
}

async function importTxt(file, url) {
  return evaluate(`
    const buf = await fetch('${url}').then((r) => r.arrayBuffer());
    const f = new File([buf], '${file}', { type: 'text/plain' });
    const dt = new DataTransfer(); dt.items.add(f);
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    document.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 2800));
    return JSON.stringify({ ch: document.getElementById('chapterTitle').textContent.slice(0, 20),
      beats: document.querySelectorAll('#beats .beat').length });
  `);
}

async function main() {
  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  if (!target) { console.error('CDP 没有就绪'); return; }

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: false });
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_APP });
  await sleep(1900);

  mark('section 1');
  /* ---------- 1. 真鼠标点各处空白 ---------- */
  await evaluate(`document.getElementById('btnSample').click(); await new Promise(r => setTimeout(r, 1200)); return 1;`);
  await reset();

  const spots = [
    ['正文中间', Math.round(W / 2), Math.round(H * 0.45)],
    ['左边留白', 14, Math.round(H * 0.5)],
    ['右边留白', W - 14, Math.round(H * 0.5)],
    ['正文下方空白', Math.round(W / 2), Math.round(H * 0.8)],
    ['页脚空白', Math.round(W * 0.3), H - 16],
    ['顶栏空白', Math.round(W * 0.45), 10],
    ['左下角', 12, H - 12],
    ['右上角', W - 12, 10]
  ];
  const misses = [];
  for (const [name, x, y] of spots) {
    await reset();
    const before = await state();
    await clickAt(x, y);
    await sleep(280);
    let after = await state();
    // 这一下只要有任何反应就算数：翻了一屏、弹了卡、弹了回声、或者直接读到本章完
    const responded = after.top > before.top + 6 || after.choice || after.gate || after.word || after.drawer;
    if (after.gate) { await clickAt(W / 2, H / 2); await sleep(320); after = await state(); }
    if (after.gate || after.word || after.choice || after.drawer) await reset();
    if (!responded) {
      const el = await evaluate(`const e = document.elementFromPoint(${x}, ${y}); return JSON.stringify(e ? e.tagName + '.' + (e.className || '') + '#' + (e.id || '') : 'none');`);
      misses.push(name + '（落点 ' + el + '）');
    }
  }
  log(misses.length === 0, '点正文 / 留白 / 页脚 / 顶栏空白都能继续翻页',
    misses.length ? '没反应：' + misses.join('、') : spots.length + ' 处全有反应');

  mark('section 2');
  /* ---------- 2. 章末自动进下一章，不弹确认 ---------- */
  await reset();
  const ch0 = (await state()).ch;
  let sawSheet = false;
  let nextCh = null;
  for (let i = 0; i < 8 && !nextCh; i++) {
    await evaluate(`const st = document.getElementById('stage'); st.scrollTop = st.scrollHeight; return 1;`);
    await sleep(160);
    await clickAt(Math.round(W / 2), Math.round(H * 0.5));
    await sleep(460);
    const s = await state();
    if (s.choice) sawSheet = true;
    if (s.gate) { await clickAt(Math.round(W / 2), Math.round(H * 0.5)); await sleep(360); continue; }
    if (s.ch !== ch0) nextCh = s.ch;
  }
  log(!!nextCh && !sawSheet, '读到章末直接进下一章，不弹「本章完」',
    (sawSheet ? '出现了弹层 · ' : '') + ch0 + ' → ' + (nextCh || '没换章'));

  mark('section 3');
  /* ---------- 3. 正常长度的一章：点着读也会弹卡 ---------- */
  await importTxt('长夜行.txt', '/example/%E9%95%BF%E5%A4%9C%E8%A1%8C.txt');
  await sleep(400);
  const longInit = await state();
  let pops = 0;
  for (let i = 0; i < 9; i++) {
    await clickAt(Math.round(W / 2), Math.round(H * 0.5));
    await sleep(340);
    const s = await state();
    if (s.gate) {
      pops++;
      await clickAt(Math.round(W / 2), Math.round(H * 0.5));
      await sleep(300);
    }
    if ((await state()).choice) break;
  }
  log(pops >= 2, '正常长度的一章，点着读也会不断弹卡', '弹了 ' + pops + ' 张 · 本章埋了 ' + longInit.strips + ' 张');

  mark('section 4');
  /* ---------- 4. 每章只有几行的书：读几章也会弹卡 ---------- */
  await importTxt('短章测试.txt', '/example/%E7%9F%AD%E7%AB%A0%E6%B5%8B%E8%AF%95.txt');
  await sleep(400);
  const shortInit = await state();
  let shortPops = 0;
  let chaptersSeen = 0;
  let chPrev = shortInit.ch;
  for (let i = 0; i < 30 && chaptersSeen < 3; i++) {
    await clickAt(Math.round(W / 2), Math.round(H * 0.5));
    await sleep(300);
    const s = await state();
    if (s.gate) { shortPops++; await clickAt(Math.round(W / 2), Math.round(H * 0.5)); await sleep(300); }
    if (s.ch !== chPrev) { chaptersSeen++; chPrev = s.ch; }
  }
  log(shortPops >= 1, '每章只有几行的书，读几章也会弹出卡页',
    '弹了 ' + shortPops + ' 张 · 首章埋了 ' + shortInit.strips + ' 张 · 过了 ' + chaptersSeen + ' 章');

  mark('section 5');
  /* ---------- 5. 真鼠标：点击 / 双击 / 拖动都不许选中文字，只有长按才选 ---------- */
  // 先把卡页关掉：这一节只验证选字，别让中途弹出来的卡页抢走点击
  await evaluate(`
    document.getElementById('btnSettings').click();
    await new Promise((r) => setTimeout(r, 300));
    const off = document.querySelector('#settings [data-seg="gateOn"] [data-val="0"]');
    if (off) off.click();
    await new Promise((r) => setTimeout(r, 800));
    const close = document.querySelector('[data-act="close-drawer"]');
    if (close) close.click();
    await new Promise((r) => setTimeout(r, 400));
    return 1;
  `);
  await reset();
  const pt = await evaluate(`
    const st = document.getElementById('stage');
    const sr = st.getBoundingClientRect();
    let best = null;
    for (const el of document.querySelectorAll('#beats .beat')) {
      const r = el.getBoundingClientRect();
      if (r.top > sr.top + 30 && r.bottom < sr.bottom - 30 && r.width > 100) {
        if (!best || r.width > best.w) best = { w: r.width, x: Math.round(r.left + Math.min(90, r.width / 2)), y: Math.round(r.top + r.height / 2) };
      }
    }
    if (!best) best = { x: Math.round(sr.left + sr.width / 2), y: Math.round(sr.top + sr.height * 0.6) };
    return JSON.stringify(best);
  `);
  const selInfo = () => evaluate(`
    const s = window.getSelection();
    return JSON.stringify({ text: s ? String(s) : '', collapsed: !s || s.isCollapsed, chip: !document.getElementById('selChip').hidden });
  `);

  // 拖一下（很多人点空白的时候手会抖）：不许变成选区
  await evaluate(`window.getSelection().removeAllRanges(); return 1;`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 4; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x + i * 14, y: pt.y + i * 2, button: 'left', clickCount: 1 });
    await sleep(40);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x + 56, y: pt.y + 8, button: 'left', clickCount: 1 });
  await sleep(250);
  let si = await selInfo();
  log(si.collapsed && !si.chip, '手抖拖一下不会选中文字', '选中="' + si.text.slice(0, 12) + '"');

  // 双击：也是继续，不选词
  await reset();
  await evaluate(`window.getSelection().removeAllRanges(); return 1;`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 2 });
  await sleep(300);
  si = await selInfo();
  log(si.collapsed && !si.chip, '双击不选词（两下都算继续）', '选中="' + si.text.slice(0, 12) + '"');

  // 长按：才选中
  await reset();
  await evaluate(`window.getSelection().removeAllRanges(); return 1;`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(760);
  const held = await selInfo();
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(220);
  const afterHold = await selInfo();
  log(!held.collapsed && held.text.length >= 2 && afterHold.chip,
    '长按才选中，并浮出「回声」', '按住时选中="' + held.text + '" 按钮=' + afterHold.chip);

  // 选完点一下就继续，不会白吞（这中间要是弹了一张卡，先收掉：卡页开着时点一下只收卡）
  for (let i = 0; i < 3; i++) {
    if (!(await state()).gate) break;
    await clickAt(Math.round(W / 2), Math.round(H / 2));
    await sleep(360);
  }
  const beforeResume = await state();
  await sleep(400);
  // 点一块没有跳词的空白（左边留白），选区要收掉、阅读要接着走
  const blank = await evaluate(`
    const st = document.getElementById('stage');
    const sr = st.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(sr.left + 8), y: Math.round(sr.top + sr.height * 0.5) });
  `);
  await clickAt(blank.x, blank.y);
  await sleep(600);
  const afterResume = await state();
  const resumed = afterResume.top > beforeResume.top + 6 || afterResume.ch !== beforeResume.ch ||
    afterResume.choice || afterResume.word;
  const siAfter = await selInfo();
  log(siAfter.collapsed && resumed, '选完再点一下就继续读',
    '滚动 ' + beforeResume.top + ' → ' + afterResume.top + ' · 选区已收=' + siAfter.collapsed +
    (afterResume.choice ? ' · 全书完' : '') + (afterResume.word ? ' · 弹了回声卡' : '') +
    (afterResume.gate ? ' · 又弹了一张卡' : ''));

  mark('section 6');
  /* ---------- 6. 真键盘：Ctrl+F 打开搜索 → 输入 → Enter 跳到命中处 ---------- */
  await reset();
  const beforeSearch = await state();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 });
  await sleep(450);
  const searchOpen = await evaluate(`return !!document.getElementById('searchInput')`);
  await send('Input.insertText', { text: '雨' });
  await sleep(800);
  const hitCount = await evaluate(`return document.querySelectorAll('#searchList .search-hit').length`);
  log(!!searchOpen && hitCount > 0, '真键盘 Ctrl+F 打开搜索并输入',
    '面板=' + !!searchOpen + ' 命中=' + hitCount);

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(900);
  const afterSearch = await state();
  const hitMarks = await evaluate(`return document.querySelectorAll('#beats mark.hit').length`);
  const jumped = hitMarks > 0 || afterSearch.top > beforeSearch.top + 6 || afterSearch.ch !== beforeSearch.ch;
  log(jumped, 'Enter 跳到命中处，字上有高亮',
    '高亮=' + hitMarks + ' · ' + beforeSearch.ch + ' → ' + afterSearch.ch);

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(300);
  const closed = await evaluate(`return document.getElementById('settings').hidden`);
  log(closed === true, 'Esc 关掉搜索面板', 'hidden=' + closed);

  mark('section 7');
  /* ---------- 7. 沉浸模式：真键盘推进，最新一段落在正中 ---------- */
  await reset();
  await evaluate(`
    const d = document;
    d.getElementById('btnSettings').click();
    await new Promise((r) => setTimeout(r, 300));
    const go = d.querySelector('#settings [data-seg="gateOn"] [data-val="0"]');
    if (go) go.click();
    await new Promise((r) => setTimeout(r, 400));
    d.getElementById('btnSettings').click();
    await new Promise((r) => setTimeout(r, 300));
    const rs = d.querySelector('#settings [data-act="restart"]');
    if (rs) rs.click();
    await new Promise((r) => setTimeout(r, 800));
    d.getElementById('btnSettings').click();
    await new Promise((r) => setTimeout(r, 300));
    const mi = d.querySelector('#settings [data-seg="mode"] [data-val="immersive"]');
    if (mi) mi.click();
    await new Promise((r) => setTimeout(r, 700));
    const u = d.querySelector('#settings [data-seg="stageUnit"] [data-val="paragraph"]');
    if (u && !u.classList.contains('on')) u.click();
    await new Promise((r) => setTimeout(r, 500));
    const k = d.querySelector('#settings [data-seg="stageKeep"] [data-val="2"]');
    if (k && !k.classList.contains('on')) k.click();
    await new Promise((r) => setTimeout(r, 500));
    d.querySelector('[data-act="close-drawer"]').click();
    await new Promise((r) => setTimeout(r, 600));
    return 1;
  `);
  for (let i = 0; i < 4; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await sleep(650);
  }
  const imm = await evaluate(`
    const st = document.getElementById('stage');
    const beats = Array.from(document.querySelectorAll('#beats .beat'));
    const last = beats[beats.length - 1];
    const sr = st.getBoundingClientRect();
    const lr = last ? last.getBoundingClientRect() : null;
    return JSON.stringify({
      immersive: st.classList.contains('immersive-mode'),
      beats: beats.length,
      off: lr ? Math.round(Math.abs((lr.top + lr.height / 2) - (sr.top + sr.height / 2))) : -1,
      top: Math.round(st.scrollTop),
      depth: beats.slice(0, -1).map((e) => e.dataset.depth || '-').join(',')
    });
  `);
  log(imm && imm.immersive && imm.off >= 0 && imm.off <= 80 && imm.beats <= 3 && imm.top > 20,
    '沉浸模式：真键盘推进后最新一段仍在正中',
    '偏差=' + (imm ? imm.off : '?') + 'px · beats=' + (imm ? imm.beats : '?') +
    ' · 层级=' + (imm ? imm.depth : '?'));

  mark('section 8');
  /* ---------- 8. 真鼠标点 ▷：自动播放真的会走，还能跨章 ---------- */
  await importTxt('长夜行.txt', '/example/%E9%95%BF%E5%A4%9C%E8%A1%8C.txt');
  await evaluate(`
    const d = document;
    d.getElementById('btnSettings').click();
    await new Promise((r) => setTimeout(r, 320));
    const spd = d.getElementById('rngSpeed');
    if (spd) { spd.value = '10'; spd.dispatchEvent(new Event('input', { bubbles: true })); }
    const rd = d.querySelector('#settings [data-seg="mode"] [data-val="read"]');
    if (rd) rd.click();
    await new Promise((r) => setTimeout(r, 900));
    const rs = d.querySelector('#settings [data-act="restart"]');
    if (rs) rs.click();
    await new Promise((r) => setTimeout(r, 800));
    if (!d.getElementById('settings').hidden) {
      const c = d.querySelector('[data-act="close-drawer"]');
      if (c) c.click();
    }
    await new Promise((r) => setTimeout(r, 400));
    return 1;
  `);
  const autoBtnRect = await evaluate(`
    const r = document.getElementById('btnAuto').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  `);
  await clickAt(autoBtnRect.x, autoBtnRect.y);
  await sleep(1200);
  const auto1 = await state();
  const autoOn = await evaluate(`return JSON.stringify({ btn: document.getElementById('btnAuto').textContent,
    on: document.getElementById('btnAuto').classList.contains('on') });`);
  await sleep(1600);
  const auto2 = await state();
  log(autoOn && autoOn.btn === '❚❚' && auto2.top > auto1.top + 5 && auto1.top > 3,
    '真鼠标点 ▷ 以后，正文自己一截一截往下推',
    'top ' + auto1.top + ' → ' + auto2.top + ' · 按钮=' + (autoOn ? autoOn.btn : '?'));

  // 推到章末：自动进下一章，不弹确认，自动播放不断
  // 先停下、把位置挪到章末、再开（自动播放正在推的那一下会护住自己的目标，手动挪要用正常路径）
  const autoCh0 = auto2.ch;
  await clickAt(autoBtnRect.x, autoBtnRect.y);
  await sleep(300);
  await evaluate(`const st = document.getElementById('stage'); st.scrollTop = Math.max(0, st.scrollHeight - st.clientHeight - 20); return 1;`);
  await sleep(300);
  await clickAt(autoBtnRect.x, autoBtnRect.y);
  await sleep(4400);
  const auto3 = await state();
  const autoStill = await evaluate(`return JSON.stringify({ btn: document.getElementById('btnAuto').textContent,
    on: document.getElementById('btnAuto').classList.contains('on') });`);
  log(auto3.ch !== autoCh0 && !auto3.choice && autoStill && autoStill.btn === '❚❚',
    '自动播放读到章末直接进下一章，不弹「本章完」，也不停',
    autoCh0 + ' → ' + auto3.ch + ' · 按钮=' + (autoStill ? autoStill.btn : '?') + ' · 确认层=' + auto3.choice);

  await clickAt(autoBtnRect.x, autoBtnRect.y);
  await sleep(300);
  const auto4 = await evaluate(`return JSON.stringify({ btn: document.getElementById('btnAuto').textContent,
    on: document.getElementById('btnAuto').classList.contains('on') });`);
  log(auto4 && auto4.btn === '▷' && !auto4.on, '再点一下就停，按钮回到 ▷', '按钮=' + (auto4 ? auto4.btn : '?'));

  fs.writeFileSync(LOG, out.join('\n') + '\n');
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log('\n—— ' + out.length + ' 项，' + fails + ' 项失败 ——');
  ws.close();
  process.exitCode = fails ? 1 : 0;
}

try { await main(); } catch (e) { console.error('出错：', e && e.message); process.exitCode = 1; }
finally { clearTimeout(watchdog); killTree(edge.pid); await sleep(300); process.exit(process.exitCode || 0); }

/* 新功能端到端验证：node tools/interact-test.mjs [端口]
   验证：模块挂载 / 默认离线 / 离线生成 / 分支剧情注入与进入 / 阿泠面板 / 无 JS 报错
   前置：先起 node tools/serve.mjs（同一 PORT） */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9800 + Math.floor(Math.random() * 150);
const WEB = process.argv[2] || process.env.PORT || 8931;
const profile = path.join(os.tmpdir(), 'ziliu-interact-' + Date.now());

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--window-size=1320,920',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

function killTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
}
const watchdog = setTimeout(() => { console.error('超时'); killTree(edge.pid); process.exit(2); }, 120000);

let ws;
let seq = 0;
const pending = new Map();
let errors = 0;
const errorTexts = [];

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => pending.set(id, r));
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) throw new Error((r.exceptionDetails.text || 'eval error') + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
  return r && r.result ? r.result.value : undefined;
}

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  (' + extra + ')' : '')); }
}

async function main() {
  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((x) => x.type === 'page');
      if (target) break;
    } catch (e) { /* not up */ }
    await sleep(200);
  }
  if (!target) throw new Error('连不上 CDP');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      errors++;
      const d = m.params && m.params.exceptionDetails;
      errorTexts.push(d && (d.text || (d.exception && d.exception.description)) || '未知异常');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
      errors++;
      errorTexts.push(m.params.args && m.params.args.map((a) => a.value || a.description || '').join(' ') || 'console.error');
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${WEB}/index.html` });
  await sleep(1600);

  ok('三个新模块挂载到 XR', await evaljs(`!!(window.XR && XR.Stories && XR.Companion && XR.Generator)`));

  // 打开内置示例
  await evaljs(`document.getElementById('btnSample').click()`);
  await sleep(900);
  ok('示例书能打开（离线可跑）', await evaljs(`!document.getElementById('reader').hidden`));

  ok('生成器默认离线（不介入 AI）', (await evaljs(`XR.Store.loadGenerator().backend`)) === 'offline');

  // —— 底色不再被“会动的字”撕开 ——
  const kwCheck = await evaljs(`(function(){
    const k = document.querySelector('.kw');
    if (!k) return { has: false };
    const band = getComputedStyle(k, '::before');
    return {
      has: true,
      display: getComputedStyle(k).display,
      bg: band.backgroundColor,
      pos: band.position,
      innerZg: document.querySelectorAll('.kw .zg').length
    };
  })()`);
  ok('跳词是行内元素、底色画在自己身上', kwCheck.has && kwCheck.display === 'inline' && kwCheck.pos === 'absolute' && /rgba?\(/.test(kwCheck.bg || ''), JSON.stringify(kwCheck));
  ok('跳词里面不再塞会动的字', kwCheck.has && kwCheck.innerZg === 0, 'zg=' + kwCheck.innerZg);

  // —— 字的手感：指针光 / 墨点 / 字浪 ——
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 660, y: 470, buttons: 0 });
  await sleep(160);
  ok('鼠标经过，正文有柔光', await evaljs(`document.body.classList.contains('glow-on')`));
  const waved = await evaljs(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    return document.querySelectorAll('.beat.wave').length;
  })()`);
  ok('按 Z 有字浪扫过', waved >= 1, 'wave=' + waved);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 660, y: 470, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 660, y: 470, button: 'left', clickCount: 1 });
  await sleep(90);
  ok('点正文落一圈墨', (await evaljs(`document.querySelectorAll('.ink-ripple').length`)) >= 1);
  // 点完之后可能弹了卡页 / 回声层：收掉，别影响后面的分支测试
  await evaljs(`(function(){ document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
  await sleep(150);
  ok('动效模块挂到 XR', await evaljs(`!!(window.XR && XR.Motion && typeof XR.Motion.planLine === 'function')`));

  // 离线生成一段番外
  const out = await evaljs(`XR.Generator.generate({title:'测试书', chapter:1, prompt:'雨夜'}, XR.Store.loadGenerator())`);
  ok('离线模板可生成（不联网）', !!out && out.engine === 'offline' && out.text.length > 0, out && out.engine);

  // 添加一条正文分支，插到第 1 章第 2 句后
  const saved = await evaljs(`(async () => {
    const bid = (await XR.Store.listBooks())[0].id;
    const s = XR.Stories.normalizeStory({
      bookId: bid, scope: 'branch', parentChapterIndex: 0, parentIndex: 2,
      title: '测试岔路', text: '岔路里的第一句话。\\n岔路里的第二句话。',
      options: [{ label: '回到主线', goto: 'resume', target: null }]
    });
    await XR.Store.saveStory(s);
    const list = await XR.Store.listStories(bid);
    return list.length;
  })()`);
  ok('分支剧情能落库', saved >= 1, 'stories=' + saved);

  // 回书架再打开（触发 stories 重新加载），验证岔路注入
  console.log('  … 回书架重新打开');
  await evaljs(`document.getElementById('btnBack').click()`);
  await sleep(700);
  await evaljs(`(function(){ const c=document.querySelector('.book-card'); if (c) c.click(); })()`);
  await sleep(900);
  const strips = await evaljs(`document.querySelectorAll('.choice-strip').length`);
  ok('岔路注入到正文（整章模式可见）', strips >= 1, 'strips=' + strips);

  // 点开岔路 → 出现选择
  if (strips >= 1) {
    await evaljs(`document.querySelector('.choice-strip').click()`);
    await sleep(300);
    ok('点岔路弹出选择层', await evaljs(`!document.getElementById('choiceLayer').hidden && document.querySelectorAll('#choiceLayer .choice-opt').length >= 1`));
    // 选第一项（走进岔路）
    await evaljs(`document.querySelector('#choiceLayer .choice-opt').click()`);
    await sleep(500);
    const title = await evaljs(`document.getElementById('chapterTitle').textContent`);
    ok('进入分支后标题显示「番外」', String(title).indexOf('番外') >= 0, title);
  }

  // 阿泠面板
  await evaljs(`document.getElementById('btnCompanion').click()`);
  await sleep(400);
  ok('点阿泠弹出对话面板', await evaljs(`!document.getElementById('companionPanel').hidden && document.querySelectorAll('#companionPanel .cp-opt').length >= 1`));
  const ct = await evaljs(`(document.querySelector('#companionPanel .cp-text')||{}).textContent || ''`);
  ok('阿泠有台词', String(ct).length > 0, ct.slice(0, 24));

  // 关掉面板再检查一遍
  await evaljs(`(function(){ const p=document.getElementById('companionPanel'); if(p) p.click(); })()`);
  await sleep(200);

  // —— 英文书：导入 → 拉丁排版 → 按整词动 ——
  console.log('  … 导入一本英文 txt');
  const en = await evaljs(`(async () => {
    const txt = 'Chapter 1\\n\\nThe rain had stopped before the librarian looked up. He turned a page, and the lantern swayed over the well-known shelves.\\n\\nShe said, "Do not hurry. The night is long."';
    const file = new File([txt], 'english-sample.txt', { type: 'text/plain' });
    const book = await XR.Import.fromFile(file);
    await XR.Store.saveBook(book);
    return { id: book.id, lang: (book.stats && book.stats.lang) || book.lang, chapters: book.chapters.length };
  })()`);
  ok('英文 txt 能直接导入', !!en && en.chapters >= 1 && en.lang === 'latin', JSON.stringify(en));

  if (en && en.id) {
    await send('Page.reload');
    await sleep(1600);
    await evaljs(`(function(){ const c=document.querySelector('.book-card[data-id="${en.id}"]'); if (c) c.click(); })()`);
    await sleep(1100);

    const latin = await evaljs(`(function(){
      const b = document.querySelector('.beat.latin');
      if (!b) return null;
      const s = getComputedStyle(b);
      return { font: s.fontFamily, ls: s.letterSpacing, lh: s.lineHeight };
    })()`);
    ok('英文行换成拉丁排版', !!latin && /Palatino|Georgia|Iowan|Times/.test(latin.font || ''), latin && latin.font);

    const zw = await evaljs(`(function(){
      const zs = [...document.querySelectorAll('.beat.latin .zg')];
      return { n: zs.length, words: zs.map((z) => z.textContent) };
    })()`);
    ok('英文是按整词动（不会切在词中间）', zw.n >= 1 && zw.words.every((w) => w.trim().length > 0 && !/\\s/.test(w.trim())),
      zw.n ? JSON.stringify(zw.words).slice(0, 100) : 'no zg');
    ok('英文书里跳词同样不拆字', (await evaljs(`document.querySelectorAll('.beat.latin .kw .zg').length`)) === 0);
  }

  ok('整场没有 JS 报错', errors === 0, errors ? errorTexts.join(' | ').slice(0, 200) : '0');
}

try {
  await main();
} catch (e) {
  console.error('测试异常：' + (e && e.message ? e.message : e));
  fail++;
} finally {
  clearTimeout(watchdog);
  try { ws && ws.close(); } catch (e) { /* ignore */ }
  killTree(edge.pid);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log('\n—— ' + (pass + fail) + ' 项，' + fail + ' 项失败 ——\n');
process.exit(fail ? 1 : 0);

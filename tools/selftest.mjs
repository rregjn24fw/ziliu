/* 逻辑自检：node tools/selftest.mjs */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;

const Engine = require('../js/engine.js');
const Zip = require('../js/zip.js');
const { CHAPTERS } = require('../js/sample.js');
const Stories = require('../js/stories.js');
const Companion = require('../js/companion.js');
const Generator = require('../js/generator.js');
const Motion = require('../js/motion.js');
const Sync = require('../js/sync.js');
const Tts = require('../js/tts.js');

let pass = 0;
function ok(name, fn) {
  try {
    const r = fn();
    // 异步用例必须用 await okAsync()，否则断言失败会被吞掉
    if (r && typeof r.then === 'function') throw new Error('这是异步用例，请改用 await okAsync()');
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.log('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}

async function okAsync(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

const strip = (s) => String(s).replace(/\s+/g, '');

console.log('\n[1] 断句');
ok('引号内的句号不会被切断', () => {
  const s = Engine.splitSentences('他说：「走吧。」然后转身。');
  assert.deepStrictEqual(s, ['他说：「走吧。」', '然后转身。']);
});
ok('连续叹号算一个句子', () => {
  const s = Engine.splitSentences('不可能！！！你说什么？');
  assert.strictEqual(s.length, 2);
});
ok('超长无标点句子会被逗号切开', () => {
  const long = '他' + '走过长长的街道'.repeat(12) + '，' + '街上没有一个人'.repeat(12) + '。';
  const s = Engine.splitSentences(long);
  assert.ok(s.length >= 2, 'got ' + s.length);
});

console.log('\n[2] 节拍生成');
const chapter = { title: CHAPTERS[0].title, text: CHAPTERS[0].text };
const beats = Engine.buildChapter(chapter, { intensity: 0.75, marks: true });
ok('生成了多个节拍', () => assert.ok(beats.length >= 8, 'beats=' + beats.length));
ok('字号都在 0.78~1.9 之间', () => {
  for (const b of beats) if (b.kind === 'line') assert.ok(b.scale >= 0.78 && b.scale <= 1.9, 'scale ' + b.scale);
});
ok('存在放大的句子', () => assert.ok(beats.some((b) => b.kind === 'line' && b.scale > 1.15)));
ok('存在跳出来的词', () => assert.ok(beats.some((b) => b.marks && b.marks.length)));
ok('正文里不插「这一刻怎么读」这类抉择', () => {
  const bs = Engine.buildChapter(chapter, { intensity: 0.75, marks: true, choices: true });
  assert.ok(!bs.some((b) => b.kind === 'choice'), '还有 choice 节拍');
});
ok('正文一个字都没丢', () => {
  const texts = beats.filter((b) => b.kind === 'line').map((b) => b.text).join('');
  assert.strictEqual(strip(texts), strip(chapter.text));
});
ok('关键词位置能对上原文', () => {
  for (const b of beats) {
    for (const m of b.marks || []) {
      assert.strictEqual(b.text.slice(m.start, m.end), m.word);
    }
  }
});
ok('关掉跳词就不再有 marks', () => {
  const b2 = Engine.buildChapter(chapter, { marks: false });
  assert.ok(b2.every((b) => !b.marks || b.marks.length === 0));
});

console.log('\n[3] 三章都能跑通');
for (let i = 0; i < CHAPTERS.length; i++) {
  const bs = Engine.buildChapter(CHAPTERS[i], { intensity: 0.75, marks: true, choices: true });
  ok('第 ' + (i + 1) + ' 章：' + bs.length + ' 拍', () => {
    assert.ok(bs.length > 3);
    const texts = bs.filter((b) => b.kind === 'line').map((b) => b.text).join('');
    assert.strictEqual(strip(texts), strip(CHAPTERS[i].text));
  });
}

console.log('\n[4] 回声');
ok('能在全书里找到同一个词', () => {
  const book = { chapters: CHAPTERS.map((c) => ({ title: c.title, text: c.text })) };
  const res = Engine.findEcho(book, '雨', 0, '');
  assert.ok(res.count >= 2, 'count=' + res.count);
  assert.ok(res.refs.length >= 1);
});

console.log('\n[5] 图片与阅读模式');
ok('图片标记会变成 image 节拍', () => {
  const bs = Engine.buildChapter(
    { title: 't', text: '第一段。\n\u0001IMG:a/b.png\u0001\n第二段。' },
    { marks: false }
  );
  assert.ok(bs.some((b) => b.kind === 'image' && b.src === 'a/b.png'), JSON.stringify(bs.map((b) => b.kind)));
});
ok('一段一停模式下图片也成节拍', () => {
  const bs = Engine.buildChapter(
    { title: 't', text: '第一段。\n\u0001IMG:x/y.svg\u0001\n第二段。' },
    { marks: false, granularity: 'paragraph' }
  );
  assert.ok(bs.some((b) => b.kind === 'image'));
});
ok('阅读模式大部分句子保持 1.0 字号', () => {
  const bs = Engine.buildChapter(CHAPTERS[0], { restrained: true, marks: false });
  const lines = bs.filter((b) => b.kind === 'line');
  const flat = lines.filter((b) => Math.abs(b.scale - 1) < 0.02).length / Math.max(1, lines.length);
  assert.ok(flat > 0.55, 'flat=' + flat.toFixed(2));
});
ok('三种读法都不插抉择', () => {
  const restrained = Engine.buildChapter(CHAPTERS[0], { restrained: true, marks: true, choices: true });
  const play = Engine.buildChapter(CHAPTERS[0], { restrained: false, marks: true, choices: true });
  assert.ok(!restrained.some((b) => b.kind === 'choice'));
  assert.ok(!play.some((b) => b.kind === 'choice'));
});
ok('阅读模式的跳词比互动模式稀少', () => {
  const a = Engine.buildChapter(CHAPTERS[0], { restrained: true, marks: true });
  const b = Engine.buildChapter(CHAPTERS[0], { restrained: false, marks: true, density: 2 });
  const ca = a.filter((x) => x.marks && x.marks.length).length;
  const cb = b.filter((x) => x.marks && x.marks.length).length;
  assert.ok(ca <= cb, 'read=' + ca + ' play=' + cb);
});

console.log('\n[5b] 每段至少一个跳词');
function markStats(bs) {
  const groups = Engine._internal.paragraphGroups(bs);
  let tot = 0;
  let miss = 0;
  let marks = 0;
  for (const ids of groups) {
    tot++;
    let n = 0;
    for (const i of ids) n += (bs[i].marks || []).length;
    marks += n;
    if (!n) miss++;
  }
  return { tot, miss, marks, groups };
}
function leadOk(bs) {
  const groups = Engine._internal.paragraphGroups(bs);
  for (const ids of groups) {
    const leads = ids.filter((i) => bs[i].lead);
    if (leads.length !== 1) return false;
  }
  return bs.filter((b) => b.lead).length === groups.length;
}
ok('阅读 / 互动、逐句 / 每段：每一段都至少有一个跳词', () => {
  for (const gran of ['sentence', 'paragraph']) {
    for (const restrained of [true, false]) {
      const bs = Engine.buildChapter(CHAPTERS[0], { marks: true, density: 0, granularity: gran, restrained });
      const st = markStats(bs);
      assert.ok(st.tot > 0, gran + ' 没有段');
      assert.strictEqual(st.miss, 0, gran + (restrained ? ' 阅读' : ' 互动') + ' 有 ' + st.miss + ' / ' + st.tot + ' 段没词');
    }
  }
});
ok('每段的第一行被标成 lead（界面靠它保证有字在动）', () => {
  for (const gran of ['sentence', 'paragraph']) {
    const bs = Engine.buildChapter(CHAPTERS[1], { marks: true, granularity: gran });
    assert.ok(leadOk(bs), gran + ' 的 lead 不对');
  }
});
ok('长夜行（216 段）：一段都没漏', () => {
  const text = fs.readFileSync('example/长夜行.txt', 'utf8');
  const bs = Engine.buildChapter({ title: '长夜行', text }, { marks: true, density: 0, restrained: true });
  const st = markStats(bs);
  assert.ok(st.tot >= 200, '段数=' + st.tot);
  assert.strictEqual(st.miss, 0, '有 ' + st.miss + ' / ' + st.tot + ' 段没词');
});
ok('密度越多，长段里的词越多（少 ≤ 中 ≤ 多）', () => {
  const counts = [0, 1, 2].map((d) => markStats(Engine.buildChapter(CHAPTERS[2], {
    marks: true, density: d, rnd: seededRnd(7)
  })).marks);
  assert.ok(counts[0] <= counts[1] && counts[1] <= counts[2], JSON.stringify(counts));
});
ok('兜底轮也只给 2~10 字、不盖满整行', () => {
  const text = fs.readFileSync('example/长夜行.txt', 'utf8');
  const bs = Engine.buildChapter({ title: '长夜行', text }, { marks: true, density: 0, restrained: true });
  for (const b of bs) {
    for (const m of b.marks || []) {
      const n = Array.from(m.word).length;
      assert.ok(n >= 2 && n <= 10, '"' + m.word + '" = ' + n);
      assert.ok(!(m.start === 0 && m.end === b.text.length), '整行被标：' + b.text);
      assert.strictEqual(b.text.slice(m.start, m.end), m.word);
    }
  }
});
ok('单字段落 / 纯标点段不硬造词，也不会崩', () => {
  const bs = Engine.buildChapter({ title: 't', text: '。\n！？…\n字\n这是一段完整的正文，可以挑出词来。' }, { marks: true });
  const lines = bs.filter((b) => b.kind === 'line');
  assert.ok(lines.length >= 2);
  assert.ok(!lines[0].marks.length, '纯标点段被硬标了');
  assert.ok(lines[lines.length - 1].marks.length >= 1, '正文段没有词');
});
ok('关掉跳词时，兜底轮也不会偷偷加回来', () => {
  const text = fs.readFileSync('example/雨停之前.txt', 'utf8');
  const bs = Engine.buildChapter({ title: 't', text }, { marks: false });
  assert.ok(bs.every((b) => !b.marks || b.marks.length === 0));
});

console.log('\n[7] 英文');
ok('英文按句号 / 问号 / 叹号断句', () => {
  const s = Engine.splitSentences('He ran. She fell! Did you see it? Nobody answered.');
  assert.deepStrictEqual(s, ['He ran.', 'She fell!', 'Did you see it?', 'Nobody answered.']);
});
ok('缩写和小数点不切句子', () => {
  const s = Engine.splitSentences('Mr. Smith met Dr. Jones at 3.5 meters. They talked.');
  assert.strictEqual(s.length, 2, JSON.stringify(s));
});
ok('英文台词认得出 dialogue', () => {
  const bs = Engine.buildChapter(
    { title: 't', text: '"You did it," he said.\nI did not do it at all.' },
    { granularity: 'sentence', marks: false }
  );
  assert.ok(bs.some((b) => b.style === 'dialogue'), JSON.stringify(bs.map((b) => b.style)));
  assert.ok(bs.some((b) => b.style === 'narration'));
});
ok('英文全大写的词会被挑出来', () => {
  const bs = Engine.buildChapter(
    { title: 't', text: 'I am not making that up. He yelled ZOO-WEE MAMA at the top of his lungs today.' },
    { marks: true, granularity: 'sentence' }
  );
  const words = bs.reduce((a, b) => a.concat((b.marks || []).map((m) => m.word)), []);
  assert.ok(words.indexOf('ZOO-WEE') >= 0, JSON.stringify(words));
});
ok('挑出来的词不带首尾标点', () => {
  const bs = Engine.buildChapter(
    { title: 't', text: 'She said, "Big Wee Mama!" and then she left the room.' },
    { marks: true, granularity: 'sentence' }
  );
  const words = bs.reduce((a, b) => a.concat((b.marks || []).map((m) => m.word)), []);
  assert.ok(words.length > 0);
  for (const w of words) assert.ok(!/^[\s,.;:!?]/.test(w) && !/[\s,.;:!?]$/.test(w), w);
});
ok('英文阅读模式大部分也是正常字号', () => {
  const en = 'Today my mom gave me a journal and said I should write down what happens. ' +
    'Then my brother broke the window with a baseball, so something happened after all. ' +
    '"You did it," he said. "I did not," I said, which is true. ' +
    'Mom did not believe either of us! That is basically her whole system. ' +
    'I drew a picture of the window instead of writing about my feelings. ' +
    'The picture came out pretty good. It looks like an explosion. That is what it was.';
  const bs = Engine.buildChapter({ title: 't', text: en }, { restrained: true, marks: false });
  const lines = bs.filter((b) => b.kind === 'line');
  const flat = lines.filter((b) => Math.abs(b.scale - 1) < 0.02).length / Math.max(1, lines.length);
  assert.ok(flat > 0.6, 'flat=' + flat.toFixed(2) + ' lines=' + lines.length);
});
ok('英文回声分大小写不敏感', () => {
  const book = { chapters: [
    { title: 'a', text: 'The dog ran quick. Nobody could keep up with him.' },
    { title: 'b', text: 'He was Quick about it, too.' }
  ] };
  const res = Engine.findEcho(book, 'Quick', 0, '');
  assert.ok(res.count >= 2, 'count=' + res.count);
  assert.ok(res.refs.length >= 1);
});

console.log('\n[8] 卡页');
ok('章节里会埋进卡页', () => {
  const bs = Engine.buildChapter({ title: 't', text: CHAPTERS[0].text }, { restrained: true, gateEvery: 6 });
  const g = bs.filter((b) => b.kind === 'gate');
  assert.ok(g.length >= 1, 'gates=' + g.length);
  assert.ok(g[0].variant === 'word' || g[0].variant === 'quote');
  assert.ok(String(g[0].text || g[0].word).length > 0);
});
ok('插了卡页也不丢正文', () => {
  const bs = Engine.buildChapter({ title: 't', text: CHAPTERS[0].text }, { restrained: true, gateEvery: 6 });
  const texts = bs.filter((b) => b.kind === 'line').map((b) => b.text).join('');
  assert.strictEqual(strip(texts), strip(CHAPTERS[0].text));
});
ok('短到放不下的章节不硬塞卡页', () => {
  const bs = Engine.buildChapter({ title: 't', text: '只有一句。' }, { restrained: true, gateEvery: 1 });
  assert.strictEqual(bs.filter((b) => b.kind === 'gate').length, 0);
});

const gateLines = (n, off) => Array.from({ length: n }, (_, i) => ({
  kind: 'line', style: 'narration', text: '他走了很久才回到那间屋子里去看了一眼。' + (i + (off || 0)),
  tone: 'plain', scale: 1, huge: false, marks: [], p: Math.floor(i / 2)
}));

ok('间隔就是“每 N 句一张”，用户自己定', () => {
  const three = Engine.insertGatesEvery(gateLines(10), { every: 3, unit: 'sentence' });
  assert.strictEqual(three.count, 3, 'count=' + three.count);
  assert.strictEqual(three.carry, 1);
  const ten = Engine.insertGatesEvery(gateLines(10), { every: 10, unit: 'sentence' });
  assert.strictEqual(ten.count, 0);         // 第 10 句正好是最后一句：章尾不留卡
  assert.strictEqual(ten.carry, 10);
  const dense = Engine.insertGatesEvery(gateLines(12), { every: 2, unit: 'sentence' });
  assert.strictEqual(dense.count, 5);       // 第 2/4/6/8/10 句后各一张，第 12 句是章尾
});
ok('一章不够 N 句，零头带到下一章', () => {
  const a = Engine.insertGatesEvery(gateLines(5), { every: 9, unit: 'sentence' });
  assert.strictEqual(a.count, 0);
  assert.strictEqual(a.carry, 5);
  const b = Engine.insertGatesEvery(gateLines(5, 100), { every: 9, unit: 'sentence', carry: a.carry });
  assert.strictEqual(b.count, 1, 'count=' + b.count);
  assert.strictEqual(b.carry, 1);
});
ok('按「段」数也能走', () => {
  const bs = gateLines(4);                  // 每两行一段
  const r = Engine.insertGatesEvery(bs, { every: 1, unit: 'paragraph' });
  assert.strictEqual(r.units, 2, 'units=' + r.units);
  assert.strictEqual(r.count, 1);
  const two = Engine.insertGatesEvery(gateLines(6), { every: 2, unit: 'paragraph' });
  assert.strictEqual(two.units, 3);
  assert.strictEqual(two.count, 1);
});
ok('卡片抽“后面要读的那句”还是“刚读过的那句”，自己选', () => {
  const bs = [
    { kind: 'line', style: 'narration', text: '他慢慢走进屋子，什么也没有说。', tone: 'plain', scale: 1, huge: false, marks: [], p: 0 },
    { kind: 'line', style: 'narration', text: '窗外下起雨，屋檐上全是水声。', tone: 'plain', scale: 1, huge: false, marks: [], p: 1 },
    { kind: 'line', style: 'dialogue', text: '“你终于来了，我等了很久。”', tone: 'plain', scale: 1, huge: false, marks: [], p: 2 },
    { kind: 'line', style: 'narration', text: '她没有回头，只是把伞放下。', tone: 'plain', scale: 1, huge: false, marks: [], p: 3 }
  ];
  const ahead = Engine.insertGatesEvery(bs, { every: 2, unit: 'sentence', ahead: true });
  const ga = ahead.beats.filter((b) => b.kind === 'gate')[0];
  const nextLine = ahead.beats[ahead.beats.indexOf(ga) + 1];
  assert.strictEqual(ga.text, nextLine.text, '后文卡');
  const back = Engine.insertGatesEvery(bs, { every: 2, unit: 'sentence', ahead: false });
  const gb = back.beats.filter((b) => b.kind === 'gate')[0];
  const prevLine = back.beats[back.beats.indexOf(gb) - 1];
  assert.strictEqual(gb.text, prevLine.text, '前文卡');
});
ok('按间隔插进去，正文一个字都不少', () => {
  const bs = Engine.buildChapter(chapter, { restrained: true, marks: true });
  const lines = bs.filter((b) => b.kind === 'line').length;
  const r = Engine.insertGatesEvery(bs, { every: 8, unit: 'sentence' });
  assert.ok(r.count >= 1, 'lines=' + lines + ' count=' + r.count);
  const texts = r.beats.filter((b) => b.kind === 'line').map((b) => b.text).join('');
  assert.strictEqual(strip(texts), strip(chapter.text));
});

console.log('\n[8b] 文字条（2~10 个字）');
const SPAN_TEXT = '雨水顺着伞骨落在地砖上。雨水一滴一滴落下来，声音很奇怪。雨水的味道也很奇怪。';
function seededRnd(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function spanBeats(seed) {
  return Engine.buildChapter({ title: 't', text: SPAN_TEXT }, {
    marks: true, density: 2, rnd: seededRnd(seed)
  }).filter((b) => b.kind === 'line');
}
ok('跳出来的词长度都在 2~10 字', () => {
  const words = [];
  for (const seed of [1, 7, 99, 1234]) {
    for (const b of spanBeats(seed)) for (const m of b.marks || []) words.push(m.word);
  }
  assert.ok(words.length >= 2, 'words=' + words.length);
  for (const w of words) {
    const n = Array.from(w).length;
    assert.ok(n >= 2 && n <= 10, '"' + w + '" = ' + n + ' 字');
  }
});
ok('跳出来的词不带首尾标点', () => {
  for (const seed of [3, 21, 55]) {
    for (const b of spanBeats(seed)) {
      for (const m of b.marks || []) assert.ok(!/^[\s，。！？；：、…—～·"'“”‘’「」『』（）()]/.test(m.word) &&
        !/[\s，。！？；：、…—～·"'“”‘’「」『』（）()]$/.test(m.word), m.word);
    }
  }
});
ok('跳出来的词不会盖满整行', () => {
  for (const seed of [5, 44, 123]) {
    for (const b of spanBeats(seed)) {
      for (const m of b.marks || []) {
        assert.ok(!(m.start === 0 && m.end === b.text.length), '"' + b.text + '" 整行被标了');
      }
    }
  }
});
ok('名字不被拆开：马尔福家 四个字一起跳', () => {
  const t = '哈利看见马尔福家的人走了进来。';
  const at = t.indexOf('家');
  const sp = Engine.expandSpan(t, { start: at, end: at + 1, word: '家' }, () => 0);
  assert.ok(sp.word.indexOf('马尔福家') >= 0, '拿到的是 "' + sp.word + '"');
  const sp2 = Engine.expandSpan(t, { start: t.indexOf('马'), end: t.indexOf('马') + 1, word: '马' }, () => 0.99);
  assert.ok(sp2.word.indexOf('马尔福家') >= 0, '拿到的是 "' + sp2.word + '"');
});
ok('长块里切出来的长度是随机的', () => {
  const t = '哈利看见马尔福家的人走了进来。';
  const at = t.indexOf('家');
  const lens = [0, 0.3, 0.7, 0.99].map((r) => Array.from(Engine.expandSpan(t, { start: at, end: at + 1, word: '家' }, () => r).word).length);
  assert.ok(new Set(lens).size >= 2, '长度=' + lens.join('/'));
});
ok('回声键会往更短的核心词退', () => {
  const keys = Engine.echoKeys('马尔福家');
  assert.strictEqual(keys[0], '马尔福家');
  assert.ok(keys.indexOf('马尔福') >= 0, JSON.stringify(keys));
  assert.ok(keys.indexOf('马尔') >= 0, JSON.stringify(keys));
  for (const k of keys) assert.ok(Array.from(k).length >= 2 && Array.from(k).length <= 4, k);
});

console.log('\n[8c] 正则 / 全文搜索');
const SBOOK = [
  { title: '一', text: '雨下到半夜。他说雨停了。' },
  { title: '二', text: '第二天下雨，马尔福家的人来了。' }
];
ok('普通关键词能搜全书', () => {
  const r = Engine.searchBook(SBOOK, '雨');
  assert.strictEqual(r.count, 3, 'count=' + r.count);
  assert.strictEqual(r.hits[0].ch, 0);
  assert.strictEqual(r.hits[2].ch, 1);
});
ok('正则能搜', () => {
  const r = Engine.searchBook(SBOOK, '雨.{0,2}停', { regex: true });
  assert.strictEqual(r.count, 1, 'count=' + r.count);
  assert.strictEqual(r.hits[0].text, '雨停');
});
ok('普通模式把正则符号当字面量', () => {
  assert.strictEqual(Engine.searchBook(SBOOK, '雨.').count, 0);
  assert.strictEqual(Engine.searchBook(SBOOK, '雨.', { regex: true }).count, 3);
});
ok('正则写错会报错而不是崩', () => {
  const r = Engine.searchBook(SBOOK, '[', { regex: true });
  assert.ok(r.error, '没有报错');
  assert.strictEqual(r.count, 0);
});
ok('零宽正则不会死循环', () => {
  assert.strictEqual(Engine.searchBook(SBOOK, 'a*').count, 0);
  assert.strictEqual(Engine.searchBook(SBOOK, '^', { regex: true }).count, 0);
});
ok('命中上限会标出来', () => {
  const r = Engine.searchBook(SBOOK, '雨', { max: 2 });
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.capped, true);
});
ok('命中带前后文摘要', () => {
  const r = Engine.searchBook(SBOOK, '马尔福家');
  assert.strictEqual(r.count, 1);
  assert.ok(r.hits[0].after.indexOf('人') >= 0, JSON.stringify(r.hits[0]));
});
ok('搜索跳过图片占位符', () => {
  const r = Engine.searchBook([{ title: 'x', text: '前一句。\u0001IMG:a.png\u0001后一句。' }], 'IMG');
  assert.strictEqual(r.count, 0);
});

console.log('\n[8d] 正则美化规则');
ok('普通正则默认不分大小写，/…/g 按自己写的开关', () => {
  const a = Engine.parseRulePat('他说');
  assert.strictEqual(a.src, '他说');
  assert.strictEqual(a.flags, 'gi');
  const b = Engine.parseRulePat('/He said/g');
  assert.strictEqual(b.src, 'He said');
  assert.strictEqual(b.flags, 'g');
});
ok('非法正则不生效，并给出中文原因', () => {
  const c = Engine.compileRules([{ pat: '[', action: 'hi' }]);
  assert.strictEqual(c.rules.length, 0);
  assert.ok(/正则/.test(c.errors[0].msg), JSON.stringify(c.errors));
});
ok('嵌套量词会被拦下来', () => {
  assert.ok(Engine.riskyRe('(a+)+').length > 0);
  assert.strictEqual(Engine.riskyRe('雨.{0,2}停'), '');
  const c = Engine.compileRules([{ pat: '(a+)+', action: 'hi' }]);
  assert.strictEqual(c.rules.length, 0);
});
ok('样式命中的范围对得上，重叠时先声明的赢', () => {
  const c = Engine.compileRules([
    { pat: '他说', action: 'hi' },
    { pat: '他', action: 'glow' }
  ]);
  const p = Engine.prepareLine('他说。他又说。', [], null, c.rules);
  assert.strictEqual(p.spans.length, 2);
  assert.strictEqual(p.spans[0].start, 0);
  assert.strictEqual(p.spans[0].end, 2);
  assert.strictEqual(p.spans[0].style, 'hi');
  assert.deepStrictEqual(p.styleAt.slice(0, 3), ['hi', 'hi', '']);
});
ok('替换只改显示，$1 与空替换都能用', () => {
  const c = Engine.compileRules([
    { pat: '他说', action: 'replace', repl: '他轻声说' },
    { pat: '，', action: 'replace', repl: '' }
  ]);
  const p = Engine.prepareLine('他说，雨停了。', [], null, c.rules);
  assert.strictEqual(p.text, '他轻声说雨停了。');
  assert.strictEqual(p.styleAt.length, p.text.length);
});
ok('跳词与搜索高亮会跟到替换后的位置', () => {
  const c = Engine.compileRules([{ pat: '一下', action: 'replace', repl: '一下子' }]);
  const p = Engine.prepareLine('他顿了一下。', [{ start: 3, end: 5, word: '一下' }], { start: 3, end: 5 }, c.rules);
  assert.strictEqual(p.marks[0].start, 3);
  assert.strictEqual(p.marks[0].word, '一下');
  assert.strictEqual(p.hit.start, 3);
  assert.strictEqual(p.text.slice(p.marks[0].start, p.marks[0].end), '一下');
});
ok('词被替换掉就放弃那一个跳词', () => {
  const c = Engine.compileRules([{ pat: '一下', action: 'replace', repl: '两下' }]);
  const p = Engine.prepareLine('他顿了一下。', [{ start: 3, end: 5, word: '一下' }], { start: 3, end: 5 }, c.rules);
  assert.strictEqual(p.marks.length, 0);
  assert.strictEqual(p.hit, null);
});
ok('零宽正则不会死循环', () => {
  const c = Engine.compileRules([{ pat: '^', action: 'hi' }]);
  const p = Engine.prepareLine('雨停了。', [], null, c.rules);
  assert.ok(p.spans.length <= 1);
});
ok('试跑能报命中数、前后文和替换结果', () => {
  const r = Engine.rulePreview({ pat: '雨', action: 'hi' }, '雨夜，雨停了。');
  assert.strictEqual(r.error, '');
  assert.strictEqual(r.hits, 2);
  assert.strictEqual(r.match, '雨');
  const r2 = Engine.rulePreview({ pat: '雨', action: 'replace', repl: '⛆' }, '雨夜');
  assert.strictEqual(r2.result, '⛆');
  const r3 = Engine.rulePreview({ pat: '[', action: 'hi' }, '雨夜');
  assert.ok(r3.error.length > 0);
});
ok('规则最多 16 条', () => {
  const many = [];
  for (let i = 0; i < 20; i++) many.push({ pat: '雨' + i, action: 'hi' });
  const c = Engine.compileRules(many);
  assert.strictEqual(c.rules.length, 16);
});

console.log('\n[9] 词义动作');
ok('中文动作词能认出来', () => {
  assert.strictEqual(Engine.verbFor('跑'), 'run');
  assert.strictEqual(Engine.verbFor('后颈发凉'), 'cold');
  assert.strictEqual(Engine.verbFor('大笑'), 'laugh');
  assert.strictEqual(Engine.verbFor('发抖'), 'shiver');
});
ok('英文动作词（含变形）也能认出来', () => {
  assert.strictEqual(Engine.verbFor('jumped'), 'jump');
  assert.strictEqual(Engine.verbFor('Shook'), 'shiver');
  assert.strictEqual(Engine.verbFor('"cried"'), 'cry');
});
ok('不是动作词就不给动作', () => {
  assert.strictEqual(Engine.verbFor('猫'), '');
  assert.strictEqual(Engine.verbFor('window'), '');
  assert.strictEqual(Engine.verbFor(''), '');
});

console.log('\n[6] EPUB 解包');const epubPath = path.resolve('example/雨停之前.epub');
if (fs.existsSync(epubPath)) {
  const buf = fs.readFileSync(epubPath);
  const zip = await Zip.open(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  ok('mimetype 存在', () => assert.ok(zip.has('mimetype')));
  ok('container.xml 存在', () => assert.ok(zip.has('META-INF/container.xml')));
  const ch1 = await zip.text('OEBPS/text/ch1.xhtml');
  ok('解压出章节正文', () => assert.ok(ch1.includes('便利店')));
  const opf = await zip.text('OEBPS/content.opf');
  ok('OPF 里有标题', () => assert.ok(opf.includes('雨停之前')));
} else {
  console.log('  ! 没找到 example/雨停之前.epub，先跑 make-example-epub');
}

console.log('\n[10] 分支剧情');
ok('attachChoices 在指定位置插入选择节拍', () => {
  const bs = [{ kind: 'line', text: 'a' }, { kind: 'line', text: 'b' }];
  const out = Stories.attachChoices(bs, [{ index: 0, storyId: 's1', options: [{ label: '进入', goto: 'story', target: 's1' }] }]);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[1].kind, 'choice');
  assert.strictEqual(out[1].storyId, 's1');
  assert.strictEqual(out[1].options[0].goto, 'story');
});
ok('attachChoices 不改入参', () => {
  const bs = [{ kind: 'line', text: 'a' }, { kind: 'line', text: 'b' }];
  Stories.attachChoices(bs, [{ index: 1, storyId: 's1', options: [] }]);
  assert.strictEqual(bs.length, 2);
});
ok('normalizeStory 补默认字段', () => {
  const st = Stories.normalizeStory({ scope: 'branch', title: 'x' });
  assert.strictEqual(st.scope, 'branch');
  assert.strictEqual(st.schemaVer, 1);
  assert.ok(st.id, '缺 id');
  assert.strictEqual(st.engine, 'offline');
  assert.ok(Array.isArray(st.options));
});
ok('hooksForChapter 只收集本章 branch', () => {
  const list = [
    { id: 'a', scope: 'branch', parentChapterIndex: 1, parentIndex: 2, title: '甲' },
    { id: 'b', scope: 'branch', parentChapterIndex: 2, parentIndex: 0, title: '乙' },
    { id: 'c', scope: 'extra', title: '丙' }
  ];
  const hs = Stories.hooksForChapter(list, 1);
  assert.strictEqual(hs.length, 1);
  assert.strictEqual(hs[0].storyId, 'a');
  assert.strictEqual(hs[0].options.length, 2);
});

console.log('\n[11] 守卷人阿泠');
ok('pick 对固定随机数确定', () => {
  const cs = Companion.defaultState();
  const r1 = Companion.pick('add-book', cs, { title: '雨停之前', chapters: 3 }, () => 0);
  const r2 = Companion.pick('add-book', cs, { title: '雨停之前', chapters: 3 }, () => 0);
  assert.strictEqual(r1.text, r2.text);
  assert.ok(r1.text.includes('雨停之前'));
});
ok('pick 不改入参状态', () => {
  const cs = Companion.defaultState();
  Companion.pick('add-book', cs, { title: '书' }, () => 0);
  assert.strictEqual(cs.flags['add-book'], undefined);
  assert.strictEqual(cs.history.length, 0);
});
ok('applyDelta 推进去重标记，下一次换一句', () => {
  const cs = Companion.defaultState();
  const r1 = Companion.pick('add-book', cs, {}, () => 0);
  const cs2 = Companion.applyDelta(cs, r1);
  assert.ok(cs2.flags['add-book'].count >= 1);
  const r3 = Companion.pick('add-book', cs2, {}, () => 0);
  assert.notStrictEqual(r3.text, r1.text);
});
ok('变量替换生效', () => {
  const r = Companion.pick('goal-pct', Companion.defaultState(), { pct: 50 }, () => 0);
  assert.ok(r.text.includes('50'));
});
ok('chat 给出分支选项', () => {
  const c = Companion.chat('书', Companion.defaultState(), () => 0);
  assert.ok(c.options.length >= 2);
  assert.ok(c.text.length > 0);
});

console.log('\n[12] 剧情生成器');
ok('offline 对固定随机数确定', () => {
  const g1 = Generator.offline({ title: '书', prompt: '' }, () => 0.5);
  const g2 = Generator.offline({ title: '书', prompt: '' }, () => 0.5);
  assert.strictEqual(g1.text, g2.text);
  assert.strictEqual(g1.engine, 'offline');
  assert.ok(g1.text.length > 0);
});
ok('buildLLMPayload 结构正确', () => {
  const pl = Generator.buildLLMPayload(
    { title: 'x', chapter: 2, prompt: 'p' },
    { backend: 'llm', llm: { baseURL: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'm' } }
  );
  assert.strictEqual(pl.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.strictEqual(pl.headers.Authorization, 'Bearer k');
  assert.strictEqual(pl.body.model, 'm');
  assert.ok(Array.isArray(pl.body.messages));
});
ok('本地模型不带 Authorization', () => {
  const pl = Generator.buildLLMPayload(
    { title: 'x' },
    { backend: 'local', local: { baseURL: 'http://localhost:11434/v1', model: 'llama3' } }
  );
  assert.ok(!pl.headers.Authorization);
  assert.strictEqual(pl.url, 'http://localhost:11434/v1/chat/completions');
});
ok('parseLLMResult 能剥掉代码围栏', () => {
  const r = Generator.parseLLMResult('```json\n{"title":"甲","text":"正文","options":[{"label":"回","goto":"resume"}]}\n```', 'llm');
  assert.strictEqual(r.title, '甲');
  assert.strictEqual(r.text, '正文');
  assert.strictEqual(r.options.length, 1);
  assert.strictEqual(r.engine, 'llm');
});

console.log('\n[13] 字的手感（英文按词动 / 底色不错位）');
ok('英文与中文能被分开', () => {
  assert.strictEqual(Motion.isLatinText('It was a quiet morning in the library.'), true);
  assert.strictEqual(Motion.isLatinText('那天早上，图书馆里很安静。'), false);
});
ok('英文词边界：缩写与连字符算一个词', () => {
  const ws = Motion.wordRanges("Don't well-known it's 42");
  assert.deepStrictEqual(ws.map((w) => "Don't well-known it's 42".slice(w.s, w.e)),
    ["Don't", 'well-known', "it's", '42']);
});
ok('英文动点覆盖整词，不会切在词中间', () => {
  const text = 'The rain had stopped before the librarian looked up.';
  const plan = Motion.planLine(text, { level: 2, lead: true, seed: (n) => (n * 0.37) % 1 });
  const keys = Object.keys(plan);
  assert.ok(keys.length >= 1, '至少一个动点');
  const words = Motion.wordRanges(text).map((w) => text.slice(w.s, w.e));
  for (const k of keys) {
    const z = plan[k];
    const got = text.slice(+k, z.end);
    assert.ok(words.indexOf(got) >= 0, '动点必须是一个完整单词，got=' + got);
    assert.strictEqual(z.m, z.m.toLowerCase());
  }
});
ok('中文动点仍然是一字一个', () => {
  const text = '雨停在窗沿上，他把书翻到下一页。';
  const plan = Motion.planLine(text, { level: 2, lead: true, seed: (n) => (n * 0.41) % 1 });
  const keys = Object.keys(plan);
  assert.ok(keys.length >= 1);
  keys.forEach((k) => assert.strictEqual(plan[k].end, +k + 1));
});
ok('跳词 / 高亮范围内不放动点（底色不会被字带歪）', () => {
  const text = '他把那本旧书轻轻合上。';
  const plan = Motion.planLine(text, { level: 2, lead: true, seed: () => 0.5, blocked: [[3, 5]] });
  Object.keys(plan).forEach((k) => {
    assert.ok(!(+k < 5 && plan[k].end > 3), '动点与高亮重叠了：' + k);
  });
});
ok('planLine 同一随机源结果一致', () => {
  const text = 'The lantern swayed, and the pages turned by themselves.';
  const a = Motion.planLine(text, { level: 2, lead: false, seed: (n) => (n * 0.23) % 1 });
  const b = Motion.planLine(text, { level: 2, lead: false, seed: (n) => (n * 0.23) % 1 });
  assert.deepStrictEqual(a, b);
});
ok('关掉拟人动作就没有动点', () => {
  assert.deepStrictEqual(Motion.planLine('他走了。', { level: 0 }), {});
});
ok('同一个词永远挑同一种小动作', () => {
  assert.strictEqual(Motion.pickWordMove('雨', 0.1), Motion.pickWordMove('雨', 0.1));
  assert.strictEqual(Motion.pickWordMove('雨', 0.99), '');
});

ok('英文句子重新拼起来时不会粘在一起', () => {
  const beats = Engine.buildChapter(
    { text: 'She said, "Do not hurry. The night is long."' },
    { granularity: 'sentence' }
  );
  const all = beats.map((b) => b.text).join(' ');
  assert.ok(all.indexOf('hurry.The') < 0, all);
  assert.ok(/hurry\.\s+The/.test(all), all);
});
ok('中文句子拼回去不会凭空多空格', () => {
  const beats = Engine.buildChapter({ text: '他走了。她没有回头。' }, { granularity: 'sentence' });
  assert.ok(beats.map((b) => b.text).join('').indexOf('他走了。她没有回头。') >= 0);
});


console.log('\n[14] 云同步与朗读（纯函数）');
ok('同步文件路径可预测', () => {
  assert.strictEqual(Sync.pathFor({ dir: 'ziliu-sync' }, 'books'), 'ziliu-sync/books.json');
  assert.strictEqual(Sync.pathFor({ dir: '/data/' }, 'notes'), 'data/notes.json');
  assert.strictEqual(Sync.pathFor({}, 'progress'), 'data/progress.json');
});
ok('base64 往返中文不出错', () => {
  const s = '雨停之前 · line one\n第二行';
  assert.strictEqual(Sync.fromB64(Sync.toB64(s)), s);
});
ok('冲突按 updatedAt 取新', () => {
  const local = [{ id: 'a', title: '旧', updatedAt: 100 }];
  const remote = [{ id: 'a', title: '新', updatedAt: 200 }];
  const m = Sync.mergeItems('books', local, remote);
  assert.strictEqual(m.items.length, 1);
  assert.strictEqual(m.items[0].title, '新');
});
ok('时间戳相同：墓碑（删除）优先', () => {
  const local = [{ id: 'a', updatedAt: 100 }];
  const remote = [{ id: 'a', updatedAt: 100, deleted: true }];
  assert.strictEqual(Sync.mergeItems('books', local, remote).items[0].deleted, true);
});
ok('进度按 bookId 合并，不按 id', () => {
  const local = [{ bookId: 'b1', index: 3, updatedAt: 50 }];
  const remote = [{ bookId: 'b1', index: 9, updatedAt: 80 }];
  const m = Sync.mergeItems('progress', local, remote);
  assert.strictEqual(m.items.length, 1);
  assert.strictEqual(m.items[0].index, 9);
});
ok('合并结果和本地一样时不白推一次', () => {
  const local = [{ id: 'a', title: '同', updatedAt: 100 }];
  const remote = [{ id: 'a', title: '同', updatedAt: 90 }];
  assert.strictEqual(Sync.mergeItems('books', local, remote).changed, false);
});
ok('坏掉的云端文件不会炸', () => {
  assert.deepStrictEqual(Sync.parsePayload('books', '{oops'), []);
  assert.deepStrictEqual(Sync.parsePayload('books', '{"items":[]}'), []);
});
ok('朗读文本清理与切块', () => {
  assert.strictEqual(Tts.normalize('  a\u0001x\u0001b  '), 'ab');
  const raw = ('第一句。第二句，很长很长的一段话，').repeat(6);
  const parts = Tts.chunk(raw, 60);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((p) => p.length <= 60), parts.map((p) => p.length).join(','));
  assert.ok(parts.join('').replace(/\s/g, '').length >= raw.replace(/\s/g, '').length - 2);
});
ok('音色选择：优先 voiceURI，其次语言', () => {
  const list = [{ name: 'A', lang: 'en-US', voiceURI: 'a' }, { name: 'B', lang: 'zh-CN', voiceURI: 'b' }];
  assert.strictEqual(Tts.pickVoice(list, 'b').name, 'B');
  assert.strictEqual(Tts.pickVoice(list, '', 'zh-CN').name, 'B');
  assert.strictEqual(Tts.pickVoice([], ''), null);
});


console.log('\n[15] 同步编排（假 GitHub，不联网）');
await okAsync('一次同步 = 拉取远端新进度 + 推送本地书签', async () => {
  const files = new Map();
  let shaN = 0;
  const realFetch = globalThis.fetch;
  const realStore = globalThis.XR.Store;
  const remoteProgress = [{ bookId: 'b1', index: 42, updatedAt: 2000 }];
  files.set('data/progress.json', JSON.stringify({ app: 'ziliu-sync', kind: 'progress', items: remoteProgress }));
  const localBookmarks = [{ id: 'k1', bookId: 'b1', chapterIndex: 0, index: 1, updatedAt: 1500 }];
  const applied = {};
  const state = { deviceId: 'dev-test', shas: {}, dirty: { bookmarks: 1 }, lastPushAt: 0, lastPullAt: 0, lastError: '' };

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'PUT') {
      const path = u.split('/contents/')[1];
      const body = JSON.parse(opts.body);
      files.set(decodeURIComponent(path), Buffer.from(body.content, 'base64').toString('utf8'));
      return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha' + (++shaN) } }) };
    }
    // probeAccess 先探一次仓库：GET /repos/u/r
    if (u.indexOf('/contents/') === -1 && /\/repos\/u\/r(\?|$)/.test(u)) {
      return { ok: true, status: 200, json: async () => ({ full_name: 'u/r', private: true, permissions: {} }) };
    }
    const path = decodeURIComponent(u.split('/contents/')[1] || '').split('?')[0];
    if (files.has(path)) {
      return { ok: true, status: 200, json: async () => ({ type: 'file', sha: 'sha-old', content: Buffer.from(files.get(path), 'utf8').toString('base64') }) };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
  };
  globalThis.XR.Store = {
    getSyncState: async () => JSON.parse(JSON.stringify(state)),
    saveSyncState: async (patch) => { Object.assign(state, patch); if (patch.clearDirty) for (const k of [].concat(patch.clearDirty)) delete state.dirty[k]; return state; },
    syncSnapshot: async () => ({ books: [], progress: [], bookmarks: localBookmarks, notes: [], stories: [], companion: null, settings: {} }),
    applyRemote: async (kind, items) => { applied[kind] = items; return items.length; },
    loadSettings: () => ({}),
    getFlag: () => 0,
    getCompanion: async () => null,
    getBookContent: async () => null,
    applyBookContent: async () => 0
  };
  try {
    const cfg = { enabled: true, owner: 'u', repo: 'r', branch: 'main', dir: 'data', token: 't', content: false, auto: false };
    const sum = await Sync.syncNow(cfg, {});
    assert.deepStrictEqual(applied.progress, remoteProgress, '远端进度应被应用');
    assert.ok(files.has('data/bookmarks.json'), '本地书签应被推到云端');
    assert.strictEqual(JSON.parse(files.get('data/bookmarks.json')).items[0].id, 'k1');
    assert.ok(sum.errors.length === 0, sum.errors.join('|'));
    assert.ok(sum.pushed >= 1);
    assert.ok(state.shas['data/bookmarks.json'], '应记住新 sha');
    assert.deepStrictEqual(state.dirty, {}, '推送完应清掉脏标记');

    // 第二次：没有任何变化，不应该再推送
    const before = shaN;
    const sum2 = await Sync.syncNow(cfg, {});
    assert.strictEqual(shaN, before, '无变化时不应再写云端');
    assert.strictEqual(sum2.pushed, 0);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.XR.Store = realStore;
  }
});

console.log('\n通过 ' + pass + ' 项' + (process.exitCode ? '，但有失败' : '，全部正常') + '\n');

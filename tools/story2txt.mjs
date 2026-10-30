#!/usr/bin/env node
/* ============================================================
   story2txt.mjs — 把 Story-to-Game 的 JSON 剧本转成字流能直接导入的 txt
   · 主线模式（默认）：从 startNodeId 走一条完整故事线，读起来像小说
   · 全剧本模式：按章节把所有节点展开，分支用「另一种可能」并列，适合通读全貌
   用法：
     node tools/story2txt.mjs <剧本.json> [--out example/xxx.txt] [--mode main|full]
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

/* ---------------- 条件求值（剧本的 condition 语法） ---------------- */
function varOf(state, name) {
  if (name === 'val') return Number(state.val) || 0;
  return state.vars[name];
}

function parseAtom(expr, state) {
  const e = String(expr || '').trim();
  if (!e) return true;
  if (e === 'default') return true;
  // hasFlag 'x' / !hasFlag 'x'
  let m = /^(!)?\s*hasFlag\s+['"]?([^'"]+)['"]?$/.exec(e);
  if (m) {
    const has = state.flags.has(m[2].trim());
    return m[1] ? !has : has;
  }
  // val >= 60 / trust == 'true' / route != 'x'
  m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(.+)$/.exec(e);
  if (m) {
    const left = varOf(state, m[1]);
    let right = m[3].trim().replace(/^['"]|['"]$/g, '');
    const rn = Number(right);
    const isNum = right !== '' && !Number.isNaN(rn);
    const L = isNum ? Number(left) || 0 : String(left);
    const R = isNum ? rn : right;
    switch (m[2]) {
      case '>=': return L >= R;
      case '<=': return L <= R;
      case '>': return L > R;
      case '<': return L < R;
      case '==': return L === R;
      case '!=': return L !== R;
    }
  }
  return true;
}

function evalCondition(cond, state) {
  if (cond == null) return true;
  if (typeof cond === 'string') {
    // 简单支持 && / ||（剧本里少见，防一手）
    const parts = cond.split('&&').map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) return parts.every((p) => parseAtom(p, state));
    return parseAtom(cond, state);
  }
  if (typeof cond === 'object') {
    if (Array.isArray(cond.all)) return cond.all.every((c) => evalCondition(c, state));
    if (Array.isArray(cond.any)) return cond.any.some((c) => evalCondition(c, state));
    if (cond.not) return !evalCondition(cond.not, state);
    if (cond.flag) return state.flags.has(String(cond.flag));
    if (cond.var) {
      const L = varOf(state, cond.var);
      const R = cond.value;
      switch (cond.op) {
        case '>=': return L >= R;
        case '<=': return L <= R;
        case '>': return L > R;
        case '<': return L < R;
        case '==': return L === R;
        case '!=': return L !== R;
      }
    }
  }
  return true;
}

/* ---------------- 状态推进 ---------------- */
function initState(doc) {
  const meta = doc.meta || {};
  return {
    val: Number(meta.initialVariable) || 0,
    vars: Object.assign({}, doc.variables || {}),
    flags: new Set(),
    achievements: new Set()
  };
}

function addFlags(state, v, important) {
  if (!v) return;
  const list = Array.isArray(v) ? v : [v];
  for (const f of list) {
    const id = typeof f === 'object' && f ? f.id : f;
    if (id) state.flags.add(String(id));
  }
  if (important) state.important = (state.important || []).concat(list.map((f) => (typeof f === 'object' && f ? f.label || f.id : f)));
}

function applyChanges(ch, state, doc) {
  if (!ch || typeof ch !== 'object') return [];
  const notes = [];
  if (typeof ch.val === 'number') {
    state.val = Math.max(0, Math.min(100, (Number(state.val) || 0) + ch.val));
  }
  if (typeof ch.valSet === 'number') {
    state.val = Math.max(0, Math.min(100, ch.valSet));
  }
  if (ch.set && typeof ch.set === 'object') {
    for (const [k, v] of Object.entries(ch.set)) state.vars[k] = v;
  }
  addFlags(state, ch.addFlag, ch.important === true);
  addFlags(state, ch.addFlags, ch.important === true);
  const imp = ch.importantFlag != null ? ch.importantFlag : ch.importantFlags;
  addFlags(state, imp, true);
  if (ch.removeFlag) state.flags.delete(String(ch.removeFlag));
  const ach = [];
  if (ch.unlockAchievement) ach.push(ch.unlockAchievement);
  if (Array.isArray(ch.unlockAchievements)) ach.push(...ch.unlockAchievements);
  for (const a of ach) state.achievements.add(String(a));
  return notes;
}

/* ---------------- 选项排序：主线尽量走到真结局 ---------------- */
function scoreChoice(c, doc) {
  const n = doc.nodes[c.next];
  if (!n) return -1;
  if (!n.isEnding) return 2;
  const t = String(n.type || '');
  if (/TRUE/i.test(t)) return 4;
  if (/NORMAL/i.test(t)) return 3;
  if (/HIDDEN|SPECIAL/i.test(t)) return 1;
  return 0; // RASH / BAD
}

/* ---------------- 主线 ---------------- */
function walkMain(doc, opts) {
  const state = initState(doc);
  const lines = [];
  const seen = new Set();
  const seenChapters = new Set();
  let id = doc.startNodeId;
  let lastScene = '';
  let lastTitle = '';
  let steps = 0;

  const blank = () => {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  };

  while (id && steps++ < 3000) {
    const node = doc.nodes[id];
    if (!node) {
      lines.push('（剧本引用了一个不存在的节点：' + id + '）');
      break;
    }
    if (seen.has(id)) {
      blank();
      lines.push('（这里与前面的情节汇合：' + (node.title || id) + '）');
      if (!node.isEnding) {
        // 汇合后继续沿 next / routes 走，避免卡住
        const nxt = pickNext(node, state, doc);
        if (nxt && !seen.has(nxt)) { id = nxt; continue; }
      }
      break;
    }
    seen.add(id);

    if (node.chapterTitle && !seenChapters.has(node.chapterTitle)) {
      seenChapters.add(node.chapterTitle);
      blank();
      lines.push(node.chapterTitle);
      lines.push('');
    }

    const sc = node.scene;
    const scName = typeof sc === 'string' ? sc : (sc && sc.name);
    if (scName && scName !== lastScene) {
      lastScene = scName;
      blank();
      lines.push('〔' + scName + '〕');
      lines.push('');
    }
    if (node.title && node.title !== lastTitle && !node.isEnding && node.title !== scName) {
      lastTitle = node.title;
    }

    for (const s of (node.segments || [])) {
      const text = String(s.text || '').trim();
      if (!text) continue;
      blank();
      if (s.speaker && !/^(系统|system|旁白|narrator)$/i.test(s.speaker)) {
        lines.push(s.speaker + '：“' + text + '”');
      } else {
        lines.push(text);
      }
    }

    if (node.isEnding) {
      blank();
      if (node.title) { lines.push('结局：' + node.title); lines.push(''); }
      if (node.description) { lines.push(String(node.description).trim()); lines.push(''); }
      if (node.closing) { lines.push(String(node.closing).trim()); lines.push(''); }
      if (node.achievement) state.achievements.add(node.achievement);
      break;
    }

    const choices = (node.choices || []).filter((c) => evalCondition(c.condition, state));
    if (choices.length) {
      const sorted = choices.slice().sort((a, b) => scoreChoice(b, doc) - scoreChoice(a, doc));
      const pick = sorted[0];
      blank();
      lines.push('▸ 你选了：' + String(pick.text || '').trim());
      applyChanges(pick.changes, state, doc);
      id = pick.next;
      continue;
    }

    const nxt = pickNext(node, state, doc);
    if (!nxt) {
      blank();
      lines.push('（这一段没有后续了）');
      break;
    }
    id = nxt;
  }

  if (state.achievements.size) {
    const names = [...state.achievements].map((id) => {
      const a = (doc.achievements || {})[id];
      return a && a.title ? a.title : id;
    });
    blank();
    lines.push('〔这一路的印记：' + names.join('、') + '〕');
  }
  return lines;
}

function pickNext(node, state, doc) {
  if (Array.isArray(node.routes) && node.routes.length) {
    for (const r of node.routes) {
      if (evalCondition(r.condition, state)) return r.next;
    }
  }
  return node.next || '';
}

/* ---------------- 全剧本（按章节并列展开） ---------------- */
function walkFull(doc) {
  const lines = [];
  const order = Object.keys(doc.nodes);
  const byChapter = new Map();
  let curChapter = '';
  for (const id of order) {
    const n = doc.nodes[id];
    // 剧本只在「章节入口」节点写 chapterTitle，后面的节点继承当前章节，
    // 所以不能按字段直接分组，否则 90% 的节点会被塞进第一章。
    if (n.chapterTitle) curChapter = n.chapterTitle;
    const key = curChapter || '序';
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key).push(id);
  }
  const blank = () => {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  };
  for (const [chapter, ids] of byChapter) {
    blank();
    lines.push(chapter);
    lines.push('');
    let lastScene = '';
    for (const id of ids) {
      const n = doc.nodes[id];
      const sc = n.scene;
      const scName = typeof sc === 'string' ? sc : (sc && sc.name);
      blank();
      if (scName && scName !== lastScene) {
        lastScene = scName;
        lines.push('〔' + scName + '〕');
        lines.push('');
      }
      if (n.isEnding) {
        if (n.title) { lines.push(n.title); lines.push(''); }
        if (n.description) { lines.push(String(n.description).trim()); lines.push(''); }
        if (n.closing) { lines.push(String(n.closing).trim()); lines.push(''); }
        continue;
      }
      for (const s of (n.segments || [])) {
        const text = String(s.text || '').trim();
        if (!text) continue;
        lines.push(s.speaker ? s.speaker + '：“' + text + '”' : text);
        lines.push('');
      }
      const cs = (n.choices || []).map((c) => c.text).filter(Boolean);
      if (cs.length) {
        lines.push('另一种可能：' + cs.map((t) => '「' + t + '」').join(' / '));
        lines.push('');
      }
    }
  }
  return lines;
}

/* ---------------- 入口 ---------------- */
function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('用法：node tools/story2txt.mjs <剧本.json> [--out xxx.txt] [--mode main|full]');
    process.exit(1);
  }
  const src = args[0];
  const getFlag = (name, def) => {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };
  const mode = getFlag('mode', 'main');
  const doc = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!doc || !doc.nodes || !doc.startNodeId) {
    console.error('不是有效的剧本 JSON：缺少 nodes 或 startNodeId');
    process.exit(1);
  }
  const meta = doc.meta || {};
  const lines = [];
  lines.push(meta.title || path.basename(src, '.json'));
  lines.push('');
  if (meta.author) lines.push('作者：' + meta.author);
  if (meta.description) { lines.push(''); lines.push(String(meta.description).trim()); }
  lines.push('');

  const body = mode === 'full' ? walkFull(doc) : walkMain(doc, {});
  lines.push(...body);

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const out = getFlag('out', path.join('example', (meta.title || '剧本') + (mode === 'full' ? '-全剧本' : '') + '.txt'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text, 'utf8');

  const chars = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const chapters = (text.match(/^第[一二三四五六七八九十百零〇\d]+章/gm) || []).length;
  console.log('mode=' + mode);
  console.log('输出：' + out);
  console.log('字数：' + chars + ' | 章节行：' + chapters + ' | 总行数：' + text.split('\n').length);
}

main();

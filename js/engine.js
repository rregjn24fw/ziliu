/* ============================================================
   engine.js — 互动规则引擎（纯函数，不碰 DOM，方便单测）
   把一章正文切成“节拍(beat)”：
     · 每个节拍带自己的字号(scale)与语气(tone) —— 这就是“呼吸”
     · 每一段至少挑出一个“跳出来的词”(marks) —— 点它会触发回声
     · 每段的第一行打 lead 标记 —— 界面靠它保证这一段里一定有字在动
     · 可选插入“卡页”(gate) —— 阅读途中整页跳出来的一张卡，点一下才继续
    正文里不插任何“问你想怎么读”的弹层；读法只在设置里定。
   中英文走同一套规则：中文看字/拟声/引号，英文看词/大写/引号。
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- 语言判定 ---------------- */
  function countOf(re, s) {
    const m = String(s).match(re);
    return m ? m.length : 0;
  }
  const RE_LAT = /[A-Za-z]/g;
  const RE_CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;

  function isLatinText(s) {
    const lat = countOf(RE_LAT, s);
    if (lat < 3) return false;
    return lat > countOf(RE_CJK, s);
  }
  // 折成“中文等效长度”，让同一套阈值对中英文都成立
  function effLen(s) {
    const L = String(s).length;
    return isLatinText(s) ? Math.round(L * 0.52) : L;
  }

  /* ---------------- 词表 ---------------- */
  const SOFT_CN = /(心想|心里|暗想|觉得|似乎|仿佛|好像|也许|或许|大概|记得|回忆|梦里|梦到|模糊|忽然想起|轻轻|悄悄|无声|沉默|安静|闭上眼)/;
  const SOFT_EN = /\b(thought|wonder\w*|maybe|perhaps|seem\w*|quiet\w*|whisper\w*|remember\w*|dream\w*|almost|somehow|silent\w*|nearly|guess\w*)\b/i;
  function isSoft(s) {
    return SOFT_CN.test(s) || SOFT_EN.test(s);
  }

  const ONO_CN = /(噼里啪啦|轰隆隆|叮叮当当|扑通|咔嚓|轰隆|哗啦|叮咚|咕噜|滴答|滴嗒|簌簌|沙沙|嗡嗡|嘶嘶|呼呼|砰砰|嘭嘭|啪啪|哒哒|唰唰|吱呀|嘎吱|哐当|咚|砰|嘭|啪|哗|唰|叮|嗡|嘶|咔|哒|轰|哧|咻|嗒|滋|嘎|吱)/g;
  const ONO_EN = /\b(BANGS?|CRASH(?:ES|ED|ING)?|THUMPS?|THUDS?|SMACKS?|WHAM|ZAPS?|SPLAT|CLANGS?|CLANKS?|CREAK(?:S|ED|ING)?|SQUEAK(?:S|ED)?|RIIING|RING|DINGS?|BEEPS?|HONKS?|POPS?|SNAPS?|KNOCKS?|RATTLES?|BUZZ(?:ES|ED)?|HISS(?:ES|ED)?|WHOOSH|SWOOSH|SPLASH(?:ES|ED)?|GULPS?|BURPS?|ACHOO+|HAHA+|HEHE+|WOO+|Eeek|EEEEK)\b/g;

  const STOP2 = new Set((
    '我们 你们 他们 她们 它们 自己 什么 怎么 这个 那个 这样 那样 这时 那时 时候 已经 可以 只是 但是 因为 所以 如果 还是 就是 不是 没有 一个 一样 现在 起来 出来 过去 知道 觉得 看见 听见 说话 眼睛 心里 手上 面前 身后 一下 一次 一边 一直 一定 一样 于是 然后 而且 虽然 不过 其实 开始 突然 忽然 仿佛 似乎 好像 应该 需要 能够 所有 任何 一切 有些 很多 非常 十分 特别 终于 居然 竟然 果然 仍然 依然 已经 曾经 正在 将要 马上 立刻 顿时 仍然 简直 几乎 大约 左右 以后 以前 之后 之前 里面 外面 中间 旁边 上面 下面 前面 后面 左边 右边 到处 四处 任何 别人 大家 东西 事情 问题 办法 样子 声音 地方 时间 感觉 心情 目光 脸上 身上 头发 手指 脚步 忽然 忽然'
  ).split(/\s+/));

  const STOP_CHARS = new Set('的了着过是在有和与就不都而及或也很更最又再才却只把被让给从对向于以为所其之此该每各某那这哪些个本只条张件次位种点样还太呢吗吧啊呀哦嗯二三两一二一');

  const EN_STOP = new Set((
    'the and that you for with was were are have has had his her their them they she him its our your ' +
    'but not all can will would could should about from this these those there here what when where which who how why ' +
    'just very really too also then than now still even only more most some any every one two three first last next ' +
    'been being does did doing done such into over under after before again because while until though through ' +
    'said says say told tell asked asks went goes going gone came come comes get gets got make makes made take takes took ' +
    'like look looks looked well yeah okay ok mom dad thing things way back down out off something anything nothing ' +
    'little good bad big small much many other another same new old long right left know knew think thought want wanted ' +
    'day days time times never always ever back okay alright hello hey wow oh ah ha he she it i you we they me my'
  ).split(/\s+/));

  const EN_CAPS_STOP = new Set(('I A AN THE AND BUT OR SO IF IT ME MY HE SHE WE US DO BY AS BE AT IN ON OF TO UP AM PM ' +
    'OK OH NO YES MR MRS MS DR TV TV\'S').split(/\s+/));

  const ABBR = new Set((
    'mr mrs ms dr prof st jr sr vs etc eg ie no vol fig ch pt pp inc ltd co dept est ca approx ' +
    'jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun'
  ).split(/\s+/));

  const IMG_RE = /^\u0001IMG:(.+)\u0001$/;

  // 阅读模式：大部分句子保持 1.0，只有真正“响”的句子才放大，而且彼此隔开
  function makeRestrainedScale() {
    let lastBig = -99;
    return function (text, i) {
      if (i - lastBig < 8) return 1;
      if (isTagLine(text)) return 1;
      const L = effLen(text);
      const ex = /[！!]/.test(text);
      const qu = /[？?]/.test(text);
      let s = 1;
      if (L <= 10 && (ex || qu)) s = 1.5;
      else if (ex && L <= 24) s = 1.26;
      else if (qu && L <= 14) s = 1.2;
      else if (L <= 6 && /[，。…,]$/.test(text)) s = 1.12;
      else if (isLatinText(text) && /\b[A-Z]{3,}\b/.test(text) && L <= 18) s = 1.3;
      if (s !== 1) lastBig = i;
      return s;
    };
  }

  const SPEECH_CHARS = /[说道问答喊叫笑叹嚷吼应]/;

  // “他说。”“一个声音说。”这类很短的说白，不该被放大，也不该单独成为一句
  function isTagLine(s) {
    if (!s) return false;
    if (isLatinText(s)) {
      if (s.length > 42) return false;
      return /^["“]?((he|she|i|they|we|it|you|mom|dad|grandma|grandpa|[A-Z][a-z]+)[,]?\s+)?(said|asked|replied|answered|yelled|shouted|whispered|muttered|cried|called|added|explained|told|thought|agreed|insisted|snapped|sighed|laughed|promised|warned|began|continued|gasped|groaned)(\s+[a-z']+){0,2}[.,!?…]?["”]?$/i.test(s);
    }
    return s.length <= 9 && s.indexOf('，') < 0 &&
      /^.{1,4}(说|问|答|道|喊|叫|笑|叹|应|想|愣|嘀咕)[\u3002\uff01\uff1f\u2026]?$/.test(s);
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  /* ---------------- 断句 ---------------- */
  const END_CN = '。！？!?…';
  const CLOSE = '」』”’"）)】';

  function isEndAt(chars, i) {
    const c = chars[i];
    if (c === '.') {
      const prev = chars[i - 1] || '';
      const next = chars[i + 1] || '';
      if (!next) return true;
      if (/\d/.test(prev) && /\d/.test(next)) return false;      // 3.14
      if (!/[\s"'”’)\]」』]/.test(next)) return false;            // www.example.com
      let j = i - 1;
      let w = '';
      while (j >= 0 && /[A-Za-z]/.test(chars[j]) && w.length < 14) { w = chars[j] + w; j--; }
      if (w.length === 1 && /[A-Z]/.test(w)) return false;        // J. K.
      if (w && ABBR.has(w.toLowerCase())) return false;           // Mr. Smith
      return true;
    }
    return END_CN.indexOf(c) >= 0;
  }

  function splitLong(s) {
    const latin = isLatinText(s);
    const soft = latin ? 120 : 46;
    const parts = s.split(/(?<=[，,；;、])/);
    const out = [];
    let buf = '';
    for (const p of parts) {
      buf += p;
      if (buf.length >= soft) { out.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(Boolean);
  }

  function splitSentences(text) {
    const chars = Array.from(String(text));
    const raw = [];
    let buf = '';
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      buf += c;
      if (isEndAt(chars, i)) {
        while (i + 1 < chars.length && (END_CN.indexOf(chars[i + 1]) >= 0 || chars[i + 1] === '.' || CLOSE.indexOf(chars[i + 1]) >= 0)) {
          buf += chars[++i];
        }
        const t = buf.trim();
        if (t) raw.push(t);
        buf = '';
      }
    }
    const tail = buf.trim();
    if (tail) raw.push(tail);

    const out = [];
    for (const s of raw) {
      const cap = isLatinText(s) ? 200 : 110;
      if (s.length > cap) out.push.apply(out, splitLong(s));
      else out.push(s);
    }
    return out;
  }

  /* ---------------- 字号 / 语气 ---------------- */
  function computeScale(text, index, intensity) {
    const k = typeof intensity === 'number' ? intensity : 0.75;
    const latin = isLatinText(text);
    const L = effLen(text);
    let s = 1;
    const ex = countOf(/[！!]/g, text);
    const qu = countOf(/[？?]/g, text);
    if (ex) s += Math.min(ex, 2) * (latin ? 0.26 : 0.24);
    if (qu) s += Math.min(qu, 2) * 0.09;
    if (/^[「『“"]/.test(text)) s += 0.05;
    if (latin && /\b[A-Z]{3,}\b/.test(text)) s += 0.13;
    if (L <= 8) s += 0.26;
    else if (L <= 14) s += 0.15;
    else if (L >= 70) s -= 0.12;
    if (/…{2,}|\.{3,}/.test(text)) s -= 0.09;
    if (isSoft(text)) s -= 0.11;
    s += (hash(text + ':' + index) - 0.5) * 0.14;

    const spread = 0.55 + k * 0.9;
    s = 1 + (s - 1) * spread;
    return Math.max(0.78, Math.min(1.9, Math.round(s * 1000) / 1000));
  }

  function computeTone(text) {
    const ex = countOf(/[！!]/g, text);
    const qu = countOf(/[？?]/g, text);
    const L = effLen(text);
    if (ex + qu >= 2) return 'loud';
    if (ex + qu && L <= 24) return 'loud';
    if (isLatinText(text) && /\b[A-Z]{3,}\b/.test(text) && L <= 30) return 'loud';
    if (/^[（(]/.test(text) || isSoft(text) || /…{2,}$/.test(text)) return 'soft';
    return 'plain';
  }

  /* ---------------- 词频 ---------------- */
  function buildFreq(text) {
    const freq = new Map();
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= text.length; i++) {
        const g = text.slice(i, i + n);
        if (!/^[\u4e00-\u9fa5]+$/.test(g)) continue;
        freq.set(g, (freq.get(g) || 0) + 1);
      }
    }
    return freq;
  }

  function buildWordFreq(text) {
    const freq = new Map();
    const words = String(text).toLowerCase().match(/[a-z][a-z'’\-]{3,}/g) || [];
    for (const w of words) {
      if (EN_STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    return freq;
  }

  function goodGram(g) {
    if (!g || g.length < 2) return false;
    if (STOP2.has(g)) return false;
    if (STOP_CHARS.has(g[0]) || STOP_CHARS.has(g[g.length - 1])) return false;
    return true;
  }

  function markAt(text, raw) {
    const word = cleanWord(raw);
    if (!word) return null;
    const start = text.indexOf(word);
    if (start < 0) return null;
    if (text.length - word.length < 3) return null;
    return { start, end: start + word.length, word };
  }

  // 挑出来的词别带首尾标点，不然卡片上会显示成 “We Three Trees,”
  function cleanWord(w) {
    const out = String(w || '')
      .replace(/^[\s,.;:!?，。；：！？…、"'“”‘’「」『』()（）\-–—]+/, '')
      .replace(/[\s,.;:!?，。；：！？…、"'“”‘’「」『』()（）\-–—]+$/, '');
    return out;
  }

  function pickLatin(text, freq, used) {
    // 1) 全大写词（小屁孩日记那种 ZOO-WEE MAMA）
    const caps = text.match(/\b[A-Z][A-Z'’\-]{1,15}\b/g) || [];
    let best = '';
    for (const w of caps) {
      if (EN_CAPS_STOP.has(w) || used.has(w)) continue;
      if (w.length > best.length) best = w;
    }
    if (best) {
      const mk = markAt(text, best);
      if (mk) return mk;
    }

    // 2) 拟声词
    ONO_EN.lastIndex = 0;
    let m;
    while ((m = ONO_EN.exec(text))) {
      const w = m[0];
      if (w && !used.has(w)) {
        const mk = markAt(text, w);
        if (mk) return mk;
      }
    }

    // 3) 引号里的短语
    const QUOTE = /["“]([^"“”]{2,22})["”]/g;
    while ((m = QUOTE.exec(text))) {
      const w = m[1].trim();
      if (w.length < 2) continue;
      if (w.split(/\s+/).length > 3) continue;
      if (!/[A-Za-z]/.test(w)) continue;
      if (used.has(w) || SPEECH_CHARS.test(w)) continue;
      if (/^(he|she|i|they|we|it|you|and|but|so|oh|no|yes|what|why|how|who|there|then)$/i.test(w)) continue;
      const mk = markAt(text, w);
      if (mk) return mk;
    }

    // 4) 本章反复出现的实词（出现 3 次以上）
    if (!freq) return null;
    let hit = '';
    let hitF = 2;
    const words = text.match(/[A-Za-z][A-Za-z'’\-]{4,}/g) || [];
    for (const w of words) {
      const lw = w.toLowerCase();
      if (EN_STOP.has(lw) || used.has(lw)) continue;
      const f = freq.get(lw) || 0;
      if (f < 3) continue;
      if (f > hitF || (f === hitF && w.length > hit.length)) { hitF = f; hit = w; }
    }
    if (hit) {
      const mk = markAt(text, hit);
      if (mk) return mk;
    }
    return null;
  }

  function pickCandidate(text, freq, used) {
    if (text.length < 7) return null;
    if (isLatinText(text)) return pickLatin(text, freq, used);

    // 1. 拟声词：最容易“跳出来”
    ONO_CN.lastIndex = 0;
    let m;
    while ((m = ONO_CN.exec(text))) {
      const w = m[0];
      if (w.length >= 1 && !used.has(w)) {
        const mk = markAt(text, w);
        if (mk) return mk;
      }
    }

    // 2. 引号里的短台词
    const QUOTE = /[「『“]([^「」『』“”]{2,8})[」』”]/g;
    while ((m = QUOTE.exec(text))) {
      const w = m[1].replace(/[\u3002\uff01\uff1f\u2026\uff0c\u3001\uff1b\uff1a\s]+$/, '');
      if (w.length < 2 || w.length > 6) continue;
      if (!/^[\u4e00-\u9fa5]+$/.test(w)) continue;
      if (used.has(w) || SPEECH_CHARS.test(w)) continue;
      const mk = markAt(text, w);
      if (mk) return mk;
    }

    // 3. 本章反复出现的双字词（要求出现 3 次以上，宁可少也不要乱）
    if (!freq) return null;
    let best = null;
    let bestScore = 2.9;
    for (let i = 0; i + 2 <= text.length; i++) {
      const g = text.slice(i, i + 2);
      if (!goodGram(g) || SPEECH_CHARS.test(g) || used.has(g)) continue;
      const f = freq.get(g) || 0;
      if (f >= 3 && f > bestScore) { bestScore = f; best = g; }
    }
    if (best) {
      const mk = markAt(text, best);
      if (mk) return mk;
    }
    return null;
  }

  /* ---------------- 文字条：正文里跳出来的那条字 ----------------
     2~10 个字，优先整块（「马尔福家」就是四个字一起跳，不会只剩「福家」），
     长块里随机切一段但必须包住原来那个词，而且不许盖满整行。 */
  const SPAN_MIN = 2;
  const SPAN_MAX = 10;
  const CJK_RUN = /[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;
  const CN_FUNC = /[的了着过和与是在就都也而及或吗呢吧啊]/;

  function isCjkChar(c) {
    return !!c && CJK_RUN.test(c);
  }

  // 这个位置所在的连续汉字段
  function cjkRun(text, at) {
    let s = Math.max(0, Math.min(text.length - 1, at));
    let e = s + 1;
    while (s > 0 && isCjkChar(text[s - 1])) s--;
    while (e < text.length && isCjkChar(text[e])) e++;
    return { s, e };
  }

  function trimSpan(text, a, b) {
    while (a < b && !/[0-9A-Za-z\u3400-\u9FFF]/.test(text[a])) a++;
    while (b > a && !/[0-9A-Za-z\u3400-\u9FFF]/.test(text[b - 1])) b--;
    return [a, b];
  }

  function expandSpan(text, mk, rnd) {
    const r = typeof rnd === 'function' ? rnd : Math.random;
    if (!mk || !text) return mk;
    if (/[A-Za-z]/.test(mk.word)) return mk;            // 英文整词，不按字数切
    const at = Math.max(0, Math.min(text.length - 1, mk.start));
    const run = cjkRun(text, at);
    let a = run.s;
    let b = run.e;
    if (b - a > SPAN_MAX) {
      // 长块：先找一个“能断开”的结尾（后面跟的是的/了/在…或标点），
      // 再从那里往回取偶数长度 —— 这样名字不会只剩后半截（马尔福家 ≠ 福家）
      let end = mk.end;
      for (let d = 0; d <= 3; d++) {
        const e = mk.end + d;
        if (e > run.e) break;
        if (e === run.e || CN_FUNC.test(text[e]) || !isCjkChar(text[e])) { end = e; break; }
      }
      if (end <= mk.start) end = Math.min(run.e, mk.end);
      const L = SPAN_MIN + 2 + 2 * Math.floor(r() * 4);   // 4 / 6 / 8 / 10
      b = Math.min(run.e, end);
      a = Math.max(run.s, b - L);
    } else if (b - a < SPAN_MIN) {
      if (a > 0) a--;
      if (b - a < SPAN_MIN && b < text.length) b++;
    }
    let t = trimSpan(text, a, b);
    a = t[0];
    b = t[1];
    // 不在助词上起头 / 收尾
    if (b - a > 2 && CN_FUNC.test(text[a])) a++;
    if (b - a > 2 && CN_FUNC.test(text[b - 1])) b--;
    t = trimSpan(text, a, b);
    a = t[0];
    b = t[1];
    if (b - a > SPAN_MAX) b = a + SPAN_MAX;
    if (b - a < SPAN_MIN) b = Math.min(text.length, a + SPAN_MIN);
    // 不许盖满整行：只有“整整一行全是字”时才留一个字在条外；
    // 行首行尾本来就是引号/句号的短句，把整段词标出来才好看（别切成“二十四小 时”）
    if (b - a >= text.length && b - a > SPAN_MIN) b--;
    if (b - a < SPAN_MIN || b <= a) return mk;
    return { start: a, end: b, word: text.slice(a, b) };
  }

  /* ---------------- 每段的第一行 ---------------- */
  // 段落是引擎自己数的（b.p）：一段可以有好几拍，第一拍标成 lead。
  // 界面靠 lead 决定“这一段至少得有一个字在动”，不靠界面自己再切一遍。
  function markLeads(beats) {
    let last = null;
    let first = true;
    for (const b of beats) {
      if (b.kind !== 'line') continue;
      const key = typeof b.p === 'number' ? b.p : b;
      if (first || key !== last) {
        b.lead = true;
        last = key;
        first = false;
      }
    }
    return beats;
  }

  // 一段里所有 line 节拍，按段分组（只认引擎自己数出来的段号）
  function paragraphGroups(beats) {
    const groups = [];
    const map = new Map();
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      if (b.kind !== 'line' || typeof b.p !== 'number') continue;
      let g = map.get(b.p);
      if (!g) { g = []; map.set(b.p, g); groups.push(g); }
      g.push(i);
    }
    return groups;
  }

  const WORD_CHAR = /[0-9A-Za-z\u3400-\u9FFF]/;

  // 兜底：实在挑不出“好词”，就随便取一小段可动的字。
  // 长行上会由 expandSpan() 收成 2~10 字，并在盖满整行时留一个字在外面。
  function fallbackAt(text, a, b) {
    if (b - a < 2) return null;
    const word = cleanWord(text.slice(a, b));
    if (!word) return null;
    return { start: a, end: b, word };
  }

  const WEAK_FIRST = /[的了着过是在有和与就不都而及或也很更最又再才却只把被让给从对向于以为所其之此该每各某那这哪些个本只条张件次位种点样还太呢吗吧啊呀哦嗯我你他她它咱您]/;

  function pickFallback(text, used) {
    const t = String(text || '');
    if (t.length < 2) return null;
    const skip = used || new Set();
    if (isLatinText(t)) {
      const words = t.match(/[A-Za-z][A-Za-z'’\-]{2,}/g) || [];
      for (const fresh of [true, false]) {
        for (const w of words) {
          const lw = w.toLowerCase();
          if (EN_STOP.has(lw)) continue;
          if (fresh && (skip.has(w) || skip.has(lw))) continue;
          const at = t.indexOf(w);
          const mk = fallbackAt(t, at, at + w.length);
          if (mk) return mk;
        }
      }
      return null;
    }
    // 先找不拿虚词/人称开头的两字块，再退一步；尽量不重复前面段落点过的词
    for (const fresh of [true, false]) {
      for (const strict of [true, false]) {
        for (let i = 0; i + 2 <= t.length; i++) {
          const a = t[i];
          const b = t[i + 1];
          if (!WORD_CHAR.test(a) || !WORD_CHAR.test(b)) continue;
          if (strict && WEAK_FIRST.test(a)) continue;
          if (isCjkChar(a) && isCjkChar(b) && STOP_CHARS.has(a) && STOP_CHARS.has(b)) continue;
          const mk = fallbackAt(t, i, i + 2);
          if (!mk) continue;
          if (fresh && skip.has(mk.word)) continue;
          return mk;
        }
      }
    }
    return null;
  }

  /* 每段至少一个“跳出来的词”。
     密度决定一段里**再多几个**：少 = 1 个，中 = 最多 2 个，多 = 最多 3 个（行数不够就少给，
     同段两个词之间至少隔 gap 拍，不会挤在一起）。 */
  function applyMarks(beats, chapterText, enabled, gap, rnd, per) {
    if (!enabled) return beats;
    const r = typeof rnd === 'function' ? rnd : Math.random;
    const freq = buildFreq(chapterText);
    const wfreq = buildWordFreq(chapterText);
    const base = Math.max(1, Math.round(Number(gap) || 3));
    const quota = Math.max(1, Math.min(3, Math.round(Number(per) || 1)));
    const used = new Set();

    for (const ids of paragraphGroups(beats)) {
      const want = Math.min(quota, ids.length);
      const span = Math.max(1, Math.min(base, Math.floor(ids.length / Math.max(1, want))));
      const lead = ids.filter((i) => beats[i].lead);
      const rest = ids.filter((i) => !beats[i].lead);
      for (let k = rest.length - 1; k > 0; k--) {
        const j = Math.floor(r() * (k + 1));
        const tmp = rest[k]; rest[k] = rest[j]; rest[j] = tmp;
      }
      const order = lead.concat(rest);
      const taken = [];
      let placed = 0;
      // pass 0：正常挑词（括号里的舞台提示先跳过）；pass 1：兜底，任意一小段字
      for (const pass of [0, 1]) {
        const skip = new Set();
        for (const i of order) {
          if (placed >= want) break;
          if (skip.has(i)) continue;
          const b = beats[i];
          if (!b.text || (b.marks && b.marks.length)) continue;
          if (pass === 0 && /^[（(]/.test(b.text)) continue;
          if (taken.some((c) => Math.abs(c - i) < span)) continue;
          const cand = pass === 0
            ? pickCandidate(b.text, isLatinText(b.text) ? wfreq : freq, used)
            : pickFallback(b.text, used);
          if (!cand) { skip.add(i); continue; }
          const ex = expandSpan(b.text, cand, r);
          if (!ex || !ex.word) { skip.add(i); continue; }
          b.marks.push(ex);
          used.add(ex.word);
          used.add(ex.word.toLowerCase());
          taken.push(i);
          placed++;
        }
        if (placed >= want) break;
      }
    }
    return beats;
  }

  // 这一拍主要是“谁在说话”，还是“旁白在描述”
  function beatStyle(text) {
    const latin = isLatinText(text);
    const re = latin ? /["“][\s\S]*?["”]/g : /[「『“][\s\S]*?[」』”]/g;
    const quoted = String(text).match(re);
    if (!quoted) return 'narration';
    const qlen = quoted.reduce((a, s) => a + s.length, 0);
    if (/^[「『“"—–]/.test(text)) return 'dialogue';
    return qlen >= text.length * 0.5 ? 'dialogue' : 'narration';
  }

  /* ---------------- 主入口 ---------------- */
  // granularity: 'sentence' 一句一停 | 'paragraph' 一段一停 | 'chapter' 整章铺开
  // density:     0 少 | 1 中 | 2 多  —— 每段至少 1 个跳词，密度决定一段里再多几个
  function markQuota(restrained, density) {
    if (restrained) return density >= 2 ? 2 : 1;   // 阅读模式再贪也只到 2
    if (density >= 2) return 3;
    if (density >= 1) return 2;
    return 1;
  }

  function splitLongParagraph(p) {
    const cap = isLatinText(p) ? 900 : 460;
    if (p.length <= cap) return [p];
    const sents = splitSentences(p);
    const out = [];
    let buf = '';
    for (const s of sents) {
      if (buf && buf.length + s.length > cap * 0.78) { out.push(buf); buf = ''; }
      buf = buf ? buf + joinSep(buf, s) + s : s;
      if (buf.length >= cap * 0.78) { out.push(buf); buf = ''; }
    }
    if (buf) out.push(buf);
    return out.length ? out : [p];
  }

  /* 句子重新拼回一段：英文句与句之间必须留空格，
     中文句子直接用标点接上（不然会读成 “hurry.The night”）。 */
  const CJK_ANY = /[\u3400-\u9FFF\u3000-\u303F\uFF01-\uFF60\uFFE0-\uFFE6]/;

  function joinSep(prev, next) {
    const a = prev[prev.length - 1] || '';
    const b = next[0] || '';
    return (CJK_ANY.test(a) || CJK_ANY.test(b)) ? '' : ' ';
  }

  function joinSents(list) {
    let out = '';
    for (const s of list) out = out ? out + joinSep(out, s) + s : s;
    return out;
  }

  function buildSentenceBeats(paragraphs, intensity, restrained) {
    const beats = [];
    let buf = [];
    let bufLen = 0;
    let para = -1;      // 段序号：卡页的「每 N 段」按它数，句子的分组不会跨段
    const scaleOf = restrained ? makeRestrainedScale() : null;

    const flush = () => {
      if (!buf.length) return;
      const text = joinSents(buf);
      const tag = isTagLine(text);
      let tone;
      let scale;
      if (scaleOf) {
        scale = scaleOf(text, beats.length);
        tone = scale > 1.05 ? 'loud' : 'plain';
      } else {
        tone = tag ? 'soft' : computeTone(text);
        scale = tag ? 0.94 : computeScale(text, beats.length, intensity);
      }
      beats.push({
        kind: 'line',
        p: para,
        style: beatStyle(text),
        text,
        tone,
        scale,
        huge: !scaleOf && !tag && tone === 'loud' && scale >= 1.42,
        marks: []
      });
      buf = [];
      bufLen = 0;
    };

    for (const p of paragraphs) {
      const im = IMG_RE.exec(p);
      if (im) {
        flush();
        para++;
        beats.push({ kind: 'image', p: para, src: im[1], style: 'narration', text: '', tone: 'plain', scale: 1, huge: false, marks: [] });
        continue;
      }
      para++;
      const sents = splitSentences(p);
      for (let k = 0; k < sents.length; k++) {
        const s = sents[k];
        const L = effLen(s);
        if (bufLen && (bufLen + L > 58 || buf.length >= 3)) flush();
        buf.push(s);
        bufLen += L;
        const isDialogue = /^[「『“"]/.test(s);
        if (L >= 44) flush();
        else if (isDialogue && L <= 22 && !isTagLine(sents[k + 1] || '')) flush();
      }
      flush();
    }
    flush();
    return beats;
  }

  function buildParagraphBeats(paragraphs, intensity, restrained) {
    const beats = [];
    const scaleOf = restrained ? makeRestrainedScale() : null;
    let para = -1;
    for (const p0 of paragraphs) {
      const im = IMG_RE.exec(p0);
      if (im) {
        para++;
        beats.push({ kind: 'image', p: para, src: im[1], style: 'narration', text: '', tone: 'plain', scale: 1, huge: false, marks: [] });
        continue;
      }
      para++;
      for (const p of splitLongParagraph(p0)) {
        if (scaleOf) {
          const scale = scaleOf(p, beats.length);
          beats.push({
            kind: 'line',
            p: para,
            style: beatStyle(p),
            text: p,
            tone: scale > 1.05 ? 'loud' : 'plain',
            scale,
            huge: false,
            marks: []
          });
          continue;
        }
        const sents = splitSentences(p);
        const scales = sents.map((s, i) => computeScale(s, i, intensity)).sort((a, b) => a - b);
        const mean = scales.reduce((a, b) => a + b, 0) / Math.max(1, scales.length);
        const max = scales[scales.length - 1] || 1;
        // 段落整体偏平均值，但被它里面最“响”的那句拉一把
        const scale = Math.max(0.9, Math.min(1.45, mean * 0.68 + max * 0.32));
        const loud = sents.some((s) => computeTone(s) === 'loud');
        const tone = loud ? 'loud' : (computeTone(p) === 'soft' ? 'soft' : 'plain');
        beats.push({
          kind: 'line',
          p: para,
          style: beatStyle(p),
          text: p,
          tone,
          scale,
          huge: loud && scale >= 1.3,
          marks: []
        });
      }
    }
    return beats;
  }

  /* ---------------- 卡页：阅读途中整页跳出来的一张卡 ---------------- */
  function shortQuote(text, max) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const i = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('。'), cut.lastIndexOf('.'), cut.lastIndexOf(','));
    return (i > max * 0.5 ? cut.slice(0, i + 1) : cut) + '…';
  }

  // 卡页上不值得单独抽出来的词（虚词、口头语）
  const GATE_STOP = /^(的|了|是|在|和|与|也|就|都|而|及|或|一个|一下|一点|一些|什么|怎么|我们|你们|他们|她们|自己|这个|那个|这样|那样|这里|那里|没有|已经|还是|还有|因为|所以|但是|然后|如果|就是|不是|可以|知道|时候|一样|东西|事情|声音|时候)$/;

  function gateWordOk(w) {
    const t = String(w || '').replace(/^[^0-9A-Za-z\u3400-\u9fa5]+|[^0-9A-Za-z\u3400-\u9fa5]+$/g, '').trim();
    if (!t) return false;
    if (GATE_STOP.test(t)) return false;
    if (/^[A-Za-z]/.test(t)) return t.length >= 3;
    return Array.from(t).length >= 2;
  }

  // 卡片上的引句尽量是完整的句子，不要半句加省略号
  function quoteOf(text, max) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'),
      cut.lastIndexOf('…'), cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    if (end > max * 0.42) return cut.slice(0, end + 1);
    return shortQuote(t, max);
  }

  /* 一张卡：优先用“刚读到的那句”或“接下来要读的那句”里跳出来的词
     ahead=true → 先看后文（读者正要读的那句），false → 先看前文 */
  function makeGate(beats, pos, ahead) {
    const front = [];
    const back = [];
    for (let d = 0; d < 8; d++) {
      const b = beats[pos + d];
      if (b && b.kind === 'line') front.push(b);
      const a = beats[pos - 1 - d];
      if (a && a.kind === 'line') back.push(a);
    }
    const near = ahead === false ? back.concat(front) : front.concat(back);
    for (const b of near) {
      if (!b.marks || !b.marks.length) continue;
      const m = b.marks.find((x) => gateWordOk(x.word));
      if (!m) continue;
      return {
        kind: 'gate',
        variant: 'word',
        word: m.word,
        text: quoteOf(b.text, 120),
        style: b.style,
        tone: 'plain',
        scale: 1,
        huge: false,
        marks: []
      };
    }
    // 没有合适的词卡，就把那句抽出来放大
    const aheadOrder = [];
    const backOrder = [];
    for (let d = 0; d <= 4; d++) { const c = beats[pos + d]; if (c && c.kind === 'line') aheadOrder.push(c); }
    for (let d = 1; d <= 4; d++) { const c = beats[pos - d]; if (c && c.kind === 'line') backOrder.push(c); }
    const order = ahead === false ? backOrder.concat(aheadOrder) : aheadOrder.concat(backOrder);
    let b = null;
    for (const c of order) {
      if (c.text && c.text.replace(/\s/g, '').length >= 4) { b = c; break; }
    }
    if (!b) {
      for (const c of order) {
        if (c.text && c.text.length) { b = c; break; }
      }
    }
    if (!b) return null;
    return {
      kind: 'gate',
      variant: 'quote',
      word: '',
      text: quoteOf(b.text, 140),
      style: b.style,
      tone: 'plain',
      scale: 1,
      huge: false,
      marks: []
    };
  }

  /* 每一行属于第几个“单位”：unit=sentence 一行一句，unit=paragraph 一段一卡 */
  function gateUnitIds(beats, unit) {
    const out = [];
    let cur = -1;
    let lastP = -1;
    for (const b of beats) {
      if (b.kind !== 'line') { out.push(null); continue; }
      if (unit === 'paragraph') {
        if (typeof b.p === 'number') {
          if (b.p !== lastP) { cur++; lastP = b.p; }
        } else {
          cur++;
        }
      } else {
        cur++;
      }
      out.push(cur);
    }
    return out;
  }

  /* 每 N 句 / 每 N 段弹一张卡。
     carry 是上一章没用完的零头 —— 一章只有几行的书，读几章也会攒出一张。
     返回 { beats, count, carry, units }，carry 交给下一章继续。 */
  function insertGatesEvery(beats, opts) {
    const o = opts || {};
    const every = Math.max(0, Math.round(Number(o.every) || 0));
    const unit = o.unit === 'paragraph' ? 'paragraph' : 'sentence';
    const ahead = o.ahead !== false;
    let carry = Math.max(0, Math.round(Number(o.carry) || 0));
    const n = beats.length;
    if (!every || n < 2) return { beats, count: 0, carry, units: 0 };

    const ids = gateUnitIds(beats, unit);
    const out = [];
    let count = 0;
    let units = 0;
    for (let i = 0; i < n; i++) {
      out.push(beats[i]);
      const u = ids[i];
      if (u == null) continue;
      if (i + 1 < n && ids[i + 1] === u) continue;   // 这段（句）还没读完
      units++;
      carry++;
      if (carry < every) continue;
      if (i >= n - 1) continue;                     // 章尾不留卡：后文没了，留着下一章用
      const g = makeGate(beats, i + 1, ahead);
      if (!g) continue;
      out.push(g);
      count++;
      carry = 0;
    }
    return { beats: out, count, carry, units };
  }

  function buildChapter(chapter, opts) {
    opts = opts || {};
    const intensity = typeof opts.intensity === 'number' ? opts.intensity : 0.75;
    const granularity = opts.granularity || 'sentence';
    const density = typeof opts.density === 'number' ? opts.density : 1;
    const restrained = !!opts.restrained;
    const raw = String((chapter && chapter.text) || '').replace(/\r/g, '');
    const paragraphs = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);

    let beats = granularity === 'paragraph'
      ? buildParagraphBeats(paragraphs, intensity, restrained)
      : buildSentenceBeats(paragraphs, intensity, restrained);

    if (!beats.length) {
      beats.push({ kind: 'line', style: 'narration', text: '（这一章没有正文）', tone: 'soft', scale: 1, huge: false, marks: [] });
    }

    const gap = restrained ? 3 : 2;
    markLeads(beats);
    applyMarks(beats, raw, opts.marks !== false, gap, opts.rnd, markQuota(restrained, density));

    if (opts.gateEvery > 0) {
      beats = insertGatesEvery(beats, {
        every: opts.gateEvery,
        unit: opts.gateUnit,
        carry: opts.gateCarry,
        ahead: opts.gateAhead
      }).beats;
    }

    return beats;
  }

  /* ---------------- 回声：在全书里找这个词的别处 ---------------- */
  function plain(s) {
    return String(s || '').replace(/\u0001[^\u0001]*\u0001/g, '');
  }

  function sentenceAround(text, idx, len) {
    let s = idx;
    let e = idx + len;
    const stop = '。！？…\n.!?';
    while (s > 0 && stop.indexOf(text[s - 1]) < 0) s--;
    while (e < text.length && stop.indexOf(text[e]) < 0) e++;
    return text.slice(s, e).trim();
  }

  function findEcho(book, word, currentChapterIndex, currentText) {
    const chapters = (book && book.chapters) || [];
    const refs = [];
    let count = 0;
    const ci = isLatinText(word);
    const needle = ci ? String(word).toLowerCase() : String(word);
    const cur = plain(currentText);

    for (let k = 0; k < chapters.length; k++) {
      const raw = plain(chapters[k].text);
      let hay = raw;
      if (ci) {
        hay = raw.toLowerCase();
        if (hay.length !== raw.length) hay = raw;
      }
      let from = 0;
      let idx;
      while ((idx = hay.indexOf(needle, from)) >= 0) {
        count++;
        from = idx + needle.length;
        const sent = plain(sentenceAround(raw, idx, needle.length));
        if (!sent || sent.length < 4) continue;
        // 别把“当前这句”当成别处的回声
        if (cur && (sent.indexOf(cur) >= 0 || cur.indexOf(sent) >= 0)) continue;
        if (refs.some((r) => r.text === sent)) continue;
        refs.push({ text: sent, chapterIndex: k, chapterTitle: chapters[k].title || '第 ' + (k + 1) + ' 章' });
        if (refs.length > 60) break;
      }
      if (refs.length > 60) break;
    }

    // 按与当前章节的距离排序，远的放后面
    refs.sort((a, b) => Math.abs(a.chapterIndex - currentChapterIndex) - Math.abs(b.chapterIndex - currentChapterIndex));

    return { word, count, refs: refs.slice(0, 3) };
  }

  /* 回声退让：整条太长、书里只出现一次时，退到更短的核心词再找一遍。
     返回的顺序就是尝试的顺序：整条 → 头4 → 尾4 → 头3 → 尾3 → 头2。 */
  function echoKeys(word) {
    const w = String(word || '').trim();
    if (!w) return [];
    if (/[A-Za-z]/.test(w)) return [w];
    const chars = Array.from(w);
    if (chars.length <= 2) return [w];
    const out = [w];
    const add = (s) => {
      const t = s.trim();
      if (t.length >= 2 && out.indexOf(t) < 0) out.push(t);
    };
    add(chars.slice(0, 4).join(''));
    add(chars.slice(-4).join(''));
    add(chars.slice(0, 3).join(''));
    add(chars.slice(-3).join(''));
    add(chars.slice(0, 2).join(''));
    return out;
  }

  /* ---------------- 正则 / 全文搜索 ---------------- */
  const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

  function escapeRe(s) {
    return String(s == null ? '' : s).replace(RE_SPECIAL, '\\$&');
  }

  function compileQuery(q, opts) {
    const o = opts || {};
    const raw = String(q == null ? '' : q);
    if (!raw.trim()) return { re: null, error: '' };
    if (raw.length > 120) return { re: null, error: '搜索词太长了（最多 120 字）' };
    const src = o.regex ? raw : escapeRe(raw);
    const flags = 'g' + (o.caseSensitive ? '' : 'i');
    try {
      return { re: new RegExp(src, flags), error: '' };
    } catch (e) {
      return { re: null, error: '正则写错了：' + ((e && e.message) || '语法不对') };
    }
  }

  // 单段文本里的所有命中（位置 + 前后各 16 字摘要）
  function searchText(text, q, opts) {
    const o = opts || {};
    const out = { hits: [], error: '', capped: false };
    const c = compileQuery(q, o);
    if (c.error) { out.error = c.error; return out; }
    if (!c.re) return out;
    const src = String(text == null ? '' : text);
    const max = Math.max(1, o.max || 400);
    let guard = 0;
    let m;
    while ((m = c.re.exec(src))) {
      if (m[0].length === 0) {
        // `a*`、`^` 这种零宽匹配会让 lastIndex 原地打转
        c.re.lastIndex++;
        if (guard++ > 2000) break;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      out.hits.push({
        start,
        end,
        text: m[0],
        before: src.slice(Math.max(0, start - 16), start).replace(/\s+/g, ' ').trim(),
        after: src.slice(end, Math.min(src.length, end + 16)).replace(/\s+/g, ' ').trim()
      });
      if (out.hits.length >= max) { out.capped = true; break; }
    }
    return out;
  }

  // 整本书搜：命中带章号，够跳转用
  function searchBook(chapters, q, opts) {
    const o = opts || {};
    const list = chapters || [];
    const max = Math.max(1, o.max || 400);
    const hits = [];
    let capped = false;
    let error = '';
    for (let k = 0; k < list.length; k++) {
      const text = plain((list[k] && list[k].text) || '');
      const res = searchText(text, q, { regex: o.regex, caseSensitive: o.caseSensitive, max: max - hits.length });
      if (res.error) { error = res.error; break; }
      for (const h of res.hits) {
        hits.push({
          ch: k,
          chTitle: (list[k] && list[k].title) || '第 ' + (k + 1) + ' 章',
          start: h.start,
          end: h.end,
          text: h.text,
          before: h.before,
          after: h.after
        });
        if (hits.length >= max) { capped = true; break; }
      }
      if (capped) break;
    }
    return { hits, count: hits.length, error, capped };
  }

  /* ============================================================
     用户自定义「正则美化」规则
       规则只改屏幕上的显示，不改原文：
         · 样式：命中处包一层 <span class="rx" data-style="…">
         · 替换：命中的文字在显示时换成 repl（支持 $1…$9、$&，留空=删掉）
       顺序：先跑所有替换，再把样式套在替换后的文字上；样式重叠时先声明的赢。
     ============================================================ */
  const RULE_ACTIONS = ['hi', 'big', 'glow', 'dim', 'replace'];
  const RULE_STYLE_NAME = { hi: '高亮', big: '放大', glow: '发光', dim: '淡化', replace: '替换' };
  const RULE_MAX = 16;
  const RULE_PAT_MAX = 300;
  const RULE_MATCH_MAX = 200;

  // 会写正则的人不一定知道回溯爆炸：先拦最典型的「嵌套量词」
  function riskyRe(src) {
    const s = String(src || '');
    if (!s) return '这条正则是空的';
    if (s.length > RULE_PAT_MAX) return '正则太长了（最多 ' + RULE_PAT_MAX + ' 字）';
    if (/\([^()]*[+*][^()]*\)[+*]/.test(s)) return '这种嵌套量词（比如 (a+)+）容易把页面卡死，换个写法';
    return '';
  }

  // 裸正则默认「不分大小写」；写成 /pat/flags 就按你写的 flags 来
  function parseRulePat(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return { src: '', flags: 'gi', error: '这条正则是空的' };
    let flags = 'gi';
    if (s.length > 1 && s.charAt(0) === '/') {
      const end = s.lastIndexOf('/');
      if (end > 0) {
        const f = s.slice(end + 1);
        if (!/^[gimsuy]*$/.test(f)) return { src: s.slice(1, end), flags: 'gi', error: '正则开关写错了：' + f + '（只能用 g i m s u y）' };
        s = s.slice(1, end);
        if (!s) return { src: '', flags: 'gi', error: '这条正则是空的' };
        flags = f.indexOf('g') >= 0 ? f : 'g' + f;
      }
    }
    return { src: s, flags, error: '' };
  }

  function safeRe(src, flags) {
    try { return new RegExp(src, flags.indexOf('g') >= 0 ? flags : flags + 'g'); } catch (e) { return null; }
  }

  function eachMatch(re, text, cb) {
    const rx = re.global ? re : safeRe(re.source, re.flags + 'g');
    if (!rx) return 0;
    rx.lastIndex = 0;
    let guard = 0;
    let n = 0;
    let m;
    while ((m = rx.exec(text))) {
      if (!m[0].length) { rx.lastIndex++; if (guard++ > 2000) break; continue; }
      if (cb(m) === false) break;
      n++;
      if (n >= RULE_MATCH_MAX) break;
      if (rx.lastIndex === m.index) rx.lastIndex++;
    }
    return n;
  }

  function compileRules(list) {
    const out = { rules: [], errors: [] };
    const arr = Array.isArray(list) ? list.slice(0, RULE_MAX) : [];
    for (let i = 0; i < arr.length; i++) {
      const r = arr[i] || {};
      const raw = String(r.pat == null ? '' : r.pat).trim();
      if (!raw) { out.errors.push({ i, msg: '这条正则是空的' }); continue; }
      const p = parseRulePat(raw);
      if (p.error) { out.errors.push({ i, msg: p.error }); continue; }
      const bad = riskyRe(p.src);
      if (bad) { out.errors.push({ i, msg: bad }); continue; }
      const re = safeRe(p.src, p.flags);
      if (!re) { out.errors.push({ i, msg: '正则写错了：语法不对' }); continue; }
      const action = RULE_ACTIONS.indexOf(r.action) >= 0 ? r.action : 'hi';
      out.rules.push({
        i,
        pat: raw,
        src: p.src,
        flags: p.flags,
        action,
        repl: String(r.repl == null ? '' : r.repl).slice(0, 200),
        on: r.on !== false,
        re
      });
    }
    return out;
  }

  function prepareLine(text, marks, hit, rules) {
    const src = String(text == null ? '' : text);
    const list = Array.isArray(rules) ? rules : [];
    let disp = src;

    // 1) 替换只在显示层发生，原文一个字不动
    for (const r of list) {
      if (!r || r.on === false || r.action !== 'replace' || !r.src) continue;
      const re = r.re && r.re.global ? r.re : safeRe(r.src, r.flags);
      if (!re) continue;
      re.lastIndex = 0;
      disp = disp.replace(re, r.repl == null ? '' : r.repl);
    }

    // 2) 样式命中（在替换后的文字上找）
    const spans = [];
    list.forEach((r, ri) => {
      if (!r || r.on === false || r.action === 'replace' || !r.src) return;
      const re = r.re && r.re.global ? r.re : safeRe(r.src, r.flags);
      if (!re) return;
      eachMatch(re, disp, (m) => {
        spans.push({ start: m.index, end: m.index + m[0].length, style: r.action, rule: ri });
      });
    });
    spans.sort((a, b) => (a.start - b.start) || (a.rule - b.rule));
    const merged = [];
    for (const sp of spans) {
      const prev = merged[merged.length - 1];
      if (prev && sp.start < prev.end) continue;                    // 先声明的规则优先
      if (prev && sp.start === prev.end && prev.style === sp.style) { prev.end = sp.end; continue; }
      merged.push({ start: sp.start, end: sp.end, style: sp.style });
    }
    const styleAt = new Array(disp.length).fill('');
    for (const sp of merged) {
      const end = Math.min(disp.length, sp.end);
      for (let k = Math.max(0, sp.start); k < end; k++) styleAt[k] = sp.style;
    }

    // 3) 跳词 / 搜索高亮按词重新定位；词被替换掉了就放弃那一个标记
    const findNear = (word, near) => {
      if (!word) return null;
      let best = -1;
      let bestD = Infinity;
      let from = 0;
      let idx;
      while ((idx = disp.indexOf(word, from)) >= 0) {
        const d = Math.abs(idx - near);
        if (d < bestD) { bestD = d; best = idx; }
        from = idx + 1;
      }
      return best >= 0 ? { start: best, end: best + word.length } : null;
    };

    const outMarks = [];
    for (const mk of (marks || [])) {
      if (!mk || !mk.word) continue;
      const loc = findNear(mk.word, typeof mk.start === 'number' ? mk.start : 0);
      if (!loc) continue;
      outMarks.push({ start: loc.start, end: loc.end, word: mk.word });
    }
    outMarks.sort((a, b) => a.start - b.start);

    let outHit = null;
    if (hit && typeof hit.start === 'number' && hit.end > hit.start) {
      const word = src.slice(hit.start, hit.end);
      const loc = findNear(word, hit.start);
      if (loc) outHit = loc;
    }

    return { text: disp, marks: outMarks, hit: outHit, spans: merged, styleAt };
  }

  // 设置面板里的实时试跑：命中最前一处 + 前后文 + 替换结果
  function rulePreview(rule, text) {
    const src = String(text == null ? '' : text);
    const c = compileRules([rule]);
    if (!c.rules.length) {
      return { error: (c.errors[0] && c.errors[0].msg) || '这条规则不生效', hits: 0, before: '', match: '', after: '', result: '' };
    }
    const r = c.rules[0];
    const re = safeRe(r.src, r.flags);
    if (!re) return { error: '正则写错了：语法不对', hits: 0, before: '', match: '', after: '', result: '' };
    let hits = 0;
    let first = null;
    eachMatch(re, src, (m) => { hits++; if (!first) first = m; });
    if (!first) return { error: '', hits: 0, before: '', match: '', after: '', result: '' };
    const start = first.index;
    const end = start + first[0].length;
    const result = r.action === 'replace' ? first[0].replace(re, r.repl == null ? '' : r.repl) : first[0];
    return {
      error: '',
      hits,
      before: src.slice(Math.max(0, start - 18), start).replace(/\s+/g, ' '),
      match: first[0],
      after: src.slice(end, Math.min(src.length, end + 18)).replace(/\s+/g, ' '),
      result
    };
  }

  /* ---------------- 词义动作：这个词写的是什么，它就演什么 ---------------- */
  /* 顺序即优先级：越像“动作”的越靠前，形容词（大/小/冷/热）放后面，
     这样「大笑」演笑、「大哭」演哭，单独的「大」才演长大 */
  const VERB_ACT = [
    ['跑', 'run'], ['奔', 'run'], ['逃', 'run'], ['追', 'run'],
    ['走', 'walk'], ['踱', 'walk'], ['爬', 'crawl'], ['滚', 'roll'],
    ['跳', 'jump'], ['蹦', 'jump'], ['弹', 'jump'],
    ['飞', 'fly'], ['飘', 'fly'], ['落', 'fall'], ['掉', 'fall'],
    ['哭', 'cry'], ['泪', 'cry'], ['笑', 'laugh'],
    ['喊', 'shout'], ['叫', 'shout'], ['吼', 'shout'], ['骂', 'shout'],
    ['推', 'push'], ['拉', 'pull'], ['躲', 'hide'], ['藏', 'hide'],
    ['抖', 'shiver'], ['颤', 'shiver'], ['晃', 'sway'], ['摇', 'sway'],
    ['冷', 'cold'], ['凉', 'cold'], ['烫', 'hot'], ['热', 'hot'], ['烧', 'hot'],
    ['转', 'spin'], ['晕', 'dizzy'], ['沉', 'sink'], ['浮', 'float'],
    ['大', 'grow'], ['涨', 'grow'], ['小', 'shrink'], ['缩', 'shrink']
  ];
  const EN_VERB = {
    run: 'run', ran: 'run', running: 'run', chase: 'run', chased: 'run',
    walk: 'walk', walked: 'walk', crawl: 'crawl', crawled: 'crawl', roll: 'roll', rolled: 'roll',
    jump: 'jump', jumped: 'jump', jumping: 'jump', bounce: 'jump', bounced: 'jump',
    fly: 'fly', flew: 'fly', flying: 'fly', fall: 'fall', fell: 'fall', falling: 'fall', drop: 'fall', dropped: 'fall',
    shake: 'shiver', shook: 'shiver', shiver: 'shiver', shivered: 'shiver', tremble: 'shiver', trembled: 'shiver',
    sway: 'sway', swayed: 'sway', wobble: 'sway', wobbled: 'sway',
    cold: 'cold', freezing: 'cold', froze: 'cold', hot: 'hot', burning: 'hot', burned: 'hot',
    big: 'grow', huge: 'grow', grow: 'grow', grew: 'grow', enormous: 'grow',
    small: 'shrink', tiny: 'shrink', shrink: 'shrink', shrank: 'shrink',
    shout: 'shout', shouted: 'shout', yell: 'shout', yelled: 'shout', scream: 'shout', screamed: 'shout',
    cry: 'cry', cried: 'cry', sob: 'cry', sobbed: 'cry', tear: 'cry', tears: 'cry',
    laugh: 'laugh', laughed: 'laugh', giggle: 'laugh', giggled: 'laugh',
    push: 'push', pushed: 'push', pull: 'pull', pulled: 'pull',
    hide: 'hide', hid: 'hide', spin: 'spin', spun: 'spin', dizzy: 'dizzy',
    sink: 'sink', sank: 'sink', float: 'float', floated: 'float'
  };

  function verbFor(word) {
    const w = String(word || '');
    if (!w) return '';
    if (/[A-Za-z]/.test(w)) {
      const k = w.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
      return EN_VERB[k] || '';
    }
    for (const [ch, act] of VERB_ACT) {
      if (w.indexOf(ch) >= 0) return act;
    }
    return '';
  }

  const Engine = {
    buildChapter,
    insertGatesEvery,
    gateUnitIds,
    quoteOf,
    gateWordOk,
    verbFor,
    splitSentences,
    computeScale,
    computeTone,
    findEcho,
    echoKeys,
    escapeRe,
    compileQuery,
    searchText,
    searchBook,
    compileRules,
    prepareLine,
    parseRulePat,
    riskyRe,
    rulePreview,
    RULE_ACTIONS,
    RULE_STYLE_NAME,
    RULE_MAX,
    RULE_PAT_MAX,
    expandSpan,
    cjkRun,
    hash,
    isLatinText,
    isTagLine,
    _internal: { buildFreq, buildWordFreq, pickCandidate, applyMarks, makeGate, expandSpan, cjkRun, searchText, echoKeys, markLeads, pickFallback, paragraphGroups }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  if (root) {
    root.XR = root.XR || {};
    root.XR.Engine = Engine;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

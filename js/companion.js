/* ============================================================
   companion.js — 拟人陪伴角色「阿泠」（字流书斋守卷人）
   纯函数：场景反馈 + 分支闲聊 + 随机闲聊；rnd 注入保证确定性可测。
   情绪三维 mood { warmth, mischief, solemnity } + 亲密度 affinity。
   ============================================================ */
(function (root) {
  'use strict';

  const NAME = '阿泠';

  function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
  }

  /* 默认状态（store 落库为单例 id:'main'） */
  function defaultState() {
    return {
      id: 'main',
      name: NAME,
      affinity: 0,
      mood: { warmth: 0.6, mischief: 0.3, solemnity: 0.4 },
      flags: {},        // { [scene]: { count, lastAt, lastIdx } }
      history: [],      // 最近 N 条 { at, scene, text }
      updatedAt: Date.now(),
      schemaVer: 1
    };
  }

  /* 每场景亲密度增益 */
  const AFF = {
    'first-open': 5, 'add-book': 4, 'resume': 1, 'interrupt': 1,
    'goal-chapter': 3, 'goal-book': 10, 'goal-pct': 2, 'branch-entry': 3, 'idle-chat': 2
  };

  /* 场景模板池：t 文本，d 情绪增量 {w,m,s} */
  const SCENES = {
    'first-open': {
      pool: [
        { t: '欢迎来到字流书斋。我是阿泠，替你守着这些书卷。', d: { w: 0.12, m: 0, s: 0.15 } },
        { t: '这里很静，正好读书。进来坐吧，我是守卷人阿泠。', d: { w: 0.10, m: 0, s: 0.12 } },
        { t: '灯已经点上了。我是阿泠，字流书斋的守卷人。', d: { w: 0.10, m: 0, s: 0.14 } }
      ]
    },
    'add-book': {
      pool: [
        { t: '《{title}》归架了，{chapters} 章，我记下了。', d: { w: 0.08, m: 0.05, s: 0.10 } },
        { t: '好书。{title}——我会替你好好收着。', d: { w: 0.08, m: 0, s: 0.08 } },
        { t: '又是新书进馆。《{title}》，来，先坐下翻两页？', d: { w: 0.06, m: 0.10, s: 0.05 } }
      ]
    },
    'resume': {
      pool: [
        { t: '接着上次的第 {chapter} 章读，正好。', d: { w: 0.05, m: 0, s: 0 } },
        { t: '你回来了。书还翻在那一页。', d: { w: 0.06, m: 0, s: 0 } },
        { t: '第 {chapter} 章，从这继续。', d: { w: 0.03, m: 0, s: 0 } }
      ]
    },
    'interrupt': {
      pool: [
        { t: '先合上这一页也无妨，书在这里等你。', d: { w: 0.06, m: 0, s: 0.06 } },
        { t: '且慢。要走了？我给你夹好书签。', d: { w: 0.05, m: 0, s: 0.05 } },
        { t: '读累就歇。字不会跑。', d: { w: 0.06, m: 0.03, s: 0 } }
      ]
    },
    'goal-chapter': {
      pool: [
        { t: '第 {chapter} 章读完。歇一歇，或往下再走一段。', d: { w: 0.07, m: 0, s: 0.08 } },
        { t: '这一章到底了。喝口水？', d: { w: 0.06, m: 0.06, s: 0 } },
        { t: '第 {chapter} 章，合页。', d: { w: 0.05, m: 0, s: 0.08 } }
      ]
    },
    'goal-book': {
      pool: [
        { t: '合上最后一页了。这本书，从此也是你的一部分。', d: { w: 0.15, m: 0, s: 0.18 } },
        { t: '全书终。阿泠替你高兴。', d: { w: 0.14, m: 0, s: 0.15 } },
        { t: '读完了。这书斋里，又多了一个读完的故事。', d: { w: 0.12, m: 0, s: 0.16 } }
      ]
    },
    'goal-pct': {
      pool: [
        { t: '读到 {pct}% 了，慢慢来。', d: { w: 0.05, m: 0, s: 0 } },
        { t: '{pct}%。好进度。', d: { w: 0.04, m: 0, s: 0 } },
        { t: '已经 {pct}% 了呀。', d: { w: 0.05, m: 0.02, s: 0 } }
      ]
    },
    'branch-entry': {
      pool: [
        { t: '这里藏着一条没走完的路，要进去看看吗？', d: { w: 0.03, m: 0.12, s: 0.10 } },
        { t: '岔路。你听，字在下面沙沙响。', d: { w: 0.02, m: 0.14, s: 0.10 } },
        { t: '这条支线，我替你看过一眼。', d: { w: 0.04, m: 0.10, s: 0.06 } }
      ]
    },
    'idle-chat': {
      pool: [
        { t: '你猜，我最爱哪本书？', d: { w: 0.02, m: 0.08, s: 0 } },
        { t: '且慢。这一页，值得慢慢读。', d: { w: 0.04, m: 0, s: 0.05 } },
        { t: '来，坐。书斋里什么也不着急。', d: { w: 0.05, m: 0, s: 0.03 } },
        { t: '字会替我说。你读就是了。', d: { w: 0.03, m: 0.04, s: 0.04 } }
      ]
    }
  };

  /* 闲聊分支对话：每个话题带可选回答 */
  const CHAT = {
    '书': {
      text: '你手上这本，还合你的意吗？',
      options: [
        { label: '很不错', text: '那便好。好书遇对人，是彼此的运气。' },
        { label: '一般般', text: '无妨。读不下去就换一本，书斋里不缺书。' },
        { label: '太难读了', text: '难读的书，读一点也有一点的好。歇歇再试。' }
      ]
    },
    '你': {
      text: '我？我只是个守卷人，整天跟字打交道。',
      options: [
        { label: '你最喜欢哪本', text: '《雨停之前》吧，雨停之后那句，我念过很多遍。' },
        { label: '你累不累', text: '守着书，不累。偶尔打个盹。' },
        { label: '你多大了', text: '我比这书斋里任何一本书都老，也永远年轻。' }
      ]
    },
    '茶': {
      text: '要不要来盏茶？我这儿有，只是不知合不合你口。',
      options: [
        { label: '来一盏', text: '好。茶是热的，书也是热的。' },
        { label: '不用了', text: '好。等你渴了再说。' }
      ]
    }
  };

  function rndOf(rnd) {
    return typeof rnd === 'function' ? Number(rnd()) : Math.random();
  }

  /* 变量替换 {title}/{chapter}/{chapters}/{pct}/{name} */
  function fill(text, ctx) {
    const c = ctx || {};
    return String(text || '')
      .replace(/\{title\}/g, String(c.title || ''))
      .replace(/\{chapter\}/g, String(c.chapter == null ? '' : c.chapter))
      .replace(/\{chapters\}/g, String(c.chapters == null ? '' : c.chapters))
      .replace(/\{pct\}/g, String(c.pct == null ? '' : c.pct))
      .replace(/\{name\}/g, NAME);
  }

  /* 归一化状态（缺字段补默认；mood/flags/history 深拷贝，保证纯函数不改入参） */
  function normalizeState(state) {
    const d = defaultState();
    const s = Object.assign({}, d, state || {});
    s.id = 'main';
    s.name = NAME;
    s.mood = Object.assign({}, d.mood, (state && state.mood) || {});
    s.flags = {};
    const srcFlags = (state && state.flags) || {};
    for (const k in srcFlags) {
      const f = srcFlags[k] || {};
      s.flags[k] = { count: f.count || 0, lastAt: f.lastAt || 0, lastIdx: f.lastIdx == null ? -1 : f.lastIdx };
    }
    s.history = Array.isArray(s.history) ? s.history.slice() : [];
    s.affinity = Math.max(0, Math.min(100, Number(s.affinity) || 0));
    return s;
  }

  /* 按场景挑一句反馈，避开同场景上一条（至少两条才避）。纯读，不改状态。
     返回 { scene, idx, text, moodDelta, affinityDelta }，调用方用 applyDelta 写回。 */
  function pick(scene, state, ctx, rnd) {
    const s = normalizeState(state);
    const sc = SCENES[scene] || SCENES['idle-chat'];
    const pool = sc.pool;
    const flag = s.flags[scene] || { count: 0, lastAt: 0, lastIdx: -1 };
    let idx = Math.floor(rndOf(rnd) * pool.length);
    if (pool.length > 1 && idx === flag.lastIdx) idx = (idx + 1) % pool.length;
    const item = pool[idx];
    return {
      scene: scene,
      idx: idx,
      text: fill(item.t, ctx),
      moodDelta: item.d || {},
      affinityDelta: AFF[scene] !== undefined ? AFF[scene] : 2
    };
  }

  /* 随机/指定话题闲聊：返回 { scene, text, options:[{label,text}], moodDelta, affinityDelta } */
  function chat(topic, state, rnd) {
    const keys = Object.keys(CHAT);
    const key = CHAT[topic] ? topic : keys[Math.floor(rndOf(rnd) * keys.length)];
    const c = CHAT[key];
    return {
      scene: 'idle-chat',
      text: fill(c.text, {}),
      options: c.options.map((o) => ({ label: o.label, text: fill(o.text, {}) })),
      moodDelta: { w: 0.02, m: 0.03, s: 0 },
      affinityDelta: AFF['idle-chat']
    };
  }

  /* 把一次反馈的增量写回状态，返回新状态（不改入参） */
  function applyDelta(state, res) {
    const s = normalizeState(state);
    const m = s.mood;
    const d = res.moodDelta || {};
    m.warmth = clamp01(m.warmth + (d.w || 0));
    m.mischief = clamp01(m.mischief + (d.m || 0));
    m.solemnity = clamp01(m.solemnity + (d.s || 0));
    s.affinity = Math.max(0, Math.min(100, s.affinity + (res.affinityDelta || 0)));
    const scene = res.scene || 'idle-chat';
    const flag = s.flags[scene] || (s.flags[scene] = { count: 0, lastAt: 0, lastIdx: -1 });
    flag.count = (flag.count || 0) + 1;
    flag.lastAt = Date.now();
    if (typeof res.idx === 'number') flag.lastIdx = res.idx;
    s.history.push({ at: Date.now(), scene: scene, text: res.text });
    if (s.history.length > 20) s.history = s.history.slice(-20);
    s.updatedAt = Date.now();
    return s;
  }

  const Companion = { NAME, defaultState, normalizeState, pick, chat, applyDelta, SCENES, CHAT };

  if (typeof module !== 'undefined' && module.exports) module.exports = Companion;
  if (root) { root.XR = root.XR || {}; root.XR.Companion = Companion; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

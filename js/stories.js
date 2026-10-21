/* ============================================================
   stories.js — 分支剧情（番外 / 正文分支）的数据模型与纯逻辑
   scope: 'extra'=番外(独立篇章)；'branch'=正文分支(附着主线某句后)
   纯函数，不碰 DOM，可单测。
   ============================================================ */
(function (root) {
  'use strict';

  function uid() {
    const c = root && root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function now() {
    return Date.now();
  }

  /* 归一化一个选项：{ label, goto:'resume'|'chapter'|'story', target }
     resume=回主线/继续；chapter=跳主章节(target=章号)；story=进入另一分支(target=storyId) */
  function normalizeOption(opt) {
    const o = Object.assign({}, opt || {});
    o.label = String(o.label || '继续');
    o.goto = ['resume', 'chapter', 'story'].indexOf(o.goto) >= 0 ? o.goto : 'resume';
    o.target = o.target == null ? null : o.target;
    return o;
  }

  /* 归一化一条剧情，补默认字段，返回干净可落库的实体 */
  function normalizeStory(s) {
    const o = Object.assign({}, s || {});
    o.id = o.id || uid();
    o.bookId = o.bookId || '';
    o.scope = o.scope === 'branch' ? 'branch' : 'extra';
    o.parentChapterIndex = Math.max(0, Math.round(Number(o.parentChapterIndex) || 0));
    o.parentIndex = Math.max(-1, Math.round(Number(o.parentIndex) || -1));
    o.title = String(o.title || '未命名番外');
    o.text = String(o.text || '');
    o.options = Array.isArray(o.options) ? o.options.map(normalizeOption) : [];
    o.engine = ['offline', 'llm', 'local'].indexOf(o.engine) >= 0 ? o.engine : 'offline';
    o.prompt = String(o.prompt || '');
    o.createdAt = Number(o.createdAt) || now();
    o.updatedAt = Number(o.updatedAt) || o.createdAt;
    o.schemaVer = 1;
    return o;
  }

  /* 把「选择节拍」插入 beats 数组（返回新数组，不改入参）。
     hooks = [{ index, storyId, options:[{label,goto,target}] }]
     index 指向“那句之后”，选择节拍插到 index+1 处。 */
  function attachChoices(beats, hooks) {
    const list = Array.isArray(beats) ? beats : [];
    const hs = Array.isArray(hooks) ? hooks : [];
    if (!hs.length) return list.slice();
    const out = list.slice();
    const sorted = hs.slice().sort((a, b) => (b.index || 0) - (a.index || 0));
    for (const h of sorted) {
      const at = Math.max(0, Math.min(Math.round(Number(h.index) || 0) + 1, out.length));
      out.splice(at, 0, {
        kind: 'choice',
        storyId: h.storyId,
        options: (Array.isArray(h.options) ? h.options : []).map(normalizeOption)
      });
    }
    return out;
  }

  /* 收集某章应注入的“入口选择”钩子：branch 剧情附着在 (chapter, index) 处。
     每个钩子的选项 = [ 走进岔路(进入该分支) , 继续读正文(跳过) ] */
  function hooksForChapter(stories, chapterIndex) {
    const out = [];
    for (const s of (Array.isArray(stories) ? stories : [])) {
      if (!s || s.scope !== 'branch') continue;
      if (Number(s.parentChapterIndex) !== Number(chapterIndex)) continue;
      out.push({
        index: Math.max(0, Math.round(Number(s.parentIndex) || 0)),
        storyId: s.id,
        options: [
          { label: '走进岔路 · ' + (s.title || '未命名'), goto: 'story', target: s.id },
          { label: '继续读正文', goto: 'resume', target: null }
        ]
      });
    }
    return out;
  }

  const Stories = { uid, now, normalizeStory, normalizeOption, attachChoices, hooksForChapter };

  if (typeof module !== 'undefined' && module.exports) module.exports = Stories;
  if (root) { root.XR = root.XR || {}; root.XR.Stories = Stories; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

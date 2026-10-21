/* ============================================================
   generator.js — 可插拔剧情生成器
   backend: offline(默认,零依赖) | llm(外部 OpenAI 兼容) | local(本地 LLM)
   核心逻辑纯函数 + fetch 注入可测；offline 纯函数确定性可测。
   ============================================================ */
(function (root) {
  'use strict';

  function rndOf(rnd) {
    return typeof rnd === 'function' ? rnd : Math.random;
  }

  /* 离线模板生成兜底：基于书名/章节/要求 + 模板，拼一段番外续写 + 结尾选项。
     纯函数，rnd 注入保证确定性。 */
  function offline(input, rnd) {
    const i = input || {};
    const r = rndOf(rnd);
    const title = String(i.title || i.bookTitle || '这本书');
    const prompt = String(i.prompt || '').trim();

    const openings = [
      '那之后，日子照旧。只是谁也没再提起那天夜里的事。',
      '很久以后，有人又翻开了这一页。',
      '故事之外，还有一扇没被推开的门。'
    ];
    const middles = [
      '风吹过来的时候，仿佛一切都可以重来。',
      '灯下，影子拉得很长。',
      '远处传来很轻的一声响，像谁在唤一个旧名字。',
      '他停在原地，等了等，才继续往前走。'
    ];
    const endings = [
      '于是这一段，也就这样悄悄收了尾。',
      '那个人转过身，走进了更深的夜里。',
      '而书页，还停在那一句。'
    ];

    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const paras = [pick(openings)];
    if (prompt) paras.push('你想起「' + prompt + '」，于是故事顺着这个念头往下走。');
    paras.push(pick(middles));
    if (r() < 0.6) paras.push(pick(middles));
    paras.push(pick(endings));

    const short = prompt ? prompt.slice(0, 12) : (title.slice(0, 10) + ' · 番外');
    return {
      title: (short || '番外') + (prompt ? '…' : ''),
      text: paras.join('\n'),
      options: [{ label: '回到主线', goto: 'resume', target: null }],
      engine: 'offline'
    };
  }

  /* 构造 OpenAI 兼容 /chat/completions 的 url/headers/body（纯函数） */
  function buildLLMPayload(input, settings) {
    const s = settings || {};
    const backend = s.backend === 'local' ? 'local' : 'llm';
    const cfg = backend === 'local' ? (s.local || {}) : (s.llm || {});
    const baseURL = String(cfg.baseURL || '').replace(/\/+$/, '');
    const model = String(cfg.model || 'gpt-3.5-turbo');
    const apiKey = backend === 'local' ? '' : String(cfg.apiKey || '');

    const system = '你是「字流」互动阅读器的剧情续写助手。请基于给定的书名、章节与上下文，写一段克制、贴合原文文风的分支剧情（番外或正文分支），结尾给出 1~3 个选项。只输出 JSON，不要解释：{"title":"...","text":"...","options":[{"label":"...","goto":"resume|chapter|story","target":null}]}。goto 含义：resume=回主线，chapter=跳主章节(整数章号)，story=进入另一分支。';
    const user = [
      '书名：' + (input.title || ''),
      '章节：第 ' + (input.chapter == null ? 1 : input.chapter) + ' 章',
      '风格：' + (s.style || '克制'),
      '要求：' + (input.prompt || ''),
      '上下文（节选）：' + String(input.context || '').slice(0, 800)
    ].join('\n');

    const body = {
      model: model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: Math.max(100, Math.round(Number(s.maxTokens) || 1200)),
      temperature: 0.8
    };

    const url = baseURL ? (baseURL + '/chat/completions') : 'https://api.openai.com/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    return { url, headers, body };
  }

  /* 解析 LLM 返回文本里的 JSON（剥代码围栏，找首尾大括号） */
  function parseLLMResult(content, backend) {
    let s = String(content || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        const obj = JSON.parse(s.slice(a, b + 1));
        return {
          title: String(obj.title || '番外'),
          text: String(obj.text || ''),
          options: Array.isArray(obj.options) ? obj.options : [{ label: '回到主线', goto: 'resume', target: null }],
          engine: backend
        };
      } catch (e) { /* 落到兜底 */ }
    }
    return {
      title: '番外',
      text: s,
      options: [{ label: '回到主线', goto: 'resume', target: null }],
      engine: backend
    };
  }

  /* 统一入口：按 settings.backend 选择后端。
     input = { title, chapter, context, prompt, scope }
     deps = { fetch, rnd }（注入，便于测试） */
  async function generate(input, settings, deps) {
    const s = settings || {};
    const backend = s.backend === 'local' ? 'local' : (s.backend === 'llm' ? 'llm' : 'offline');
    if (backend === 'offline') {
      return offline(input, deps && deps.rnd);
    }
    const payload = buildLLMPayload(input, s);
    const fetchFn = (deps && deps.fetch) || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) throw new Error('当前环境不支持网络请求');
    const resp = await fetchFn(payload.url, {
      method: 'POST',
      headers: payload.headers,
      body: JSON.stringify(payload.body)
    });
    if (!resp.ok) {
      let txt = '';
      try { txt = await resp.text(); } catch (e) { /* ignore */ }
      throw new Error('生成失败（HTTP ' + resp.status + '）：' + String(txt).slice(0, 200));
    }
    const data = await resp.json();
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return parseLLMResult(content, backend);
  }

  const Generator = { offline, buildLLMPayload, parseLLMResult, generate };

  if (typeof module !== 'undefined' && module.exports) module.exports = Generator;
  if (root) { root.XR = root.XR || {}; root.XR.Generator = Generator; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

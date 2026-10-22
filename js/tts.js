/* ============================================================
   tts.js — 本地朗读（Web Speech API，完全离线、不联网）
   · 纯函数：normalize / chunk / pickVoice —— 可单测
   · 浏览器：speak / pause / resume / stop，事件走 on()
   没有 speechSynthesis 的环境（部分 Linux、file:// 极少数情况）
   supported() 返回 false，界面会给出提示而不是报错。
   ============================================================ */
(function (root) {
  'use strict';
  const XR = (root.XR = root.XR || {});

  const synth = typeof root.speechSynthesis !== 'undefined' ? root.speechSynthesis : null;
  const Utter = typeof root.SpeechSynthesisUtterance !== 'undefined' ? root.SpeechSynthesisUtterance : null;

  const listeners = { start: [], end: [], error: [], pause: [], resume: [] };
  let current = null;
  let paused = false;

  /* 朗读前的清理：去掉引擎塞进去的标记、合并空白、别读成一长串 */
  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/\u0001[^\u0001]*\u0001/g, '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
  }

  /* 长句切块：先按句末标点，再按逗号，实在不行硬切。
     浏览器对超长 utterance 会整段哑掉，切小块更稳。 */
  function chunk(text, max) {
    const cap = Math.max(40, Number(max) || 180);
    const s = normalize(text);
    if (!s) return [];
    const parts = s.split(/(?<=[。！？!?…；;\.])\s*/).filter(Boolean);
    const out = [];
    let buf = '';
    const push = (piece) => {
      if (piece.length <= cap) { out.push(piece); return; }
      let rest = piece;
      while (rest.length > cap) {
        let cut = -1;
        for (let i = cap; i > cap * 0.5; i--) {
          if (/[，,、：:\s]/.test(rest[i] || '')) { cut = i + 1; break; }
        }
        if (cut < 0) cut = cap;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      if (rest) out.push(rest);
    };
    for (const p of parts) {
      if (buf && buf.length + p.length > cap) { push(buf); buf = ''; }
      buf += p;
      if (buf.length >= cap) { push(buf); buf = ''; }
    }
    if (buf) push(buf);
    return out.filter((x) => x.trim());
  }

  function supported() {
    return !!(synth && Utter);
  }

  function voices() {
    if (!synth) return [];
    try { return synth.getVoices() || []; } catch (e) { return []; }
  }

  /* 按 voiceURI 找音色；找不到就挑一个匹配语言的，再不行用系统默认 */
  function pickVoice(list, uri, lang) {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return null;
    if (uri) {
      const hit = arr.find((v) => v.voiceURI === uri || v.name === uri);
      if (hit) return hit;
    }
    const want = String(lang || '').toLowerCase();
    if (want) {
      const byLang = arr.find((v) => String(v.lang || '').toLowerCase() === want) ||
        arr.find((v) => String(v.lang || '').toLowerCase().indexOf(want.slice(0, 2)) === 0);
      if (byLang) return byLang;
    }
    return arr.find((v) => /zh|cmn/i.test(v.lang || '')) || arr[0];
  }

  function emit(evt, payload) {
    for (const fn of (listeners[evt] || [])) {
      try { fn(payload); } catch (e) { /* 监听方自己的错不打断朗读 */ }
    }
  }

  function stop() {
    paused = false;
    current = null;
    if (!synth) return;
    try { synth.cancel(); } catch (e) { /* ignore */ }
  }

  function pause() {
    if (!synth) return;
    try { synth.pause(); paused = true; emit('pause'); } catch (e) { /* ignore */ }
  }

  function resume() {
    if (!synth) return;
    try { synth.resume(); paused = false; emit('resume'); } catch (e) { /* ignore */ }
  }

  /* 读一段。opts: { rate, pitch, volume, voice, lang, tag }
     tag 会原样回传给 end 事件，界面用它知道读到哪一句了。 */
  function speak(text, opts) {
    const o = opts || {};
    if (!supported()) { emit('error', { error: 'unsupported' }); return false; }
    const body = normalize(text);
    if (!body) { emit('end', { tag: o.tag, empty: true }); return false; }
    try { synth.cancel(); } catch (e) { /* ignore */ }
    const u = new Utter(body);
    u.lang = o.lang || 'zh-CN';
    u.rate = Math.max(0.5, Math.min(2.5, Number(o.rate) || 1));
    u.pitch = Math.max(0, Math.min(2, Number(o.pitch) || 1));
    u.volume = Math.max(0, Math.min(1, o.volume == null ? 1 : Number(o.volume)));
    const v = pickVoice(voices(), o.voice, u.lang);
    if (v) u.voice = v;
    u.onstart = () => { paused = false; emit('start', { tag: o.tag }); };
    u.onend = () => { current = null; emit('end', { tag: o.tag }); };
    u.onerror = (e) => {
      const err = (e && e.error) || 'error';
      // 用户自己 cancel 时浏览器也会报 interrupted，不算错
      if (err === 'interrupted' || err === 'canceled') return;
      current = null;
      emit('error', { error: err, tag: o.tag });
    };
    current = u;
    synth.speak(u);
    return true;
  }

  function on(evt, fn) {
    if (!listeners[evt] || typeof fn !== 'function') return () => {};
    listeners[evt].push(fn);
    return () => {
      const i = listeners[evt].indexOf(fn);
      if (i >= 0) listeners[evt].splice(i, 1);
    };
  }

  const Tts = {
    supported, voices, pickVoice, normalize, chunk,
    speak, pause, resume, stop, on,
    get speaking() { return !!current; },
    get paused() { return paused; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Tts;
  if (root) root.XR.Tts = Tts;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================================
   zip.js — 极简 ZIP 读取器（只为读 EPUB，无第三方依赖）
   只支持“存储(0)”与“deflate(8)”两种压缩方式，足够覆盖 EPUB。
   依赖浏览器原生的 DecompressionStream('deflate-raw')。
   ============================================================ */
(function () {
  'use strict';
  const XR = (window.XR = window.XR || {});

  const SIG_EOCD = 0x06054b50; // 中央目录结束
  const SIG_CEN  = 0x02014b50; // 中央目录条目
  const SIG_LOC  = 0x04034b50; // 本地文件头

  function decodeName(bytes) {
    let s = '';
    try { s = new TextDecoder('utf-8').decode(bytes); } catch (e) { s = ''; }
    if (!s || s.indexOf('\uFFFD') >= 0) {
      try { s = new TextDecoder('gb18030').decode(bytes); } catch (e) { /* keep */ }
    }
    return s;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解压（需要 DecompressionStream），请改用新版 Chrome / Edge / Firefox / Safari。');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  /**
   * 打开一个 ZIP/EPUB。
   * @returns {Promise<{ names:string[], has(n):boolean, bytes(n):Promise<Uint8Array>, text(n):Promise<string> }>}
   */
  async function open(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = bytes.length;

    if (len < 22) throw new Error('文件太小，不是有效的 EPUB。');

    // 从尾部往前找 EOCD（最多回退 64KB，兼容带注释的 zip）
    let eocd = -1;
    const floor = Math.max(0, len - 66000);
    for (let i = len - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('这不是一个 ZIP/EPUB 文件（找不到中央目录）。');

    const count = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    let cdOffset = view.getUint32(eocd + 16, true);

    if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      throw new Error('这是 ZIP64 格式，暂时不支持。请用 calibre 另存为标准 EPUB。');
    }
    if (cdOffset + cdSize > len) {
      // 有些工具会写错偏移，尝试用 eocd 位置反推
      cdOffset = eocd - cdSize;
      if (cdOffset < 0) throw new Error('ZIP 中央目录损坏。');
    }

    /** @type {Map<string, {method:number, size:number, offset:number, flags:number, name:string}>} */
    const entries = new Map();
    const order = [];
    let p = cdOffset;

    for (let i = 0; i < count; i++) {
      if (p + 46 > len || view.getUint32(p, true) !== SIG_CEN) break;
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const rawSize = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOff = view.getUint32(p + 42, true);
      const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen));

      const entry = { name, method, size: rawSize, compSize, offset: localOff, flags };
      entries.set(name, entry);
      order.push(name);
      p += 46 + nameLen + extraLen + commentLen;
    }

    if (!entries.size) throw new Error('ZIP 里没有任何文件。');

    function lookup(name) {
      if (entries.has(name)) return entries.get(name);
      const lc = name.toLowerCase();
      for (const [k, v] of entries) if (k.toLowerCase() === lc) return v;
      return null;
    }

    async function readEntry(entry) {
      if (entry.flags & 1) throw new Error('文件被加密（带密码）的 EPUB 读不了：' + entry.name);
      const lh = entry.offset;
      if (lh + 30 > len || view.getUint32(lh, true) !== SIG_LOC) {
        throw new Error('ZIP 本地文件头损坏：' + entry.name);
      }
      const nameLen = view.getUint16(lh + 26, true);
      const extraLen = view.getUint16(lh + 28, true);
      const start = lh + 30 + nameLen + extraLen;
      const comp = bytes.subarray(start, start + entry.compSize);
      if (entry.method === 0) return comp.slice();
      if (entry.method === 8) return inflateRaw(comp);
      throw new Error('不支持的压缩方式 ' + entry.method + '：' + entry.name);
    }

    return {
      names: order.slice(),
      has(name) { return !!lookup(name); },
      async bytes(name) {
        const e = lookup(name);
        if (!e) throw new Error('EPUB 里找不到文件：' + name);
        return readEntry(e);
      },
      async text(name) {
        const b = await this.bytes(name);
        return new TextDecoder('utf-8').decode(b).replace(/^\uFEFF/, '');
      }
    };
  }

  XR.Zip = { open };
  if (typeof module !== 'undefined' && module.exports) module.exports = XR.Zip;
})();

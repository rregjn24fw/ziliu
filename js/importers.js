/* ============================================================
   importers.js — TXT / EPUB 解析
   输出统一的 Book 结构：
   { id, title, author, source, addedAt, stats:{chars,images}, chapters:[{title,text}] }
   text 里用 \u0001IMG:路径\u0001 表示“这里有一张图”，保证图文顺序不乱。
   ============================================================ */
(function () {
  'use strict';
  const XR = (window.XR = window.XR || {});

  const CH_HEAD = /^\s*(?:正文\s*)?(?:第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*[章节回卷部篇集幕话折]|序章|序言|楔子|引子|前言|尾声|后记|终章|番外|Chapter\s+[0-9IVXLCivxlc]+|CHAPTER\s+[0-9IVXLCivxlc]+)\s*[.、:：·\-—－]?\s*(.*)$/;
  const NUM_HEAD = /^\s*([0-9]{1,4})\s*[.、·]\s*(\S.{0,20})$/;
  const EN_HEAD = /^\s*(chapter|part|book|volume|section|day|episode|act|prologue|epilogue|introduction|preface|afterword|interlude)\b[\s:.\-–—]*(?:[0-9]{1,4}|[ivxlc]{1,6}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)?[\s:.\-–—]*.{0,28}$/i;

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 有字的字符数（中英文都算）：判断“这一章是不是空的”用它
  function textCount(s) {
    const m = String(s).match(/[A-Za-z0-9\u00c0-\u024f\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g);
    return m ? m.length : 0;
  }
  // 老的接口名，留着别的地方还在用
  const cjkCount = textCount;

  /* ---------------- 编码探测 ---------------- */
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length === 0) return '';
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
      try { return new TextDecoder('gb18030').decode(u8); } catch (e2) { /* fallthrough */ }
      try { return new TextDecoder('big5').decode(u8); } catch (e3) { /* fallthrough */ }
      return new TextDecoder('utf-8').decode(u8);
    }
  }

  /* ---------------- 文本整形 ---------------- */
  function tidyLine(s) {
    return String(s)
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/^[\s\u3000]+/, '')
      .replace(/[\s\u3000]+$/, '');
  }

  function isHeading(line) {
    if (!line) return false;
    const t = line.trim();
    if (!t || t.length > 40) return false;
    if (/[。！？…]/.test(t)) return false;
    const m = CH_HEAD.exec(t);
    if (m) return true;
    if (EN_HEAD.test(t) && t.length <= 30) return true;
    if (/^(Chapter|CHAPTER)\s+\d+/i.test(t)) return true;
    const n = NUM_HEAD.exec(t);
    if (n && t.length <= 24) return true;
    // 全大写短行（英文小说的章节名常常整行大写）
    if (/^[A-Z0-9 '’.,\-–—:&!?]{3,32}$/.test(t) && /[A-Z]{2,}/.test(t)) return true;
    return false;
  }

  function isLatinHeavy(s) {
    const lat = (String(s).match(/[A-Za-z]/g) || []).length;
    if (lat < 30) return false;
    const cjk = (String(s).match(/[\u3400-\u9fff]/g) || []).length;
    return lat > cjk * 4;
  }

  /* ---------------- TXT ---------------- */
  function parseTxt(text, filename) {
    const clean = String(text).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    let lines = clean.split('\n').map(tidyLine);

    // 极端情况：整本书一行到底 → 按句子重排成几百字左右的段落
    if (lines.filter((l) => l.length > 0).length <= 2 && clean.length > 800) {
      const latin = isLatinHeavy(clean);
      const rebuilt = [];
      let buf = '';
      const parts = latin ? clean.split(/(?<=[.!?][”"’]?)\s+/) : clean.split(/(?<=[。！？…」』])/);
      for (const ch of parts) {
        buf += ch + (latin && !/\s$/.test(ch) ? ' ' : '');
        if (buf.length >= 420) { rebuilt.push(buf.trim()); buf = ''; }
      }
      if (buf.trim()) rebuilt.push(buf.trim());
      lines = rebuilt;
    }

    /** @type {{title:string, lines:string[]}[]} */
    const chapters = [];
    let cur = null;

    for (const line of lines) {
      if (isHeading(line)) {
        const title = line.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
        cur = { title, lines: [] };
        chapters.push(cur);
        continue;
      }
      if (!cur) {
        cur = { title: '', lines: [] };
        chapters.push(cur);
      }
      if (line) cur.lines.push(line);
    }

    let out = chapters
      .map((c) => ({ title: c.title, text: c.lines.join('\n') }))
      .filter((c) => textCount(c.text) > 0);

    if (!out.length) throw new Error('这个 txt 里没读到正文内容。');

    // 没有识别到任何章节标题 → 按字数切块
    if (out.length === 1 && !isHeading(out[0].title)) {
      const paras = out[0].text.split('\n');
      const chunk = isLatinHeavy(out[0].text) ? 9000 : 5200;
      const chunks = [];
      let buf = [];
      let size = 0;
      for (const p of paras) {
        buf.push(p); size += p.length;
        if (size >= chunk) { chunks.push(buf.join('\n')); buf = []; size = 0; }
      }
      if (buf.length) chunks.push(buf.join('\n'));
      out = chunks.map((t, i) => ({ title: '第 ' + (i + 1) + ' 部分', text: t }));
    }

    // 去掉开头的空章（书名页之类）
    out = out.filter((c, i) => c.text.length > 0 || i === 0);

    const bookTitle = baseName(filename) || '未命名';
    const all = out.map((c) => c.text).join('\n');
    const lang = isLatinHeavy(all) ? 'latin' : 'cjk';
    const stats = {
      chars: out.reduce((a, c) => a + textCount(c.text), 0),
      words: lang === 'latin' ? (all.match(/[A-Za-z][A-Za-z'’\-]*/g) || []).length : 0,
      lang
    };
    return { title: bookTitle, author: '', source: 'txt', chapters: out, stats };
  }

  /* ---------------- 相对路径 ---------------- */
  function dirname(p) {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i + 1);
  }
  function resolvePath(baseDir, href) {
    let h = String(href || '').split('#')[0].split('?')[0];
    try { h = decodeURIComponent(h); } catch (e) { /* keep */ }
    if (/^[a-z]+:\/\//i.test(h) || h.startsWith('/')) return h.replace(/^\//, '');
    const parts = (baseDir + h).split('/');
    const stack = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return stack.join('/');
  }

  function findByLocal(root, local) {
    const out = [];
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].localName === local || all[i].nodeName === local) out.push(all[i]);
    }
    return out;
  }

  function parseXML(str) {
    const doc = new DOMParser().parseFromString(str, 'application/xml');
    const bad = doc.getElementsByTagName('parsererror');
    if (bad && bad.length) {
      const d2 = new DOMParser().parseFromString(str, 'text/html');
      return d2.body || null;
    }
    return doc;
  }

  /* ---------------- HTML → 段落 ---------------- */
  const BLOCK_SEL = 'p,div,section,article,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,td,dd,dt,figcaption,header,footer,aside';
  const SKIP_SEL = 'script,style,noscript,math,iframe,embed,audio,video,canvas,nav';
  const IMG_MARK = '\u0001IMG:';
  const IMG_RE = /^\u0001IMG:(.+)\u0001$/;
  const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

  function attrNS(el, name) {
    const v = el.getAttribute ? el.getAttribute(name) : '';
    if (v) return v;
    if (el.getAttributeNS) {
      try {
        const x = el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (x) return x;
      } catch (e) { /* ignore */ }
    }
    return '';
  }

  // <img src>、SVG 里的 <image xlink:href>、<object data> 都算图
  function srcOf(el) {
    const local = (el.localName || el.nodeName || '').toLowerCase();
    let src = '';
    if (local === 'object') src = attrNS(el, 'data');
    if (!src) src = attrNS(el, 'src');
    if (!src) src = attrNS(el, 'xlink:href');
    if (!src) src = attrNS(el, 'href');
    if (!src) src = attrNS(el, 'data-src');
    src = String(src || '').trim();
    if (!src) return '';
    if (/^data:image\//i.test(src)) return src;
    if (local === 'object' && !IMG_EXT.test(src)) return '';
    return src;
  }

  function htmlToParagraphs(html) {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');

    /* 先把图片换成独占一行的标记，再删别的节点 ——
       顺序反了的话，<svg> 被整个删掉，包在里面的 <image> 就跟着没了。 */
    let imageCount = 0;
    let nodes = Array.prototype.slice.call(doc.querySelectorAll('img, image, object'));
    if (!nodes.length) {
      nodes = Array.prototype.slice.call(doc.getElementsByTagName('image'));
    }
    for (const node of nodes) {
      if (!node.isConnected) continue;
      const src = srcOf(node);
      let host = node;
      // 图被 <svg> 包着就替换整个 <svg>，不然标记会随 svg 一起被删
      let svg = null;
      try { svg = node.closest ? node.closest('svg') : null; } catch (e) { svg = null; }
      if (svg && doc.body && doc.body.contains(svg)) host = svg;
      if (!src) { host.remove(); continue; }
      host.replaceWith(doc.createTextNode('\n' + IMG_MARK + src + '\u0001\n'));
      imageCount++;
    }

    doc.querySelectorAll(SKIP_SEL + ',svg').forEach((n) => n.remove());

    doc.querySelectorAll('br').forEach((br) => br.replaceWith(doc.createTextNode('\n')));
    const body = doc.body || doc.documentElement;
    if (!body) return { paragraphs: [], titleHint: '', imageCount: 0 };
    body.querySelectorAll(BLOCK_SEL).forEach((el) => el.appendChild(doc.createTextNode('\n')));

    let titleHint = '';
    const h = body.querySelector('h1, h2, h3');
    if (h) titleHint = tidyLine(h.textContent);

    const raw = body.textContent || '';
    const paragraphs = raw
      .split('\n')
      .map(tidyLine)
      .filter((s) => s && !/^[\s·•\-—_=*]+$/.test(s));

    return { paragraphs, titleHint, imageCount };
  }

  /* ---------------- 图片 → data URL ---------------- */
  const MIME_BY_EXT = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif'
  };
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;      // 单张上限
  const MAX_IMAGES_TOTAL = 64 * 1024 * 1024;     // 全书上限
  const SHRINK_OVER = 700 * 1024;                // 超过这个大小就压一下
  const MAX_WIDTH = 1400;

  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  // 大图压小一点，不然一本书的图能把浏览器存储撑爆（插画书尤其需要）
  async function shrinkImage(dataUrl) {
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return dataUrl;
    try {
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return dataUrl;
      const head = dataUrl.slice(0, comma);
      const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
      if (/svg/i.test(mime)) return dataUrl;
      const bin = atob(dataUrl.slice(comma + 1));
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const blob = new Blob([u8], { type: mime });
      const bmp = await createImageBitmap(blob);
      const w0 = bmp.width || MAX_WIDTH;
      const scale = Math.min(1, MAX_WIDTH / w0);
      if (scale >= 1 && u8.length < 2.4 * 1024 * 1024) {
        if (bmp.close) bmp.close();
        return dataUrl;
      }
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round((bmp.height || w0) * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      cx.drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      let out = cv.toDataURL('image/webp', 0.86);
      if (!out || out.length >= dataUrl.length) out = cv.toDataURL('image/jpeg', 0.85);
      return (out && out.length < dataUrl.length) ? out : dataUrl;
    } catch (e) {
      return dataUrl;
    }
  }

  function findImagePath(zip, relPath) {
    if (zip.has(relPath)) return relPath;
    const want = relPath.replace(/^\.?\//, '').toLowerCase();
    const base = want.split('/').pop();
    let byBase = '';
    for (const n of zip.names) {
      const nn = n.toLowerCase();
      if (nn === want) return n;
      if (!byBase && nn.split('/').pop() === base) byBase = n;
    }
    return byBase;
  }

  async function loadImage(zip, relPath) {
    const real = findImagePath(zip, relPath);
    if (!real) return null;
    let bytes;
    try { bytes = await zip.bytes(real); } catch (e) { return null; }
    if (!bytes || !bytes.length) return null;
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    const ext = (real.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'image/png';
    let url;
    try {
      url = 'data:' + mime + ';base64,' + bytesToBase64(bytes);
    } catch (e) {
      return null;
    }
    if (bytes.length > SHRINK_OVER) url = await shrinkImage(url);
    return { url, size: bytes.length };
  }

  /* ---------------- EPUB ---------------- */
  async function parseEpub(buffer, filename, onProgress) {
    const zip = await XR.Zip.open(buffer);
    const say = (m) => { if (onProgress) onProgress(m); };

    say('解包 EPUB…');

    // container.xml
    let containerPath = 'META-INF/container.xml';
    if (!zip.has(containerPath)) {
      const alt = zip.names.find((n) => /container\.xml$/i.test(n));
      if (!alt) throw new Error('EPUB 缺少 META-INF/container.xml，可能不是标准 EPUB。');
      containerPath = alt;
    }
    const containerXml = await zip.text(containerPath);
    const cdoc = parseXML(containerXml);
    const rootfiles = cdoc ? findByLocal(cdoc, 'rootfile') : [];
    if (!rootfiles.length) throw new Error('EPUB 的 container.xml 里没有 rootfile。');
    const opfPath = rootfiles[0].getAttribute('full-path');
    if (!opfPath) throw new Error('EPUB 的 OPF 路径为空。');

    const opfXml = await zip.text(opfPath);
    const opfDir = dirname(opfPath);
    const opf = parseXML(opfXml);
    if (!opf) throw new Error('EPUB 的 OPF 解析失败。');

    // 元数据
    const titleNodes = findByLocal(opf, 'title');
    const creatorNodes = findByLocal(opf, 'creator');
    const metaTitle = titleNodes.length ? tidyLine(titleNodes[0].textContent) : '';
    const author = creatorNodes.length ? tidyLine(creatorNodes[0].textContent) : '';

    // manifest
    const manifest = new Map();
    for (const item of findByLocal(opf, 'item')) {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      if (!id || !href) continue;
      manifest.set(id, {
        href: resolvePath(opfDir, href),
        rawHref: href,
        type: item.getAttribute('media-type') || '',
        props: item.getAttribute('properties') || ''
      });
    }

    // spine
    const spine = [];
    for (const ref of findByLocal(opf, 'itemref')) {
      const idref = ref.getAttribute('idref');
      const it = manifest.get(idref);
      if (!it) continue;
      if (!/x?html|xml/i.test(it.type) && !/\.x?html?$/i.test(it.href)) continue;
      spine.push(it.href);
    }
    if (!spine.length) throw new Error('EPUB 的 spine 是空的，读不到正文。');

    // 目录（nav 或 ncx），用于章节名
    say('读取目录…');
    const toc = new Map();
    try {
      const navItem = [...manifest.values()].find((it) => /\bnav\b/.test(it.props));
      if (navItem) {
        const navHtml = await zip.text(navItem.href);
        const navDoc = new DOMParser().parseFromString(navHtml, 'text/html');
        const navDir = dirname(navItem.href);
        navDoc.querySelectorAll('nav a, a').forEach((a) => {
          const href = a.getAttribute('href');
          if (!href || /^https?:/i.test(href)) return;
          const key = resolvePath(navDir, href);
          const label = tidyLine(a.textContent);
          if (key && label && !toc.has(key)) toc.set(key, label);
        });
      }
      const ncxItem = [...manifest.values()].find((it) => /dtbncx/i.test(it.type)) ||
        [...manifest.values()].find((it) => /\.ncx$/i.test(it.href));
      if (ncxItem) {
        const ncxXml = await zip.text(ncxItem.href);
        const ncxDoc = parseXML(ncxXml);
        if (ncxDoc) {
          const ncxDir = dirname(ncxItem.href);
          for (const np of findByLocal(ncxDoc, 'navPoint')) {
            const labels = findByLocal(np, 'text');
            const contents = findByLocal(np, 'content');
            if (!labels.length || !contents.length) continue;
            const src = contents[0].getAttribute('src');
            if (!src) continue;
            const key = resolvePath(ncxDir, src);
            const label = tidyLine(labels[0].textContent);
            if (key && label && !toc.has(key)) toc.set(key, label);
          }
        }
      }
    } catch (e) { /* 目录读不到不影响正文 */ }

    // 正文
    const chapters = [];
    const seen = new Set();
    const wantedImages = new Set();
    const inlineImages = {};
    let i = 0;

    for (const path of spine) {
      i++;
      say('解析正文 ' + i + '/' + spine.length + '…');
      let html;
      try {
        const bytes = await zip.bytes(path);
        html = decodeText(bytes);
      } catch (e) {
        continue;
      }
      let parsed;
      try { parsed = htmlToParagraphs(html); } catch (e) { continue; }
      let { paragraphs, titleHint } = parsed;

      // 图片标记：相对路径 → zip 内绝对路径
      const htmlDir = dirname(path);
      const imgPaths = [];
      paragraphs = paragraphs.map((p) => {
        const m = IMG_RE.exec(p);
        if (!m) return p;
        const raw = m[1];
        if (/^data:image\//i.test(raw)) {
          const abs = 'inline/' + imgPaths.length + '@' + path;
          imgPaths.push(abs);
          inlineImages[abs] = raw;
          return IMG_MARK + abs + '\u0001';
        }
        const abs = resolvePath(htmlDir, raw);
        if (!abs) return '';
        imgPaths.push(abs);
        wantedImages.add(abs);
        return IMG_MARK + abs + '\u0001';
      }).filter(Boolean);

      const hasImage = imgPaths.length > 0;
      const bodyText = paragraphs.filter((p) => !IMG_RE.test(p)).join('\n');

      // 只有“既没字又没图”的文档才丢掉（封面页之类）
      if (textCount(bodyText) < 2 && !hasImage) continue;

      // 目录页：链接一大堆、正文没多少
      const linkCount = (html.match(/<a\s/gi) || []).length;
      if (linkCount > 12 && bodyText.length < 1800 && !hasImage) continue;

      let key = path;
      let title = toc.get(key) || '';
      if (!title) {
        // 有的 toc 带 # 锚点，逐条比对
        for (const [k, v] of toc) {
          if (k.split('#')[0] === path) { title = v; break; }
        }
      }
      if (!title) title = titleHint;
      if (!title) title = '第 ' + (chapters.length + 1) + ' 章';

      // 段落里如果第一行就是标题，去掉重复
      if (paragraphs.length > 1 && tidyLine(paragraphs[0]) === title) paragraphs = paragraphs.slice(1);

      const text = paragraphs.join('\n');
      const textOnly = paragraphs.filter((p) => !IMG_RE.test(p)).join('\n');
      if (textCount(textOnly) < 2 && !hasImage) continue;

      const dedupe = title + '|' + text.slice(0, 60);
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      chapters.push({ title, text });
    }

    if (!chapters.length) throw new Error('这个 EPUB 里没读到可用的正文（可能是图片版或加密的）。');

    // 正文里引用到的图片，转成 data URL 存起来
    const images = {};
    const zipImages = zip.names.filter((n) => IMG_EXT.test(n));
    let failed = 0;
    let bytesBudget = MAX_IMAGES_TOTAL;

    if (wantedImages.size) {
      say('读出 ' + wantedImages.size + ' 张图片…');
      for (const ip of wantedImages) {
        if (bytesBudget <= 0) break;
        if (inlineImages[ip]) {
          images[ip] = inlineImages[ip];
          bytesBudget -= inlineImages[ip].length;
          continue;
        }
        const got = await loadImage(zip, ip);
        if (!got) { failed++; continue; }
        bytesBudget -= got.size;
        images[ip] = got.url;
      }
    } else if (zipImages.length) {
      // 正文一张都没引用到，但包里明明有图 —— 自动收拢成一章，总比看不见强
      say('正文没引用图片，自动收拢 ' + zipImages.length + ' 张…');
      const sorted = zipImages.slice().sort();
      const gallery = [];
      for (const p of sorted) {
        if (gallery.length >= 24 || bytesBudget <= 0) break;
        const got = await loadImage(zip, p);
        if (!got) { failed++; continue; }
        bytesBudget -= got.size;
        images[p] = got.url;
        gallery.push(p);
      }
      if (gallery.length) {
        chapters.push({
          title: '插图（正文没有引用，自动收拢）',
          text: gallery.map((p) => IMG_MARK + p + '\u0001').join('\n')
        });
      }
    }

    const allText = chapters.map((c) => c.text).join('\n');
    const bookTitle = metaTitle || baseName(filename) || '未命名';
    const lang = isLatinHeavy(allText) ? 'latin' : 'cjk';
    const stats = {
      chars: chapters.reduce((a, c) => a + textCount(c.text.replace(new RegExp(IMG_MARK + '[^\\u0001]*\\u0001', 'g'), '')), 0),
      words: lang === 'latin' ? (allText.match(/[A-Za-z][A-Za-z'’\-]*/g) || []).length : 0,
      images: Object.keys(images).length,
      imageFiles: zipImages.length,
      failedImages: failed,
      lang
    };
    return { title: bookTitle, author, source: 'epub', chapters, stats, images };
  }

  /* ---------------- 入口 ---------------- */
  function baseName(name) {
    return String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }

  function looksLikeZip(buffer) {
    const u8 = new Uint8Array(buffer.slice(0, 4));
    return u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04;
  }

  async function fromFile(file, onProgress) {
    const buf = await file.arrayBuffer();
    const name = file.name || '未命名';
    const isEpub = /\.epub$/i.test(name) || looksLikeZip(buf);
    let parsed;
    if (isEpub) {
      parsed = await parseEpub(buf, name, onProgress);
    } else {
      if (onProgress) onProgress('读取文本…');
      parsed = parseTxt(decodeText(buf), name);
    }
    if (!parsed.chapters || !parsed.chapters.length) throw new Error('没解析出任何章节。');
    return {
      id: uid(),
      title: parsed.title || '未命名',
      author: parsed.author || '',
      source: parsed.source,
      addedAt: Date.now(),
      chapters: parsed.chapters,
      images: parsed.images || {},
      stats: parsed.stats || { chars: parsed.chapters.reduce((a, c) => a + textCount(c.text), 0) }
    };
  }

  XR.Import = { fromFile, parseTxt, parseEpub, decodeText, cjkCount, textCount, isHeading, htmlToParagraphs, uid };
})();

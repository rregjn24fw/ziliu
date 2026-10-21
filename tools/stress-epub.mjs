/* 生成一个“刁钻”的测试 EPUB：图片、超长段落、空章、只有图片的章……
   node tools/stress-epub.mjs  →  example/压力测试.epub */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ---------------- 极简 ZIP 写入 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    let method = 0;
    let comp = data;
    if (!f.store) {
      const z = zlib.deflateRawSync(data, { level: 9 });
      if (z.length < data.length) { method = 8; comp = z; }
    }
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ---------------- 素材 ---------------- */
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function svg(w, h, color, text) {
  return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="${color}"/>
  <text x="50%" y="50%" fill="#fff" font-size="20" text-anchor="middle" dominant-baseline="middle">${esc(text)}</text>
</svg>`;
}

const HUGE = '雨声从屋檐上落下来，落在青石板上，碎成一片细小的白。'.repeat(600); // 单个超长段落

const chapters = [
  { title: '第一章 普通的一章', body: `<p>便利店的自动门「叮咚」一声滑开，冷气涌出来。</p><p>「还开着？」他问。</p><p>「二十四小时。」我说。</p>` },
  { title: '第二章 一个超长段落', body: `<p>${esc(HUGE)}</p>` },
  { title: '第三章 只有一张图', body: `<p><img src="../images/pic1.svg" alt="一扇门"/></p>` },
  { title: '第四章 图文混排', body: `<p>墙上有东西在动。</p><p><img src="../images/pic2.svg" alt="影子"/></p><p>我停下来。影子比人先一步走到了巷子尽头。</p><p><img src="../images/pic3.svg" alt="门缝"/></p><p>门缝里透出光，暖黄的，像有人在里面煮汤。</p>` },
  { title: '第五章 两句话', body: `<p>雨停之前，她说了最后一句话。</p><p>我没有听清。</p>` },
  { title: '第六章 全是对话', body: `<p>「你来了。」</p><p>「我来了。」</p><p>「带了吗？」</p><p>「带了。」</p><p>「那就开始吧。」</p>` },
  { title: '第七章 又长又碎', body: Array.from({ length: 300 }, (_, i) => `<p>第 ${i + 1} 句。他往前走了半步，又停下来。</p>`).join('') },
  { title: '第八章 空白与特殊符号', body: `<p>&nbsp;</p><p>　</p><p>他笑了&nbsp;&nbsp;一下。</p><p>&amp;&lt;&gt;「引号」『双引号』</p><p></p>` },
  { title: '第九章 图片在开头', body: `<p><img src="../images/pic1.svg" alt="封面"/></p><p>门后是一条老街。卖馄饨的摊子，修表的铺子，挂灯笼的屋檐，全湿漉漉地亮着。</p>` },
  { title: '第十章 最后一章', body: `<p>然后我听见，身后那扇门，轻轻地合上了。</p>` }
];

const esc2 = (s) => s;
const pages = chapters.map((c, i) => ({
  name: `OEBPS/text/ch${i + 1}.xhtml`,
  id: `ch${i + 1}`,
  title: c.title,
  data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"><title>${esc(c.title)}</title></head>
<body>
  <h1>${esc(c.title)}</h1>
  ${c.body}
</body>
</html>`
}));

const navItems = pages.map((p) => `      <li><a href="text/${path.basename(p.name)}">${esc(p.title)}</a></li>`).join('\n');
const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"><title>目录</title></head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>
${navItems}
</ol></nav></body></html>`;

const manifest = pages.map((p) => `    <item id="${p.id}" href="text/${path.basename(p.name)}" media-type="application/xhtml+xml"/>`).join('\n') +
  '\n    <item id="i1" href="images/pic1.svg" media-type="image/svg+xml"/>' +
  '\n    <item id="i2" href="images/pic2.svg" media-type="image/svg+xml"/>' +
  '\n    <item id="i3" href="images/pic3.svg" media-type="image/svg+xml"/>';
const spine = pages.map((p) => `    <itemref idref="${p.id}"/>`).join('\n');

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:ziliu-stress-0001</dc:identifier>
    <dc:title>压力测试（10 章 · 带图）</dc:title>
    <dc:creator>字流 · 测试</dc:creator>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`;

const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const files = [
  { name: 'mimetype', data: 'application/epub+zip', store: true },
  { name: 'META-INF/container.xml', data: container },
  { name: 'OEBPS/content.opf', data: opf },
  { name: 'OEBPS/nav.xhtml', data: nav },
  { name: 'OEBPS/images/pic1.svg', data: svg(240, 160, '#b1532c', '门') },
  { name: 'OEBPS/images/pic2.svg', data: svg(240, 160, '#2f5d50', '影子') },
  { name: 'OEBPS/images/pic3.svg', data: svg(240, 160, '#6b5b95', '光') },
  ...pages.map((p) => ({ name: p.name, data: p.data }))
];

const outDir = path.resolve('example');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, '压力测试.epub');
fs.writeFileSync(out, makeZip(files));
console.log('written:', out, fs.statSync(out).size, 'bytes');

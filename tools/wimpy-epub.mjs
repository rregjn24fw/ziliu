/* 生成一本“英文插图小说”式的测试 EPUB（模仿小屁孩日记那类排版）：
     · 封面 / 插图用 <svg><image xlink:href="…"/></svg> 包着（很多工具就是这么导出的）
     · 有的图用 <image href>（EPUB3 写法），有的图路径大小写故意写错
     · 有一章只有图没有字，有一章只有两句话
     · 有一张大图（>700KB），用来看自动压缩有没有生效
   node tools/wimpy-epub.mjs  →  example/Wimpy 风格.epub */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ---------------- ZIP ---------------- */
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
      const z = zlib.deflateRawSync(data, { level: 6 });
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

/* ---------------- PNG ---------------- */
function png(w, h, rgb, mode) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let seed = 20260101;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 3;
      let k;
      if (mode === 'noise') {
        // 真随机：压不下去，用来测试“大图自动压缩”
        k = 0.15 + rnd() * 0.85;
      } else {
        k = 0.45 + 0.55 * Math.sin((x / w) * Math.PI) * Math.cos((y / h) * Math.PI);
      }
      raw[p] = Math.min(255, Math.round(rgb[0] * k));
      raw[p + 1] = Math.min(255, Math.round(rgb[1] * k));
      raw[p + 2] = Math.min(255, Math.round(rgb[2] * k));
    }
  }
  const idat = zlib.deflateSync(raw, { level: 4 });
  const out = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    out.push(len, t, data, c);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  chunk('IHDR', ihdr);
  chunk('IDAT', idat);
  chunk('IEND', Buffer.alloc(0));
  return Buffer.concat(out);
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const cover = png(420, 560, [200, 120, 60]);
const fig1 = png(520, 320, [70, 110, 160]);
const fig2 = png(520, 340, [120, 160, 90]);
const fig3 = png(600, 400, [150, 90, 140]);
const big = png(1500, 1000, [180, 160, 120], 'noise');

const S1 = [
  'Today my mom gave me a journal and said I should write down what happens to me. I told her nothing ever happens to me.',
  'Then my brother broke the kitchen window with a baseball, so I guess something happened.',
  '"You did it," he said. "I did not," I said.',
  'Mom did not believe either of us, which is basically her whole system.',
  'I wrote one page and then I drew a picture of the window, because the window is more interesting than my feelings.',
  'The picture came out pretty good. It looks like an explosion. That is basically what it was.',
  'My best friend Rowley came over after dinner and asked if I wanted to ride bikes.',
  'I said yes so fast that I forgot to put on shoes.',
  'I do not really like shoes anyway.'
];

const S2 = [
  'SEPTEMBER is over, which means the school play is coming, which means I have to be in it.',
  '"You will be a tree," the teacher said. "A TREE," I said. "That is not a part, that is furniture."',
  'Rowley got cast as a rock. He is very excited about it. He has been practicing being a rock all week.',
  'I am not making that up. He sits on the floor for hours. He says it is harder than it looks.',
  'I showed him my drawing of the window again. He said it looks like a bag of potatoes.',
  'I hate it here.'
];

const S3 = [
  '"Do you ever think about how big the sky is?" Rowley asked.',
  'I said no, because that is the kind of question that ends with me getting in trouble.'
];

const S4 = [
  'WEDNESDAY, and the gym smelled like a hundred years of sneakers.',
  'Coach said we had to run laps. I said I had a note. He said the note was from last year.',
  'I ran half a lap and then I remembered I am not a runner, I am a DRAWER.',
  'Rowley finished all four laps. He did not even look tired. Something is wrong with that guy.'
];

const pages = [
  {
    id: 'cover', file: 'cover.xhtml', title: 'Cover',
    body: `<div class="cover"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 420 560" preserveAspectRatio="xMidYMid meet"><image width="420" height="560" xlink:href="../Images/cover.png"/></svg></div>`
  },
  {
    id: 'ch1', file: 'ch1.xhtml', title: 'September',
    body: `<h1>SEPTEMBER</h1>` + S1.map((t) => `<p>${esc(t)}</p>`).join('\n') +
      `<div class="art"><img src="../images/fig1.png" alt="the window"/></div>` +
      `<p>That is the window. You can see why Mom was upset.</p>`
  },
  {
    id: 'ch2', file: 'ch2.xhtml', title: 'October',
    body: `<h1>OCTOBER</h1>` + S2.slice(0, 3).map((t) => `<p>${esc(t)}</p>`).join('\n') +
      `<div class="art"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 520 340"><image width="520" height="340" xlink:href="../Images/fig2.png"/></svg></div>` +
      S2.slice(3).map((t) => `<p>${esc(t)}</p>`).join('\n')
  },
  {
    id: 'ch3', file: 'ch3.xhtml', title: 'The Rock',
    body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><image width="600" height="400" href="../Images/fig3.png"/></svg>`
  },
  {
    id: 'ch4', file: 'ch4.xhtml', title: 'Two Lines',
    body: S3.map((t) => `<p>${esc(t)}</p>`).join('\n')
  },
  {
    id: 'ch5', file: 'ch5.xhtml', title: 'Wednesday',
    body: `<h1>WEDNESDAY</h1>` + S4.map((t) => `<p>${esc(t)}</p>`).join('\n') +
      `<div class="art"><img src="../Images/big.png" alt="laps"/></div>` +
      `<p>This is a picture of the gym. It is mostly a picture of how I felt.</p>`
  }
].map((p) => ({
  ...p,
  data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"><title>${esc(p.title)}</title></head>
<body>
${p.body}
</body>
</html>`
}));

const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${pages.map((p) => `  <li><a href="${p.file}">${esc(p.title)}</a></li>`).join('\n')}
</ol></nav></body></html>`;

const manifest = pages.map((p) => `    <item id="${p.id}" href="${p.file}" media-type="application/xhtml+xml"/>`).join('\n') +
  '\n    <item id="i0" href="Images/cover.png" media-type="image/png"/>' +
  '\n    <item id="i1" href="Images/fig1.png" media-type="image/png"/>' +
  '\n    <item id="i2" href="Images/fig2.png" media-type="image/png"/>' +
  '\n    <item id="i3" href="Images/fig3.png" media-type="image/png"/>' +
  '\n    <item id="i4" href="Images/big.png" media-type="image/png"/>';

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:ziliu-wimpy-0001</dc:identifier>
    <dc:title>Diary of a Kid Who Draws (English · illustrated)</dc:title>
    <dc:creator>字流 · 测试</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
  </manifest>
  <spine>
${pages.map((p) => `    <itemref idref="${p.id}"/>`).join('\n')}
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
  { name: 'OEBPS/Images/cover.png', data: cover },
  { name: 'OEBPS/Images/fig1.png', data: fig1 },
  { name: 'OEBPS/Images/fig2.png', data: fig2 },
  { name: 'OEBPS/Images/fig3.png', data: fig3 },
  { name: 'OEBPS/Images/big.png', data: big },
  ...pages.map((p) => ({ name: 'OEBPS/' + p.file, data: p.data }))
];

const outDir = path.resolve('example');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'Wimpy 风格.epub');
fs.writeFileSync(out, makeZip(files));
console.log('written:', out, fs.statSync(out).size, 'bytes');
console.log('big.png 原始大小:', big.length, 'bytes');

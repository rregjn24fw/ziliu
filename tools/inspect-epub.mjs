/* 看清一本 EPUB 的骨架：目录、manifest、以及正文里图片到底是怎么引用的。
   node tools/inspect-epub.mjs "path/to/book.epub" */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const Zip = require('../js/zip.js');

const file = process.argv[2];
if (!file) { console.error('用法: node tools/inspect-epub.mjs <book.epub>'); process.exit(1); }
const buf = fs.readFileSync(file);
console.log('文件:', file, (buf.length / 1024 / 1024).toFixed(2) + 'MB');

const zip = await Zip.open(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const names = zip.names;
console.log('条目数:', names.length);

const byExt = {};
for (const n of names) {
  const e = (n.match(/\.[a-z0-9]+$/i) || ['(none)'])[0].toLowerCase();
  byExt[e] = (byExt[e] || 0) + 1;
}
console.log('按后缀:', JSON.stringify(byExt));

console.log('\n--- 图片文件（前 12 个）---');
const imgs = names.filter((n) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(n));
console.log('总数:', imgs.length);
for (const n of imgs.slice(0, 12)) console.log('  ', n);

console.log('\n--- container.xml ---');
console.log((await zip.text('META-INF/container.xml')).slice(0, 600));

const container = await zip.text('META-INF/container.xml');
const m = container.match(/full-path="([^"]+)"/);
const opfPath = m ? m[1] : null;
console.log('\nOPF:', opfPath);

if (opfPath) {
  const opf = await zip.text(opfPath);
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  console.log('--- OPF（前 2500 字）---');
  console.log(opf.slice(0, 2500));

  const items = [...opf.matchAll(/<item\b[^>]*>/g)].map((x) => x[0]);
  const media = {};
  for (const it of items) {
    const t = (it.match(/media-type="([^"]+)"/) || [])[1] || '?';
    media[t] = (media[t] || 0) + 1;
  }
  console.log('\n--- manifest media-type 统计 ---', JSON.stringify(media));

  const spineIds = [...opf.matchAll(/<itemref[^>]*idref="([^"]+)"/g)].map((x) => x[1]);
  console.log('spine 项数:', spineIds.length);

  // 每个 spine 文档里图片是怎么写的
  const idToHref = {};
  for (const it of items) {
    const id = (it.match(/id="([^"]+)"/) || [])[1];
    const href = (it.match(/href="([^"]+)"/) || [])[1];
    if (id && href) idToHref[id] = href;
  }

  console.log('\n--- spine 文档里的图片引用 ---');
  let shown = 0;
  let withImg = 0;
  let withSvgImg = 0;
  let withCssBg = 0;
  for (const id of spineIds) {
    const href = idToHref[id];
    if (!href) continue;
    const full = dir + href;
    let html = '';
    try { html = await zip.text(full); } catch (e) { continue; }
    const tagCount = (html.match(/<img\b/gi) || []).length;
    const svgCount = (html.match(/<image\b/gi) || []).length;
    const bgCount = (html.match(/background-image/gi) || []).length;
    if (tagCount) withImg++;
    if (svgCount) withSvgImg++;
    if (bgCount) withCssBg++;
    if ((tagCount || svgCount) && shown < 6) {
      shown++;
      console.log('\n  [' + full + '] img=' + tagCount + ' svgImage=' + svgCount);
      const snip = html.match(/<img\b[^>]*>|<image\b[^>]*>/gi) || [];
      for (const s of snip.slice(0, 4)) console.log('    ', s.slice(0, 300));
      const bodyStart = html.search(/<body/i);
      console.log('    body:', html.slice(bodyStart, bodyStart + 300).replace(/\s+/g, ' '));
    }
  }
  console.log('\n含 <img> 的文档:', withImg, '/ 含 svg<image> 的:', withSvgImg, '/ 含 css 背景图:', withCssBg);
}

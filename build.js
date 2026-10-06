#!/usr/bin/env node
// Inlines the sibling <script src="*.js"> files into index.html and writes dist/loop.html,
// a single self-contained file you can download, email, or double-click.
//   node build.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const missing = [];
const out = html.replace(/<script src="([^"]+\.js)"><\/script>/g, (_, file) => {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) { missing.push(file); return _; }
  // a literal "</script" inside the source would end the inline block early
  const code = fs.readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>\n/* ---- ${file} ---- */\n${code}\n</script>`;
});
if (missing.length) { console.error('missing: ' + missing.join(', ')); process.exit(1); }

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const dest = path.join(root, 'dist', 'loop.html');
fs.writeFileSync(dest, out);
console.log(`dist/loop.html  ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`);

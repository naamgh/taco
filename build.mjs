// Node port of build.ps1 - builds ftp-plan.html, ftp-log.html and the GitHub Pages
// copies (github/index.html, github/log.html) from the parts in src/.
//
//   node build.mjs           build all outputs
//   node build.mjs --check   report whether the outputs would change, write nothing
//
// Output is byte-identical to build.ps1: UTF-8 with BOM, CRLF joins.
import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const check = process.argv.includes('--check');
const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');

// Read as UTF-8, dropping a leading BOM (like .NET ReadAllText does).
function read(p) {
  const t = readFileSync(p, 'utf8');
  return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t;
}
function part(name) {
  const p = join(src, name);
  if (!existsSync(p)) throw new Error('missing part: ' + name);
  return read(p);
}

const nl = '\r\n';
const modules = readdirSync(join(src, 'app'))
  .filter(f => f.toLowerCase().endsWith('.js'))
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  .map(f => read(join(src, 'app', f)));

const html =
  part('head.html') + nl +
  '<style>' + nl + part('styles.css') + nl + '</style>' + nl +
  '<script>' + nl + part('theme-boot.js') + nl + '</script>' + nl +
  '</head>' + nl +
  part('shell.html') + nl +
  '<script id="libraryData" type="application/json">' + part('library.json').trim() + '</script>' + nl +
  nl +
  '<script>' + nl + '(function(){' + nl + '  "use strict";' + nl +
  modules.join(nl) + nl +
  '})();' + nl + '</script>' + nl + '</body>' + nl + '</html>' + nl;

// The Training Log page: same bundle, different <html> marker, title and manifest.
function logPage(appUrl) {
  const swaps = [
    ['<html lang="en">', '<html lang="en" data-mode="log" data-app-url="' + appUrl + '">'],
    ['<title>Indoor Training Console</title>', '<title>Training Log</title>'],
    ['href="manifest.webmanifest"', 'href="log.webmanifest"'],
  ];
  let out = html;
  for (const [from, to] of swaps) {
    if (!out.includes(from)) throw new Error('log page: marker not found: ' + from);
    out = out.split(from).join(to);
  }
  return out;
}

const outs = [
  { path: join(root, 'ftp-plan.html'), html },
  { path: join(root, 'github', 'index.html'), html },
  { path: join(root, 'ftp-log.html'), html: logPage('ftp-plan.html') },
  { path: join(root, 'github', 'log.html'), html: logPage('./') },
];

const sha = b => createHash('sha256').update(b).digest('hex');
for (const o of outs) {
  const bytes = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(o.html, 'utf8')]);
  const same = existsSync(o.path) && sha(readFileSync(o.path)) === sha(bytes);
  const name = basename(o.path).padEnd(22);
  if (check) {
    console.log(name + ' ' + (same ? 'unchanged' : 'WOULD CHANGE'));
  } else {
    writeFileSync(o.path, bytes);
    console.log(name + ' ' + (same ? 'unchanged' : 'written') + '  ' + bytes.length.toLocaleString('en-US') + ' bytes');
  }
}
if (!check) {
  // The generator and builder travel with the site so the library can be rebuilt from the repo.
  copyFileSync(join(root, 'library-gen.js'), join(root, 'github', 'library-gen.js'));
  copyFileSync(join(root, 'library-builder.html'), join(root, 'github', 'library-builder.html'));
}

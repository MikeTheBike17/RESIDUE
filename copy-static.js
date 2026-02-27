const fs = require('fs');
const path = require('path');

const dest = path.join(process.cwd(), 'dist');
const sources = [
  'index.html',
  'about.html',
  'access.html',
  'drop.html',
  'residue-private.html',
  'thank-you.html',
  'link-admin.html',
  'link-profile.html',
  'css',
  'js',
  'images',
  'assets'
];

function copy(src, dst) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copy(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
sources.forEach(item => copy(path.join(process.cwd(), item), path.join(dest, item)));
console.log('Static files copied to dist/');

// Creates sample sections + photos so you can try the app immediately.
// Run: npm run seed   (skips if photos already exist; use --force to add anyway)
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { db, DIRS, setting, currentYear } = require('./db');
const { makePreview, makeThumb } = require('./lib/watermark');

const CY = currentYear();
const SAMPLE_SECTIONS = [
  { name: 'Pastor S. O. Adewale', cat: 'Pastor', year: CY, photos: 8, c1: '#2f2377', c2: '#6f5be8' },
  { name: 'Pastor J. K. Okafor', cat: 'Assistant Pastor', year: CY, photos: 8, c1: '#5b2482', c2: '#b565e8' },
  { name: 'Pastor M. A. Balogun', cat: 'Deacon & Deaconess', year: CY, photos: 8, c1: '#23306e', c2: '#5b8ae8' },
  { name: 'Pastor T. A. Ogunleye', cat: 'Pastor', year: CY - 1, photos: 4, c1: '#3a2a5e', c2: '#8a6bd8' },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function initialsOf(name) {
  return name
    .replace(/^Pastor\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('');
}

async function headshotJpeg(name, c1, c2, dest) {
  const svg = `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <circle cx="200" cy="150" r="70" fill="rgba(255,255,255,0.22)"/>
  <path d="M 70 400 Q 200 245 330 400 Z" fill="rgba(255,255,255,0.22)"/>
  <text x="200" y="172" font-family="DejaVu Sans, Georgia, serif" font-size="58" fill="#ffffff" text-anchor="middle" font-weight="700">${esc(initialsOf(name))}</text>
</svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(dest);
}

async function photoJpeg(sectionName, year, n, c1, c2, dest) {
  const svg = `<svg width="1600" height="1067" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="1600" height="1067" fill="url(#g)"/>
  <circle cx="240" cy="880" r="330" fill="rgba(255,255,255,0.07)"/>
  <circle cx="1400" cy="160" r="260" fill="rgba(255,255,255,0.07)"/>
  <text x="800" y="450" font-family="DejaVu Sans, Georgia, serif" font-size="84" fill="rgba(255,255,255,0.95)" text-anchor="middle" font-weight="700">SAMPLE PHOTO ${n}</text>
  <text x="800" y="540" font-family="DejaVu Sans, Arial, sans-serif" font-size="42" fill="rgba(255,255,255,0.85)" text-anchor="middle">${esc(sectionName)} Section · ${year}</text>
  <text x="800" y="1010" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" fill="rgba(255,255,255,0.7)" text-anchor="middle">Replace with real ordination photos from the Admin panel</text>
</svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(dest);
}

(async () => {
  const count = db.prepare('SELECT COUNT(*) c FROM photos').get().c;
  if (count > 0 && !process.argv.includes('--force')) {
    console.log('Photos already exist — skipping sample seed. Use "node seed.js --force" to add samples anyway.');
    return;
  }
  const text = setting('watermark_text', 'PREVIEW');
  for (const s of SAMPLE_SECTIONS) {
    const hs = crypto.randomUUID() + '.jpg';
    await headshotJpeg(s.name, s.c1, s.c2, path.join(DIRS.headshots, hs));
    const sec = db.prepare('INSERT INTO sections (name, headshot, category, year) VALUES (?, ?, ?, ?)').run(s.name, hs, s.cat, s.year);
    for (let n = 1; n <= s.photos; n++) {
      const base = crypto.randomUUID();
      const orig = path.join(DIRS.originals, base + '.jpg');
      await photoJpeg(s.name, s.year, n, s.c1, s.c2, orig);
      await makePreview(orig, path.join(DIRS.previews, base + '.jpg'), text);
      await makeThumb(orig, path.join(DIRS.thumbs, base + '.jpg'), text);
      db.prepare('INSERT INTO photos (section_id, original, preview, thumb, label) VALUES (?, ?, ?, ?, ?)').run(
        Number(sec.lastInsertRowid), base + '.jpg', base + '.jpg', base + '.jpg', `Photo ${n}`
      );
    }
    console.log(`Seeded: ${s.year} · ${s.cat} · ${s.name} (${s.photos} photos)`);
  }
  console.log('Done. Start the app with: npm start');
})();

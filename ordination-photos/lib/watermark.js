const sharp = require('sharp');

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Tiled diagonal watermark that covers the whole image (including faces),
// so cropping a screenshot doesn't remove it.
function overlaySvg(width, height, text, fontSize) {
  const safe = esc(text);
  const gapX = Math.max(fontSize * 5, Math.round(text.length * fontSize * 0.66) + fontSize * 2);
  const gapY = Math.round(fontSize * 4.2);
  const midY = Math.round(gapY / 2);
  const x = Math.round(fontSize * 0.4);
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><pattern id="wm" width="${gapX}" height="${gapY}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">` +
      `<text x="${x + 2}" y="${midY + 2}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#000000" fill-opacity="0.25">${safe}</text>` +
      `<text x="${x}" y="${midY}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" fill-opacity="0.42">${safe}</text>` +
      `</pattern></defs>` +
      `<rect width="100%" height="100%" fill="url(#wm)"/></svg>`
  );
}

async function watermarked(srcPath, destPath, text, maxEdge, quality, fontSize) {
  const base = await sharp(srcPath)
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });
  const overlay = overlaySvg(base.info.width, base.info.height, text, fontSize);
  await sharp(base.data).composite([{ input: overlay }]).jpeg({ quality }).toFile(destPath);
}

// ~1000px watermarked preview shown in the lightbox
function makePreview(srcPath, destPath, text) {
  return watermarked(srcPath, destPath, text, 1000, 58, 30);
}
// ~420px watermarked thumbnail for grids
function makeThumb(srcPath, destPath, text) {
  return watermarked(srcPath, destPath, text, 420, 55, 15);
}
// Square headshot for section folder icons
async function makeHeadshot(srcPath, destPath) {
  await sharp(srcPath)
    .rotate()
    .resize(400, 400, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 82 })
    .toFile(destPath);
}

module.exports = { makePreview, makeThumb, makeHeadshot };

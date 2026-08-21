const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db, DIRS, setting, setSetting, getCategories, currentYear } = require('../db');
const { adminOnly, adminPassword, isDefaultPassword, makeAdminCookie, loginAllowed } = require('../lib/auth');
const { makePreview, makeThumb, makeHeadshot } = require('../lib/watermark');
const { isDemo } = require('../lib/paystack');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIRS.tmp),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname || '').toLowerCase()),
  }),
  limits: { fileSize: 35 * 1024 * 1024, files: 300 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpe?g|png|webp|avif|tiff?)$/i.test(file.mimetype);
    cb(ok ? null : new Error(`"${file.originalname}" is not a supported image (JPEG/PNG/WebP)`), ok);
  },
});

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch {}
}
function cleanCategory(raw, fallback) {
  const c = String(raw || '').replace(/\//g, '-').trim().slice(0, 60);
  return c || fallback || getCategories()[0] || 'Pastor';
}
function cleanYear(raw, fallback) {
  const y = Math.round(Number(raw));
  if (Number.isInteger(y) && y >= 2000 && y <= 2100) return y;
  return fallback != null ? fallback : currentYear();
}

router.post('/api/admin/login', (req, res) => {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || '?';
  if (!loginAllowed(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (String((req.body && req.body.password) || '') !== adminPassword()) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  const secure = req.secure || (process.env.BASE_URL || '').startsWith('https');
  res.setHeader('Set-Cookie', makeAdminCookie(secure));
  res.json({ ok: true });
});

router.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'adm=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// Everything below requires the admin cookie
router.use('/api/admin', adminOnly);

router.get('/api/admin/overview', (req, res) => {
  const sections = db.prepare('SELECT COUNT(*) c FROM sections').get().c;
  const photos = db.prepare('SELECT COUNT(*) c FROM photos').get().c;
  const paid = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount_kobo), 0) s FROM orders WHERE status = 'paid'").get();
  const pending = db.prepare("SELECT COUNT(*) c FROM orders WHERE status != 'paid'").get().c;
  res.json({
    sections,
    photos,
    paidOrders: paid.c,
    revenueKobo: paid.s,
    pendingOrders: pending,
    demoMode: isDemo(),
    defaultPassword: isDefaultPassword(),
    settings: {
      priceKobo: Number(setting('price_kobo', '150000')),
      watermarkText: setting('watermark_text', ''),
      siteTitle: setting('site_title', ''),
      categories: getCategories(),
      currentYear: currentYear(),
    },
  });
});

router.post('/api/admin/sections', upload.single('headshot'), async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
    if (!name) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({ error: 'Section name is required.' });
    }
    const category = cleanCategory(req.body && req.body.category);
    const year = cleanYear(req.body && req.body.year);
    let headshot = null;
    if (req.file) {
      headshot = crypto.randomUUID() + '.jpg';
      await makeHeadshot(req.file.path, path.join(DIRS.headshots, headshot));
      safeUnlink(req.file.path);
    }
    const info = db.prepare('INSERT INTO sections (name, headshot, category, year) VALUES (?, ?, ?, ?)').run(name, headshot, category, year);
    res.json({ id: Number(info.lastInsertRowid), name, headshot, category, year });
  } catch (e) {
    if (req.file) safeUnlink(req.file.path);
    next(e);
  }
});

router.put('/api/admin/sections/:id', upload.single('headshot'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
    if (!section) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(404).json({ error: 'Section not found.' });
    }
    const name = String((req.body && req.body.name) || section.name).trim().slice(0, 80) || section.name;
    const category = req.body && req.body.category != null ? cleanCategory(req.body.category, section.category) : section.category;
    const year = req.body && req.body.year != null ? cleanYear(req.body.year, section.year) : section.year;
    let headshot = section.headshot;
    if (req.file) {
      const fresh = crypto.randomUUID() + '.jpg';
      await makeHeadshot(req.file.path, path.join(DIRS.headshots, fresh));
      safeUnlink(req.file.path);
      if (section.headshot) safeUnlink(path.join(DIRS.headshots, section.headshot));
      headshot = fresh;
    }
    db.prepare('UPDATE sections SET name = ?, headshot = ?, category = ?, year = ? WHERE id = ?').run(name, headshot, category, year, id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/api/admin/sections/:id', (req, res) => {
  const id = Number(req.params.id);
  const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
  if (!section) return res.status(404).json({ error: 'Section not found.' });
  const photos = db.prepare('SELECT * FROM photos WHERE section_id = ?').all(id);
  for (const p of photos) {
    safeUnlink(path.join(DIRS.originals, p.original));
    safeUnlink(path.join(DIRS.previews, p.preview));
    safeUnlink(path.join(DIRS.thumbs, p.thumb));
  }
  if (section.headshot) safeUnlink(path.join(DIRS.headshots, section.headshot));
  db.prepare('DELETE FROM sections WHERE id = ?').run(id);
  res.json({ ok: true, removedPhotos: photos.length });
});

// Bulk photo upload: originals kept untouched, watermarked preview+thumb generated
router.post('/api/admin/sections/:id/photos', upload.array('photos', 300), async (req, res) => {
  const id = Number(req.params.id);
  const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
  if (!section) {
    (req.files || []).forEach((f) => safeUnlink(f.path));
    return res.status(404).json({ error: 'Section not found.' });
  }
  const text = setting('watermark_text', 'PREVIEW');
  const insert = db.prepare('INSERT INTO photos (section_id, original, preview, thumb, label) VALUES (?, ?, ?, ?, ?)');
  let added = 0;
  const failed = [];
  for (const f of req.files || []) {
    const base = crypto.randomUUID();
    const ext = path.extname(f.originalname || '').toLowerCase() || '.jpg';
    try {
      fs.copyFileSync(f.path, path.join(DIRS.originals, base + ext));
      await makePreview(f.path, path.join(DIRS.previews, base + '.jpg'), text);
      await makeThumb(f.path, path.join(DIRS.thumbs, base + '.jpg'), text);
      const label = path.basename(f.originalname || 'photo', path.extname(f.originalname || '')).slice(0, 80);
      insert.run(id, base + ext, base + '.jpg', base + '.jpg', label);
      added++;
    } catch (e) {
      console.error('Upload failed:', f.originalname, e.message);
      failed.push(f.originalname);
      // clean up any partial files so nothing orphaned lingers on disk
      safeUnlink(path.join(DIRS.originals, base + ext));
      safeUnlink(path.join(DIRS.previews, base + '.jpg'));
      safeUnlink(path.join(DIRS.thumbs, base + '.jpg'));
    } finally {
      safeUnlink(f.path);
    }
  }
  res.json({ added, failed });
});

router.delete('/api/admin/photos/:id', (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id));
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  safeUnlink(path.join(DIRS.originals, photo.original));
  safeUnlink(path.join(DIRS.previews, photo.preview));
  safeUnlink(path.join(DIRS.thumbs, photo.thumb));
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  res.json({ ok: true });
});

router.get('/api/admin/orders', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, COUNT(oi.photo_id) AS items
       FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
       GROUP BY o.id ORDER BY o.id DESC LIMIT 500`
    )
    .all();
  res.json(
    rows.map((r) => ({
      reference: r.reference,
      email: r.email,
      phone: r.phone,
      amountKobo: r.amount_kobo,
      status: r.status,
      items: r.items,
      createdAt: r.created_at,
      paidAt: r.paid_at,
    }))
  );
});

router.put('/api/admin/settings', (req, res) => {
  const { priceKobo, watermarkText, siteTitle, categories, currentYear: cy } = req.body || {};
  if (priceKobo != null) {
    const v = Math.round(Number(priceKobo));
    if (!Number.isFinite(v) || v < 100) return res.status(400).json({ error: 'Price must be at least 100 kobo (₦1).' });
    setSetting('price_kobo', v);
  }
  if (watermarkText != null) setSetting('watermark_text', String(watermarkText).trim().slice(0, 60) || 'PREVIEW');
  if (siteTitle != null) setSetting('site_title', String(siteTitle).trim().slice(0, 60) || 'Ordination Photos');
  if (categories != null) {
    const list = (Array.isArray(categories) ? categories : String(categories).split(','))
      .map((c) => String(c).replace(/\//g, '-').trim().slice(0, 60))
      .filter(Boolean)
      .filter((c, i, a) => a.indexOf(c) === i)
      .slice(0, 12);
    if (!list.length) return res.status(400).json({ error: 'Enter at least one ordination category.' });
    setSetting('categories', JSON.stringify(list));
  }
  if (cy != null) {
    const y = Math.round(Number(cy));
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return res.status(400).json({ error: 'Enter a valid year (e.g. 2026).' });
    setSetting('current_year', y);
  }
  res.json({ ok: true });
});

// Re-create every preview/thumb with the current watermark text (can take a while)
router.post('/api/admin/regenerate', async (req, res, next) => {
  try {
    const text = setting('watermark_text', 'PREVIEW');
    const photos = db.prepare('SELECT * FROM photos').all();
    let done = 0;
    for (const p of photos) {
      const src = path.join(DIRS.originals, p.original);
      if (!fs.existsSync(src)) continue;
      await makePreview(src, path.join(DIRS.previews, p.preview), text);
      await makeThumb(src, path.join(DIRS.thumbs, p.thumb), text);
      done++;
    }
    setSetting('media_version', Date.now());
    res.json({ regenerated: done });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

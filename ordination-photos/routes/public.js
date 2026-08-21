const express = require('express');
const { db, setting, getCategories, currentYear } = require('../db');
const { isDemo } = require('../lib/paystack');

const router = express.Router();

router.get('/api/config', (req, res) => {
  res.json({
    siteTitle: setting('site_title', 'Ordination Photos'),
    priceKobo: Number(setting('price_kobo', '150000')),
    demoMode: isDemo(),
    categories: getCategories(),
    currentYear: currentYear(),
  });
});

router.get('/api/sections', (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.headshot, s.category, s.year, COUNT(p.id) AS photo_count
       FROM sections s LEFT JOIN photos p ON p.section_id = s.id
       GROUP BY s.id ORDER BY s.year DESC, s.sort, s.name`
    )
    .all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category || 'Pastor',
      year: r.year || 2026,
      photoCount: r.photo_count,
      headshotUrl: r.headshot ? `/media/headshots/${r.headshot}` : null,
    }))
  );
});

router.get('/api/sections/:id/photos', (req, res) => {
  const id = Number(req.params.id);
  const section = db.prepare('SELECT id, name, headshot, category, year FROM sections WHERE id = ?').get(id);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  const mv = setting('media_version', '1');
  const rows = db.prepare('SELECT id, thumb, preview, label FROM photos WHERE section_id = ? ORDER BY id').all(id);
  res.json({
    section: {
      id: section.id,
      name: section.name,
      category: section.category || 'Pastor',
      year: section.year || 2026,
      headshotUrl: section.headshot ? `/media/headshots/${section.headshot}` : null,
    },
    photos: rows.map((r) => ({
      id: r.id,
      label: r.label,
      thumbUrl: `/media/thumbs/${r.thumb}?v=${mv}`,
      previewUrl: `/media/previews/${r.preview}?v=${mv}`,
    })),
  });
});

module.exports = router;

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.5+ — no native module to compile

const DATA_DIR = path.join(__dirname, 'data');
const DIRS = {
  data: DATA_DIR,
  originals: path.join(DATA_DIR, 'originals'),   // full-quality files — NEVER served publicly
  previews: path.join(DATA_DIR, 'previews'),     // watermarked ~1000px
  thumbs: path.join(DATA_DIR, 'thumbs'),         // watermarked ~420px
  headshots: path.join(DATA_DIR, 'headshots'),   // Senior Pastor folder icons
  tmp: path.join(DATA_DIR, 'tmp'),               // upload staging
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  headshot TEXT,
  category TEXT DEFAULT 'Pastor',
  year INTEGER DEFAULT 2026,
  sort INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  original TEXT NOT NULL,
  preview TEXT NOT NULL,
  thumb TEXT NOT NULL,
  label TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_section ON photos(section_id);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  amount_kobo INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  paystack_ref TEXT,
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  PRIMARY KEY (order_id, photo_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Migrations for databases created before categories / years existed
try {
  db.exec("ALTER TABLE sections ADD COLUMN category TEXT DEFAULT 'Pastor'");
} catch { /* column already exists */ }
try {
  db.exec("ALTER TABLE sections ADD COLUMN year INTEGER DEFAULT 2026");
} catch { /* column already exists */ }

// Simple transaction helper (BEGIN/COMMIT/ROLLBACK)
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const out = fn();
    db.exec('COMMIT;');
    return out;
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
}

function setting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
function ensureSetting(key, value) {
  if (setting(key) === null) setSetting(key, value);
}

const DEFAULT_CATEGORIES = ['Deacon & Deaconess', 'Assistant Pastor', 'Pastor'];
function currentYear() {
  const y = Number(setting('current_year'));
  return Number.isInteger(y) && y >= 2000 ? y : new Date().getFullYear();
}
function getCategories() {
  try {
    const a = JSON.parse(setting('categories', '[]'));
    return Array.isArray(a) && a.length ? a : DEFAULT_CATEGORIES;
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

// Defaults (editable in the admin panel)
ensureSetting('price_kobo', '150000'); // ₦1,500 per photo
ensureSetting('watermark_text', 'RCCG ORDINATION • PREVIEW');
ensureSetting('site_title', 'RCCG Ordination Photos');
ensureSetting('media_version', '1');
ensureSetting('categories', JSON.stringify(DEFAULT_CATEGORIES));
ensureSetting('current_year', String(new Date().getFullYear()));

// Signing secret for download links / admin sessions (auto-generated if not in .env)
if (!process.env.APP_SECRET && setting('app_secret') === null) {
  setSetting('app_secret', crypto.randomBytes(32).toString('hex'));
}
function appSecret() {
  return process.env.APP_SECRET || setting('app_secret');
}

module.exports = { db, DIRS, setting, setSetting, appSecret, transaction, getCategories, DEFAULT_CATEGORIES, currentYear };

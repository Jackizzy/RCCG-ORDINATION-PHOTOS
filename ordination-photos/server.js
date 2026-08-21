require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DIRS, setting } = require('./db');
const { isDemo } = require('./lib/paystack');
const publicRoutes = require('./routes/public');
const { router: checkoutRoutes, webhookHandler } = require('./routes/checkout');
const adminRoutes = require('./routes/admin');

const app = express();
app.disable('x-powered-by');

// Behind a reverse proxy (Render, Railway, Nginx, Caddy) this makes req.ip and
// req.secure reflect the real client. Set TRUST_PROXY=0 only if the app is
// exposed to the internet directly with no proxy in front.
if (process.env.TRUST_PROXY !== '0') app.set('trust proxy', 1);

// Baseline security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});

// Paystack webhook needs the raw body for signature checks — register BEFORE express.json()
app.post('/api/paystack/webhook', express.raw({ type: () => true }), webhookHandler);

app.use(express.json({ limit: '1mb' }));

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DESC = 'Find your ordination section, browse watermarked previews, and download your full-quality ordination photos.';

// Homepage is templated so social-share metadata (title, preview image URL) is always correct
function renderIndex(req, res) {
  const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const html = fs
    .readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replaceAll('{{TITLE}}', escAttr(setting('site_title', 'Ordination Photos')))
    .replaceAll('{{DESC}}', escAttr(DESC))
    .replaceAll('{{BASE_URL}}', escAttr(base));
  res.type('html').send(html);
}
app.get('/', renderIndex);
app.get('/index.html', renderIndex);

// Watermarked media + headshots are public. ORIGINALS ARE NOT — only served
// through /api/download with a valid signed link on a paid order.
app.use('/media/previews', express.static(DIRS.previews, { maxAge: '7d', immutable: true }));
app.use('/media/thumbs', express.static(DIRS.thumbs, { maxAge: '7d', immutable: true }));
app.use('/media/headshots', express.static(DIRS.headshots, { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(publicRoutes);
app.use(checkoutRoutes);
app.use(adminRoutes);

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  // Upload validation problems are safe (and useful) to show; anything else stays generic
  if (err.name === 'MulterError' || /not a supported image/i.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

// Refuse to take real money with the default admin password
if (!isDemo() && !process.env.ADMIN_PASSWORD) {
  console.error('');
  console.error('  REFUSING TO START: Paystack is configured (live payments) but ADMIN_PASSWORD is not set.');
  console.error('  Anyone could log into /admin with the default password and access your orders.');
  console.error('  Set a strong ADMIN_PASSWORD in your .env file, then start again.');
  console.error('');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log(`  ${setting('site_title', 'Ordination Photos')}`);
  console.log(`  Site:     http://localhost:${PORT}`);
  console.log(`  Admin:    http://localhost:${PORT}/admin`);
  console.log(`  Payments: ${isDemo() ? 'DEMO MODE — no Paystack keys set, payments are simulated' : 'LIVE via Paystack'}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`  WARNING:  Using default admin password "admin123" — set ADMIN_PASSWORD in .env`);
  }
  console.log('');
});

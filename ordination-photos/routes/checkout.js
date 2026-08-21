const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { db, DIRS, setting, transaction } = require('../db');
const { isDemo, initTransaction, verifyTransaction, secret } = require('../lib/paystack');
const { sign, verify } = require('../lib/auth');

const router = express.Router();
const DOWNLOAD_TTL = 7 * 24 * 3600 * 1000; // links valid 7 days; fresh ones issued on every order-page visit

function baseUrl(req) {
  return (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}
function getOrder(reference) {
  return db.prepare('SELECT * FROM orders WHERE reference = ?').get(reference);
}
function orderItems(orderId) {
  return db
    .prepare(
      `SELECT p.*, s.name AS section_name
       FROM order_items oi
       JOIN photos p ON p.id = oi.photo_id
       JOIN sections s ON s.id = p.section_id
       WHERE oi.order_id = ?`
    )
    .all(orderId);
}
function markPaid(reference, paystackData) {
  const order = getOrder(reference);
  if (!order || order.status === 'paid') return;
  if (paystackData && Number(paystackData.amount) !== order.amount_kobo) {
    console.error(`Amount mismatch on ${reference}: expected ${order.amount_kobo}, got ${paystackData.amount}`);
    return;
  }
  if (paystackData && paystackData.currency && paystackData.currency !== 'NGN') {
    console.error(`Currency mismatch on ${reference}: got ${paystackData.currency}`);
    return;
  }
  db.prepare(`UPDATE orders SET status = 'paid', paid_at = datetime('now'), paystack_ref = ? WHERE reference = ?`).run(
    paystackData ? String(paystackData.id || '') : 'demo',
    reference
  );
}

router.post('/api/checkout', async (req, res, next) => {
  try {
    const { email, phone, photoIds } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address — your downloads are tied to it.' });
    }
    const ids = [...new Set((Array.isArray(photoIds) ? photoIds : []).map(Number).filter(Number.isInteger))];
    if (!ids.length || ids.length > 100) return res.status(400).json({ error: 'Select between 1 and 100 photos.' });
    const found = db.prepare(`SELECT id FROM photos WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    if (found.length !== ids.length) {
      return res.status(400).json({ error: 'Some selected photos no longer exist. Clear your selection and try again.' });
    }
    const price = Number(setting('price_kobo', '150000'));
    const amount = price * ids.length;
    const reference = 'ORD-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    transaction(() => {
      const info = db
        .prepare('INSERT INTO orders (reference, email, phone, amount_kobo, status) VALUES (?, ?, ?, ?, ?)')
        .run(reference, cleanEmail, String(phone || '').trim().slice(0, 30), amount, 'pending');
      const ins = db.prepare('INSERT INTO order_items (order_id, photo_id) VALUES (?, ?)');
      for (const id of ids) ins.run(Number(info.lastInsertRowid), id);
    });
    if (isDemo()) return res.json({ demo: true, reference });
    const data = await initTransaction({
      email: cleanEmail,
      amountKobo: amount,
      reference,
      callbackUrl: `${baseUrl(req)}/pay/callback`,
    });
    res.json({ authorizationUrl: data.authorization_url, reference });
  } catch (e) {
    next(e);
  }
});

// Demo mode only: simulate a successful payment
router.post('/api/demo-pay', (req, res) => {
  if (!isDemo()) return res.status(403).json({ error: 'Demo payments are disabled when Paystack is configured.' });
  const order = getOrder(String((req.body && req.body.reference) || ''));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  markPaid(order.reference, null);
  res.json({ ok: true });
});

// Paystack redirects here after checkout
router.get('/pay/callback', async (req, res) => {
  const reference = String(req.query.reference || req.query.trxref || '');
  if (reference && !isDemo()) {
    try {
      const data = await verifyTransaction(reference);
      if (data.status === 'success') markPaid(reference, data);
    } catch (e) {
      console.error('Verify failed:', e.message);
    }
  }
  res.redirect(`/#/order/${encodeURIComponent(reference)}`);
});

// Paystack webhook (raw body; mounted with express.raw in server.js)
async function webhookHandler(req, res) {
  try {
    if (isDemo()) return res.sendStatus(200); // no secret key configured — never process webhooks
    const sig = req.headers['x-paystack-signature'];
    const expected = crypto.createHmac('sha512', secret()).update(req.body).digest('hex');
    if (!sig || sig !== expected) return res.sendStatus(401);
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'charge.success') markPaid(event.data.reference, event.data);
  } catch (e) {
    console.error('Webhook error:', e.message);
  }
  res.sendStatus(200);
}

// Order status + fresh signed download links (requires matching email)
router.get('/api/order/:reference', async (req, res) => {
  const order = getOrder(String(req.params.reference || '').trim());
  if (!order) return res.status(404).json({ error: 'Order not found. Check the reference and try again.' });
  const email = String(req.query.email || '').trim().toLowerCase();
  if (email !== order.email.toLowerCase()) {
    return res.status(403).json({ error: 'That email does not match this order.' });
  }
  // Self-heal: if still pending (e.g. webhook missed), re-verify with Paystack
  if (order.status !== 'paid' && !isDemo()) {
    try {
      const data = await verifyTransaction(order.reference);
      if (data.status === 'success') markPaid(order.reference, data);
    } catch {}
  }
  const fresh = getOrder(order.reference);
  const items = orderItems(fresh.id);
  const payload = {
    reference: fresh.reference,
    status: fresh.status,
    amountKobo: fresh.amount_kobo,
    paidAt: fresh.paid_at,
    createdAt: fresh.created_at,
    items: items.map((p) => ({ id: p.id, label: p.label, section: p.section_name, thumbUrl: `/media/thumbs/${p.thumb}` })),
  };
  if (fresh.status === 'paid') {
    payload.items = items.map((p) => {
      const { exp, sig } = sign(['dl', fresh.reference, String(p.id)], DOWNLOAD_TTL);
      return {
        id: p.id,
        label: p.label,
        section: p.section_name,
        thumbUrl: `/media/thumbs/${p.thumb}`,
        downloadUrl: `/api/download/${p.id}?ref=${encodeURIComponent(fresh.reference)}&exp=${exp}&sig=${sig}`,
      };
    });
    const all = sign(['zip', fresh.reference], DOWNLOAD_TTL);
    payload.downloadAllUrl = `/api/download-all/${encodeURIComponent(fresh.reference)}?exp=${all.exp}&sig=${all.sig}`;
  }
  res.json(payload);
});

function cleanName(s) {
  return (
    String(s || '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'photo'
  );
}

// Serves the ORIGINAL full-quality file — only with a valid signed link on a paid order
router.get('/api/download/:photoId', (req, res) => {
  const { ref, exp, sig } = req.query;
  const photoId = String(req.params.photoId);
  if (!verify(['dl', String(ref || ''), photoId], exp, sig)) {
    return res.status(403).send('This download link is invalid or has expired. Open your order page for a fresh link.');
  }
  const order = getOrder(String(ref));
  if (!order || order.status !== 'paid') return res.status(403).send('Order not paid.');
  const item = db.prepare('SELECT 1 FROM order_items WHERE order_id = ? AND photo_id = ?').get(order.id, Number(photoId));
  if (!item) return res.status(403).send('This photo is not part of your order.');
  const photo = db
    .prepare('SELECT p.*, s.name AS section_name FROM photos p JOIN sections s ON s.id = p.section_id WHERE p.id = ?')
    .get(Number(photoId));
  if (!photo) return res.status(404).send('Photo not found.');
  const file = path.join(DIRS.originals, photo.original);
  if (!fs.existsSync(file)) return res.status(404).send('File missing on server.');
  const ext = path.extname(photo.original) || '.jpg';
  res.download(file, `${cleanName(photo.section_name)}-${cleanName(photo.label)}-${photo.id}${ext}`);
});

// ZIP of all originals in a paid order
router.get('/api/download-all/:reference', (req, res) => {
  const { exp, sig } = req.query;
  const reference = String(req.params.reference);
  if (!verify(['zip', reference], exp, sig)) {
    return res.status(403).send('This download link is invalid or has expired. Open your order page for a fresh link.');
  }
  const order = getOrder(reference);
  if (!order || order.status !== 'paid') return res.status(403).send('Order not paid.');
  const items = orderItems(order.id);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="ordination-photos-${cleanName(reference)}.zip"`);
  const archive = archiver('zip', { zlib: { level: 0 } }); // JPEGs don't compress — store
  archive.on('error', (err) => {
    console.error('Zip error:', err.message);
    try { res.end(); } catch {}
  });
  archive.pipe(res);
  for (const p of items) {
    const file = path.join(DIRS.originals, p.original);
    if (fs.existsSync(file)) {
      archive.file(file, { name: `${cleanName(p.section_name)}-${cleanName(p.label)}-${p.id}${path.extname(p.original) || '.jpg'}` });
    }
  }
  archive.finalize();
});

module.exports = { router, webhookHandler };

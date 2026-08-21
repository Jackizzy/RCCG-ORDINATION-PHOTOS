# RCCG Ordination Photos

A web app for selling ordination photos, year after year. Every ordination level is covered —
Deacon & Deaconess, Assistant Pastor, and Pastor — and each year's ordination is kept as a
browsable archive alongside the current one. Ordinands pick their ordination, open the section (folder) of the Senior Pastor
who anointed them — each folder shows that pastor's **headshot and name** — browse **watermarked
previews** for free, select their photos, pay with **Paystack**, and instantly download the clean,
full-quality originals.

## How the protection works (please read)

No website can stop screenshots — that happens at the phone/computer level, outside the browser.
So instead of trying to lock the screen, this app makes the free view worthless to steal:

- Every public image is **low resolution (max 1000px)** with a watermark **tiled diagonally across
  the whole photo**, including faces. Screenshotting or cropping gets nothing worth printing.
- The **full-quality originals never leave the server** until someone pays. They are stored outside
  the public folder and only served through **signed download links** that expire after 7 days
  (buyers can always come back to "Find my order" with their reference + email for fresh links).
- Right-click saving and image dragging are also disabled as a light deterrent.

This is the same model professional photo-sales platforms (Pixieset, ShootProof) use.

## Quick start (try it in 2 minutes)

Requirements: **Node.js 22.5 or newer** — download from https://nodejs.org

```bash
npm install       # install dependencies
npm run seed      # creates 3 sample sections with sample photos
npm start         # starts the app
```

Open **http://localhost:3000** — the ordinand site.
Open **http://localhost:3000/admin** — the admin panel (default password: `admin123`).

Without Paystack keys the app runs in **DEMO MODE**: the checkout has a "Simulate payment" button
so you can test the entire flow, including downloads.

> Note: Node may print an "SQLite is an experimental feature" warning on start — it's harmless.

## Admin panel guide

- **Sections & photos** — pick the year and ordination (Deacon & Deaconess / Assistant Pastor / Pastor), then create one section per anointing Senior Pastor. Upload their headshot
  (it becomes the folder icon) and then bulk-upload that section's photos (you can select hundreds
  at once; watermarked previews are generated automatically — originals are stored untouched).
- **Orders** — every order with email, phone, amount, and paid/pending status.
- **Settings** — price per photo (₦), the **current ordination year** (bump it each new year; old years automatically become the archive), the list of ordination categories, watermark text, site title. If you change the watermark text
  after uploading, use **Regenerate previews**.

## Going live checklist

1. **Set a real admin password.** Copy `.env.example` to `.env` and set `ADMIN_PASSWORD`.
2. **Add Paystack keys.** Paystack Dashboard → Settings → API Keys & Webhooks → copy the
   **Secret key** into `PAYSTACK_SECRET_KEY` in `.env`. (Use test keys first — test cards are in
   Paystack's docs — then switch to live keys.)
3. **Set `BASE_URL`** in `.env` to your public address (e.g. `https://photos.yourchurch.org`) so
   Paystack can redirect buyers back after payment.
4. **Set the webhook (recommended).** In the same Paystack settings page, set the webhook URL to
   `https://YOUR-DOMAIN/api/paystack/webhook`. This confirms payments even if a buyer closes the
   browser before returning. (The app also re-verifies pending orders automatically when the buyer
   opens their order page, so nothing is lost without it.)
5. **Upload the real content**: create the sections with each Senior Pastor's headshot, then bulk
   upload each section's photos. Delete the sample sections from the admin panel.
6. **Restart the server** after any `.env` change.

## Deploying

Any Node host works. Two easy options:

- **Render / Railway**: create a Web Service from this folder (build: `npm install`,
  start: `npm start`). **Attach a persistent disk** — all photos + the database live in the
  `data/` folder, and without a persistent disk you lose uploads on every restart/deploy.
- **A VPS** (better for large photo volumes — 2,000+ high-res photos can be tens of GB):
  install Node 22, `npm install`, run with a process manager (`pm2 start server.js`), put
  Nginx/Caddy in front for HTTPS.

**Back up the `data/` folder.** It contains every original photo and the order database.

## Prices & money

- Price is **per photo**, set in Settings (₦1,500 default).
- Payments go straight to your Paystack account; payouts follow your Paystack settlement schedule.
- Buyers get an instant download page, per-photo downloads plus a ZIP of everything, and can
  re-download later via **Find my order** (reference + email).

## Security notes

- The server **refuses to start** with live Paystack keys unless ADMIN_PASSWORD is set.
- Admin sessions and download links are signed (HMAC) and expire; downloads also require a paid order.
- Full-quality originals are never publicly reachable — only watermarked previews are served.
- Security headers (CSP, no-sniff, no-framing) are on by default. Serve the site over **HTTPS** in
  production (Render/Railway do this automatically; on a VPS use Caddy or Nginx + Let's Encrypt).
- Payments are verified server-side against Paystack (amount and currency must match the order) —
  the client is never trusted about payment status.
- Back up the `data/` folder regularly; it holds your photos and order records.

## Honest FAQ

**Can it block screenshots?** No — nothing on the web can. But every visible image is a small,
heavily watermarked copy, so a screenshot is useless for printing. The product people pay for is
the clean high-resolution file.

**Can someone share a paid download link?** Links are signed and expire after 7 days, and getting
fresh links requires the buyer's reference *and* email. A buyer can of course share the file itself
after downloading — that's true of every photo-sales platform.

**What image types can I upload?** JPEG, PNG or WebP, up to 35 MB per file.

## Ideas for later

- Email receipts/download links (e.g. via Resend or Mailgun)
- Offline voucher codes for cash sales at the venue
- Cloud storage (S3/Cloudflare R2) if photos outgrow the server disk
- Face search so ordinands can find themselves faster

## Project layout

```
server.js          entry point
db.js              SQLite database (built into Node — nothing extra to install)
lib/watermark.js   preview/thumbnail watermarking (sharp)
lib/paystack.js    Paystack init/verify
lib/auth.js        signed download links + admin session
routes/            public API, checkout/downloads, admin API
public/            ordinand site (index.html/app.js) + admin panel (admin.html/admin.js)
data/              created at runtime: originals, previews, thumbs, headshots, app.db
```

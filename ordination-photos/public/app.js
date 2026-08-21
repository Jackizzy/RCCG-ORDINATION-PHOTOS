(() => {
  const app = document.getElementById('app');
  const overlayRoot = document.getElementById('overlay-root');
  let config = { siteTitle: 'Ordination Photos', priceKobo: 150000, demoMode: false, categories: ['Pastor'], currentYear: new Date().getFullYear() };
  let sectionsCache = null;
  const sectionData = new Map();

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (kobo) => '₦' + Math.round(kobo / 100).toLocaleString('en-US');
  const initials = (name) =>
    name.replace(/^Pastor\s+/i, '').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 2).join('');

  // ---- cart (persisted) ----
  let cart = new Map();
  try { cart = new Map(JSON.parse(localStorage.getItem('cart') || '[]')); } catch {}
  const saveCart = () => { try { localStorage.setItem('cart', JSON.stringify([...cart])); } catch {} };

  // ---- orders remembered on this device ----
  const myOrders = () => { try { return JSON.parse(localStorage.getItem('myOrders') || '[]'); } catch { return []; } };
  const rememberOrder = (reference, email) => {
    const list = myOrders().filter((o) => o.reference !== reference);
    list.unshift({ reference, email, at: Date.now() });
    try { localStorage.setItem('myOrders', JSON.stringify(list.slice(0, 20))); } catch {}
  };

  async function api(path, opts) {
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  async function loadSections() {
    if (!sectionsCache) sectionsCache = await api('/api/sections');
    return sectionsCache;
  }
  // Categories to display: configured list first, then any extra ones found on sections
  function allCategories(year) {
    const cats = [...config.categories];
    (sectionsCache || []).forEach((s) => { if (s.year === year && !cats.includes(s.category)) cats.push(s.category); });
    return cats;
  }
  // Years with content (newest first) — the current year always shows
  function allYears() {
    const set = new Set([config.currentYear]);
    (sectionsCache || []).forEach((s) => set.add(s.year));
    return [...set].sort((a, b) => b - a);
  }
  const yearHref = (y) => (y === config.currentYear ? '#/' : '#/year/' + y);
  function chipsHtml(active) {
    const ys = allYears();
    if (ys.length < 2) return '';
    return `<div class="year-chips">${ys.map((y) =>
      `<a class="chip ${y === active ? 'active' : ''}" href="${yearHref(y)}">${y}</a>`).join('')}</div>`;
  }

  const heroHtml = () => `
    <div class="hero">
      <img class="hero-logo" src="/logo.png" alt="RCCG" draggable="false">
      <h1>Your Ordination, Captured</h1>
      <p>Select your ordination, then find the section of the Senior Pastor who anointed you.
      Browse the photos and download your full-quality pictures for ${fmtN(config.priceKobo)} each.</p>
    </div>`;

  // ---------- Home: choose year + ordination ----------
  async function renderHome(yearArg) {
    app.innerHTML = heroHtml() + `<div id="home-body"><div class="muted" style="text-align:center">Loading…</div></div>`;
    try { await loadSections(); } catch (e) {
      document.getElementById('home-body').innerHTML = `<div class="muted">${esc(e.message)}</div>`;
      return;
    }
    const year = Number(yearArg) || config.currentYear;
    const cats = allCategories(year);
    const counts = {};
    sectionsCache.filter((s) => s.year === year).forEach((s) => {
      counts[s.category] = counts[s.category] || { s: 0, p: 0 };
      counts[s.category].s++;
      counts[s.category].p += s.photoCount;
    });
    document.getElementById('home-body').innerHTML = `
      ${chipsHtml(year)}
      <div class="year-caption">Ordination ${year}${year !== config.currentYear ? ' · Archive' : ''}</div>
      <div class="cat-grid">${cats.map((c) => {
        const n = counts[c] || { s: 0, p: 0 };
        return `
        <a class="cat-card" href="#/group/${year}/${encodeURIComponent(c)}">
          <div class="cat-name">${esc(c)}</div>
          <div class="cat-sub">${n.s ? `${n.s} section${n.s === 1 ? '' : 's'} · ${n.p} photo${n.p === 1 ? '' : 's'}` : 'Photos coming soon'}</div>
        </a>`;
      }).join('')}</div>`;
  }

  // ---------- Ordination group: its section folders ----------
  async function renderGroup(year, cat) {
    app.innerHTML = `<div class="muted" style="padding:24px">Loading…</div>`;
    try { await loadSections(); } catch (e) {
      app.innerHTML = `<div class="muted" style="padding:24px">${esc(e.message)}</div>`;
      return;
    }
    const list = sectionsCache.filter((s) => s.category === cat && s.year === year);
    app.innerHTML = `
      <div class="section-head">
        <a class="back" href="${yearHref(year)}">‹ Ordination ${year}</a>
        <div class="section-title"><div>
          <h2>${esc(cat)} · ${year}</h2>
          <div class="muted tiny">Find the section of the Senior Pastor who anointed you</div>
        </div></div>
      </div>
      <input id="search" class="search" type="search" placeholder="Search Senior Pastor’s name…">
      <div id="sections" class="sections-grid"></div>`;
    const grid = document.getElementById('sections');
    const draw = (q) => {
      const filtered = list.filter((s) => s.name.toLowerCase().includes(q));
      grid.innerHTML = filtered.length
        ? filtered.map((s) => `
          <a class="section-card" href="#/section/${s.id}">
            ${s.headshotUrl
              ? `<img class="avatar" src="${s.headshotUrl}" alt="" draggable="false">`
              : `<div class="avatar avatar-fallback">${esc(initials(s.name))}</div>`}
            <div class="section-name">${esc(s.name)}</div>
            <div class="section-count">${s.photoCount} photo${s.photoCount === 1 ? '' : 's'}</div>
          </a>`).join('')
        : `<div class="muted">${list.length ? 'No section matches that name.' : 'No sections here yet. Photos are being uploaded — please check back soon.'}</div>`;
    };
    draw('');
    document.getElementById('search').addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
  }

  // ---------- Section gallery ----------
  async function renderSection(id) {
    app.innerHTML = `<div class="muted" style="padding:24px">Loading photos…</div>`;
    let data = sectionData.get(id);
    if (!data) {
      try {
        data = await api(`/api/sections/${id}/photos`);
        sectionData.set(id, data);
      } catch (e) {
        app.innerHTML = `<div class="muted" style="padding:24px">${esc(e.message)}</div>`;
        return;
      }
    }
    const { section, photos } = data;
    app.innerHTML = `
      <div class="section-head">
        <a class="back" href="#/group/${section.year}/${encodeURIComponent(section.category)}">‹ ${esc(section.category)} · ${section.year}</a>
        <div class="section-title">
          ${section.headshotUrl ? `<img class="avatar sm" src="${section.headshotUrl}" draggable="false" alt="">` : ''}
          <div>
            <h2>${esc(section.name)}</h2>
            <div class="muted tiny">${photos.length} photos · ${fmtN(config.priceKobo)} each · tap to view, tick to select</div>
          </div>
        </div>
      </div>
      <div class="photo-grid">
        ${photos.map((p, i) => `
          <figure class="tile ${cart.has(p.id) ? 'selected' : ''}" data-id="${p.id}">
            <img src="${p.thumbUrl}" alt="${esc(p.label)}" loading="lazy" draggable="false" data-index="${i}">
            <button class="tick" aria-label="Select photo" data-id="${p.id}">✓</button>
          </figure>`).join('')}
      </div>
      ${photos.length ? '' : '<div class="muted" style="padding:20px 4px">No photos in this section yet.</div>'}`;
    app.querySelector('.photo-grid').addEventListener('click', (e) => {
      const tick = e.target.closest('.tick');
      if (tick) { toggle(Number(tick.dataset.id), data); return; }
      const img = e.target.closest('img');
      if (img) openLightbox(data, Number(img.dataset.index));
    });
  }

  function toggle(photoId, data) {
    if (cart.has(photoId)) {
      cart.delete(photoId);
    } else {
      const p = data.photos.find((x) => x.id === photoId);
      if (!p) return;
      cart.set(photoId, { id: p.id, thumbUrl: p.thumbUrl, label: p.label, section: data.section.name });
    }
    saveCart();
    syncTiles();
    renderCartBar();
  }
  function syncTiles() {
    document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('selected', cart.has(Number(t.dataset.id))));
  }

  // ---------- Lightbox ----------
  function openLightbox(data, index) {
    const cur = () => data.photos[index];
    overlayRoot.innerHTML = `
      <div class="lightbox">
        <button class="lb-close" aria-label="Close">✕</button>
        <button class="lb-prev" aria-label="Previous">‹</button>
        <img class="lb-img" src="" alt="" draggable="false">
        <button class="lb-next" aria-label="Next">›</button>
        <div class="lb-bar">
          <span class="lb-label"></span>
          <button class="btn lb-select"></button>
        </div>
      </div>`;
    const el = overlayRoot.querySelector('.lightbox');
    const img = el.querySelector('.lb-img');
    const selBtn = el.querySelector('.lb-select');
    const close = () => (overlayRoot.innerHTML = '');
    const update = () => {
      img.src = cur().previewUrl;
      el.querySelector('.lb-label').textContent = cur().label || '';
      const inCart = cart.has(cur().id);
      selBtn.textContent = inCart ? '✓ Selected — tap to remove' : `Select · ${fmtN(config.priceKobo)}`;
      selBtn.className = 'btn lb-select' + (inCart ? ' outline' : ' gold');
    };
    el.querySelector('.lb-close').onclick = close;
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.querySelector('.lb-prev').onclick = () => { index = (index - 1 + data.photos.length) % data.photos.length; update(); };
    el.querySelector('.lb-next').onclick = () => { index = (index + 1) % data.photos.length; update(); };
    selBtn.onclick = () => { toggle(cur().id, data); update(); };
    document.addEventListener('keydown', function onKey(e) {
      if (!overlayRoot.querySelector('.lightbox')) return document.removeEventListener('keydown', onKey);
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') el.querySelector('.lb-prev').click();
      if (e.key === 'ArrowRight') el.querySelector('.lb-next').click();
    });
    update();
  }

  // ---------- Cart bar ----------
  function ensureCartBar() {
    const d = document.createElement('div');
    d.id = 'cart-bar';
    d.className = 'cart-bar';
    d.hidden = true;
    document.body.appendChild(d);
    renderCartBar();
  }
  function renderCartBar() {
    const bar = document.getElementById('cart-bar');
    if (!bar) return;
    if (!cart.size) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = `
      <div class="cart-info"><strong>${cart.size}</strong> photo${cart.size > 1 ? 's' : ''} · ${fmtN(cart.size * config.priceKobo)}</div>
      <button class="btn ghost" id="cart-clear">Clear</button>
      <button class="btn gold" id="cart-checkout">Checkout</button>`;
    bar.querySelector('#cart-clear').onclick = () => { cart.clear(); saveCart(); syncTiles(); renderCartBar(); };
    bar.querySelector('#cart-checkout').onclick = openCheckout;
  }

  // ---------- Checkout ----------
  function openCheckout() {
    const items = [...cart.values()];
    if (!items.length) return;
    overlayRoot.innerHTML = `
      <div class="sheet-wrap">
        <div class="sheet">
          <h3>Checkout</h3>
          <div class="sheet-items">${items.map((i) => `<img src="${i.thumbUrl}" draggable="false" title="${esc(i.label)}">`).join('')}</div>
          <div class="sheet-total">${items.length} photo${items.length > 1 ? 's' : ''} · <strong>${fmtN(items.length * config.priceKobo)}</strong></div>
          <label>Email (your downloads are tied to this)
            <input id="co-email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
          <label>Phone (optional)
            <input id="co-phone" type="tel" autocomplete="tel" placeholder="0803 000 0000"></label>
          <div class="err" id="co-err"></div>
          <div class="sheet-actions">
            <button class="btn ghost" id="co-cancel">Cancel</button>
            <button class="btn gold" id="co-pay">${config.demoMode ? 'Simulate payment (demo)' : 'Pay with Paystack'}</button>
          </div>
          <p class="tiny muted" style="margin-top:12px">After payment you get download links to the clean, full-quality photos.
          Keep your order reference — you can re-download any time from “Find my order”.</p>
        </div>
      </div>`;
    const wrap = overlayRoot.querySelector('.sheet-wrap');
    wrap.addEventListener('click', (e) => { if (e.target === wrap) overlayRoot.innerHTML = ''; });
    document.getElementById('co-cancel').onclick = () => (overlayRoot.innerHTML = '');
    const payBtn = document.getElementById('co-pay');
    payBtn.onclick = async () => {
      const email = document.getElementById('co-email').value.trim();
      const phone = document.getElementById('co-phone').value.trim();
      const err = document.getElementById('co-err');
      if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Enter a valid email — your downloads are tied to it.'; return; }
      err.textContent = '';
      payBtn.disabled = true;
      payBtn.textContent = 'Processing…';
      try {
        const r = await api('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, phone, photoIds: [...cart.keys()] }),
        });
        rememberOrder(r.reference, email);
        if (r.demo) {
          await api('/api/demo-pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reference: r.reference }),
          });
          cart.clear(); saveCart(); renderCartBar();
          overlayRoot.innerHTML = '';
          location.hash = `#/order/${encodeURIComponent(r.reference)}`;
        } else {
          cart.clear(); saveCart();
          window.location.href = r.authorizationUrl;
        }
      } catch (e) {
        err.textContent = e.message;
        payBtn.disabled = false;
        payBtn.textContent = config.demoMode ? 'Simulate payment (demo)' : 'Pay with Paystack';
      }
    };
  }

  // ---------- Order / downloads ----------
  async function renderOrder(reference) {
    const known = myOrders().find((o) => o.reference === reference);
    const email = known && known.email;
    if (!email) {
      renderFind({ reference, note: 'Enter the email you paid with to open this order.' });
      return;
    }
    app.innerHTML = `<div class="muted" style="padding:24px">Loading your order…</div>`;
    let order;
    try {
      order = await api(`/api/order/${encodeURIComponent(reference)}?email=${encodeURIComponent(email)}`);
    } catch (e) {
      renderFind({ reference, note: e.message });
      return;
    }
    if (order.status !== 'paid') {
      app.innerHTML = `
        <div class="order-box">
          <h2>Payment pending</h2>
          <p class="muted">Order <code>${esc(order.reference)}</code> hasn’t been confirmed yet.
          If you just paid, give it a moment and refresh.</p>
          <button class="btn gold" id="ord-refresh">Refresh</button>
        </div>`;
      document.getElementById('ord-refresh').onclick = () => location.reload();
      return;
    }
    app.innerHTML = `
      <div class="order-box">
        <h2>✓ Payment confirmed</h2>
        <p class="muted">Order <code>${esc(order.reference)}</code> · ${order.items.length} photo${order.items.length > 1 ? 's' : ''} · ${fmtN(order.amountKobo)}.
        Save this reference — you can retrieve your downloads any time from “Find my order”.</p>
        <a class="btn gold wide" href="${order.downloadAllUrl}">⬇ Download all (${order.items.length}) as ZIP</a>
        <div class="dl-grid">
          ${order.items.map((i) => `
            <div class="dl-item">
              <img src="${i.thumbUrl}" draggable="false" alt="">
              <div class="dl-meta"><div>${esc(i.label)}</div><div class="tiny muted">${esc(i.section)}</div></div>
              <a class="btn" href="${i.downloadUrl}">Download</a>
            </div>`).join('')}
        </div>
        <p class="tiny muted" style="margin-top:12px">Downloads are the original full-quality photos — no watermark.
        Links refresh whenever you reopen this page.</p>
      </div>`;
  }

  // ---------- Find my order ----------
  function renderFind(pre = {}) {
    const orders = myOrders();
    app.innerHTML = `
      <div class="order-box">
        <h2>Find my order</h2>
        ${pre.note ? `<p class="err">${esc(pre.note)}</p>` : `<p class="muted">Enter your order reference (e.g. ORD-3F9A21D0B2) and the email you paid with.</p>`}
        <label>Order reference <input id="f-ref" value="${esc(pre.reference || '')}" placeholder="ORD-…"></label>
        <label>Email <input id="f-email" type="email" placeholder="you@example.com"></label>
        <button class="btn gold" id="f-go">Open my downloads</button>
        ${orders.length ? `<h3 class="tiny-h">Orders on this device</h3>` + orders.map((o) => `<a class="mini-order" href="#/order/${encodeURIComponent(o.reference)}">${esc(o.reference)}</a>`).join('') : ''}
      </div>`;
    document.getElementById('f-go').onclick = () => {
      const ref = document.getElementById('f-ref').value.trim().toUpperCase();
      const em = document.getElementById('f-email').value.trim();
      if (!ref || !em) return;
      rememberOrder(ref, em);
      const target = `#/order/${encodeURIComponent(ref)}`;
      if (location.hash === target) route();
      else location.hash = target;
    };
  }

  // ---------- Router ----------
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [a, b] = h.split('/');
    overlayRoot.innerHTML = '';
    window.scrollTo(0, 0);
    const parts = h.split('/');
    if (a === 'year' && parts[1]) return renderHome(parts[1]);
    if (a === 'group' && parts[2]) return renderGroup(Number(parts[1]), decodeURIComponent(parts[2]));
    if (a === 'section' && b) return renderSection(Number(b));
    if (a === 'order' && b) return renderOrder(decodeURIComponent(b));
    if (a === 'find') return renderFind();
    return renderHome();
  }
  window.addEventListener('hashchange', route);

  // Light deterrents (real protection = watermarked previews; originals stay server-side)
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('img')) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (e.target.closest('img')) e.preventDefault(); });

  (async () => {
    try {
      config = await api('/api/config');
      document.getElementById('site-title').textContent = config.siteTitle;
      document.title = config.siteTitle;
      document.getElementById('demo-banner').hidden = !config.demoMode;
    } catch {}
    ensureCartBar();
    route();
  })();
})();

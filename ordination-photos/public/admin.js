(() => {
  const app = document.getElementById('app');
  const logoutLink = document.getElementById('logout');
  let overview = null;
  let tab = 'sections';

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (kobo) => '₦' + Math.round(kobo / 100).toLocaleString('en-US');

  async function api(path, opts = {}) {
    const r = await fetch(path, opts);
    if (r.status === 401) { renderLogin(); throw new Error('Please sign in.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  }
  const cats = () => (overview && overview.settings.categories) || ['Pastor'];
  const catOptions = (selected) =>
    cats().map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');

  // ---------- Login ----------
  function renderLogin(msg = '') {
    logoutLink.hidden = true;
    app.innerHTML = `
      <div class="card" style="max-width:420px;margin:40px auto;text-align:center">
        <img class="login-logo" src="/logo.png" alt="RCCG" draggable="false">
        <h3>Admin Sign In</h3>
        <label>Password <input id="pw" type="password" autocomplete="current-password"></label>
        <div class="err" id="login-err">${esc(msg)}</div>
        <button class="btn gold" id="login-btn">Sign in</button>
      </div>`;
    const go = async () => {
      try {
        await api('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: document.getElementById('pw').value }),
        });
        boot();
      } catch (e) {
        document.getElementById('login-err').textContent = e.message;
      }
    };
    document.getElementById('login-btn').onclick = go;
    document.getElementById('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  logoutLink.onclick = async (e) => {
    e.preventDefault();
    await fetch('/api/admin/logout', { method: 'POST' });
    renderLogin('Signed out.');
  };

  // ---------- Main shell ----------
  async function boot() {
    try {
      overview = await api('/api/admin/overview');
    } catch { return; }
    logoutLink.hidden = false;
    renderShell();
  }

  function renderShell() {
    app.innerHTML = `
      ${overview.defaultPassword ? `<div class="warn red">You are using the default admin password (<b>admin123</b>). Set ADMIN_PASSWORD in your .env file before going live.</div>` : ''}
      ${overview.demoMode ? `<div class="warn">Demo mode — payments are simulated. Add your PAYSTACK_SECRET_KEY in .env to accept real payments.</div>` : ''}
      <div class="stat-row">
        <div class="stat"><b>${overview.sections}</b><span>Sections</span></div>
        <div class="stat"><b>${overview.photos}</b><span>Photos</span></div>
        <div class="stat"><b>${overview.paidOrders}</b><span>Paid orders</span></div>
        <div class="stat"><b>${fmtN(overview.revenueKobo)}</b><span>Revenue</span></div>
      </div>
      <div class="tabs">
        <button class="tab ${tab === 'sections' ? 'active' : ''}" data-t="sections">Sections & photos</button>
        <button class="tab ${tab === 'orders' ? 'active' : ''}" data-t="orders">Orders</button>
        <button class="tab ${tab === 'settings' ? 'active' : ''}" data-t="settings">Settings</button>
      </div>
      <div id="tab-body"></div>`;
    app.querySelectorAll('.tab').forEach((b) => (b.onclick = () => { tab = b.dataset.t; renderShell(); }));
    if (tab === 'sections') renderSections();
    if (tab === 'orders') renderOrders();
    if (tab === 'settings') renderSettings();
  }

  async function refreshOverview() {
    try { overview = await api('/api/admin/overview'); } catch {}
  }

  // ---------- Sections ----------
  async function renderSections() {
    const body = document.getElementById('tab-body');
    let sections;
    try { sections = await api('/api/sections'); } catch (e) { body.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    body.innerHTML = `
      <div class="card">
        <h3>New section</h3>
        <p class="tiny muted">One section per anointing Senior Pastor. The headshot becomes the folder icon ordinands tap.</p>
        <label>Year <input type="number" id="ns-year" value="${overview.settings.currentYear}"></label>
        <label>Ordination
          <select class="field-select" id="ns-cat">${catOptions(cats()[0])}</select></label>
        <label>Senior Pastor’s name <input type="text" id="ns-name" placeholder="e.g. Pastor D. O. Adeyemi"></label>
        <label>Headshot photo <input type="file" id="ns-headshot" accept="image/*"></label>
        <div class="err" id="ns-err"></div>
        <button class="btn gold" id="ns-create">Create section</button>
      </div>
      <div class="card">
        <h3>Sections (${sections.length})</h3>
        <div id="sec-list">${sections.length ? '' : '<p class="muted tiny">No sections yet — create the first one above.</p>'}</div>
      </div>`;
    const list = document.getElementById('sec-list');
    const years = [...new Set(sections.map((s) => s.year))].sort((a, b) => b - a);
    list.innerHTML += years.map((yr) => {
      const inYear = sections.filter((s) => s.year === yr);
      const groups = [...cats()];
      inYear.forEach((s) => { if (!groups.includes(s.category)) groups.push(s.category); });
      return groups.map((g) => {
        const rows = inYear.filter((s) => s.category === g);
        if (!rows.length) return '';
        return `<h3 class="tiny-h">${yr}${yr === overview.settings.currentYear ? ' (current)' : ''} · ${esc(g)} (${rows.length})</h3>` + rows.map((s) => `
        <div class="sec-row" data-id="${s.id}">
          ${s.headshotUrl ? `<img class="avatar sm" src="${s.headshotUrl}" alt="">` : `<div class="avatar sm avatar-fallback">•</div>`}
          <div class="grow">
            <div class="name">${esc(s.name)}</div>
            <div class="sub">${s.photoCount} photos</div>
          </div>
          <button class="btn" data-open="${s.id}">Open</button>
          <button class="btn danger" data-del="${s.id}">Delete</button>
        </div>`).join('');
      }).join('');
    }).join('');
    list.onclick = async (e) => {
      const open = e.target.closest('[data-open]');
      const del = e.target.closest('[data-del]');
      if (open) return renderSectionDetail(Number(open.dataset.open));
      if (del) {
        const s = sections.find((x) => x.id === Number(del.dataset.del));
        if (!confirm(`Delete "${s.name}" and all ${s.photoCount} photos? This cannot be undone.`)) return;
        try { await api(`/api/admin/sections/${s.id}`, { method: 'DELETE' }); await refreshOverview(); renderShell(); }
        catch (err) { alert(err.message); }
      }
    };
    document.getElementById('ns-create').onclick = async () => {
      const name = document.getElementById('ns-name').value.trim();
      const file = document.getElementById('ns-headshot').files[0];
      const err = document.getElementById('ns-err');
      if (!name) { err.textContent = 'Enter the Senior Pastor’s name.'; return; }
      const fd = new FormData();
      fd.append('name', name);
      fd.append('category', document.getElementById('ns-cat').value);
      fd.append('year', document.getElementById('ns-year').value);
      if (file) fd.append('headshot', file);
      try {
        await api('/api/admin/sections', { method: 'POST', body: fd });
        await refreshOverview();
        renderShell();
      } catch (e2) { err.textContent = e2.message; }
    };
  }

  // ---------- Section detail: upload & manage photos ----------
  async function renderSectionDetail(id) {
    const body = document.getElementById('tab-body');
    let data;
    try { data = await api(`/api/sections/${id}/photos`); } catch (e) { body.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    const { section, photos } = data;
    body.innerHTML = `
      <div class="card">
        <a href="#" id="back-sections" class="back">‹ All sections</a>
        <div class="section-title" style="margin-top:10px">
          ${section.headshotUrl ? `<img class="avatar sm" src="${section.headshotUrl}" alt="">` : ''}
          <div>
            <h3>${esc(section.name)}</h3>
            <div class="sub muted tiny">${esc(section.category)} · ${section.year}</div>
          </div>
        </div>
        <label style="margin-top:14px">Add photos (you can select hundreds at once)
          <input type="file" id="ph-files" accept="image/*" multiple></label>
        <button class="btn gold" id="ph-upload">Upload</button>
        <div class="progress" id="ph-progress"></div>
        <p class="tiny muted">Originals are stored untouched and never shown publicly. Watermarked previews are generated automatically.</p>
      </div>
      <div class="card">
        <h3>Edit section</h3>
        <label>Year <input type="number" id="ed-year" value="${section.year}"></label>
        <label>Ordination <select class="field-select" id="ed-cat">${catOptions(section.category)}</select></label>
        <label>Senior Pastor’s name <input type="text" id="ed-name" value="${esc(section.name)}"></label>
        <label>Replace headshot (optional) <input type="file" id="ed-headshot" accept="image/*"></label>
        <div class="err" id="ed-err"></div>
        <button class="btn" id="ed-save">Save changes</button>
      </div>
      <div class="card">
        <h3>Photos (${photos.length})</h3>
        <div class="admin-photos">
          ${photos.map((p) => `
            <div class="ap"><img src="${p.thumbUrl}" alt="" loading="lazy"><button data-delp="${p.id}" title="Delete">✕</button></div>`).join('')}
        </div>
      </div>`;
    document.getElementById('back-sections').onclick = (e) => { e.preventDefault(); renderShell(); };
    document.getElementById('ed-save').onclick = async () => {
      const err = document.getElementById('ed-err');
      const fd = new FormData();
      fd.append('name', document.getElementById('ed-name').value.trim());
      fd.append('category', document.getElementById('ed-cat').value);
      fd.append('year', document.getElementById('ed-year').value);
      const f = document.getElementById('ed-headshot').files[0];
      if (f) fd.append('headshot', f);
      try {
        await api(`/api/admin/sections/${id}`, { method: 'PUT', body: fd });
        renderSectionDetail(id);
      } catch (e2) { err.textContent = e2.message; }
    };
    body.querySelector('.admin-photos').onclick = async (e) => {
      const del = e.target.closest('[data-delp]');
      if (!del) return;
      if (!confirm('Delete this photo?')) return;
      try { await api(`/api/admin/photos/${del.dataset.delp}`, { method: 'DELETE' }); renderSectionDetail(id); }
      catch (err) { alert(err.message); }
    };
    document.getElementById('ph-upload').onclick = async () => {
      const files = [...document.getElementById('ph-files').files];
      const progress = document.getElementById('ph-progress');
      if (!files.length) { progress.textContent = 'Choose some photos first.'; return; }
      const btn = document.getElementById('ph-upload');
      btn.disabled = true;
      let done = 0, added = 0;
      const failed = [];
      const CHUNK = 6;
      try {
        for (let i = 0; i < files.length; i += CHUNK) {
          const fd = new FormData();
          files.slice(i, i + CHUNK).forEach((f) => fd.append('photos', f));
          const r = await api(`/api/admin/sections/${id}/photos`, { method: 'POST', body: fd });
          added += r.added;
          failed.push(...(r.failed || []));
          done = Math.min(i + CHUNK, files.length);
          progress.textContent = `Processing ${done} / ${files.length}… (watermarking takes a moment)`;
        }
        progress.textContent = `Done — ${added} added${failed.length ? `, ${failed.length} failed (${failed.slice(0, 3).join(', ')}…)` : ''}.`;
        await refreshOverview();
        setTimeout(() => renderSectionDetail(id), 900);
      } catch (e) {
        progress.textContent = 'Upload error: ' + e.message;
        btn.disabled = false;
      }
    };
  }

  // ---------- Orders ----------
  async function renderOrders() {
    const body = document.getElementById('tab-body');
    let orders;
    try { orders = await api('/api/admin/orders'); } catch (e) { body.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    body.innerHTML = `
      <div class="card">
        <h3>Orders (${orders.length})</h3>
        ${orders.length ? `
        <div style="overflow-x:auto">
        <table class="orders">
          <tr><th>Reference</th><th>Email</th><th>Phone</th><th>Photos</th><th>Amount</th><th>Status</th><th>Date</th></tr>
          ${orders.map((o) => `
            <tr>
              <td><code>${esc(o.reference)}</code></td>
              <td>${esc(o.email)}</td>
              <td>${esc(o.phone || '—')}</td>
              <td>${o.items}</td>
              <td>${fmtN(o.amountKobo)}</td>
              <td><span class="pill ${o.status === 'paid' ? 'paid' : 'pending'}">${esc(o.status)}</span></td>
              <td class="tiny muted">${esc((o.paidAt || o.createdAt || '').slice(0, 16))}</td>
            </tr>`).join('')}
        </table>
        </div>` : '<p class="muted tiny">No orders yet.</p>'}
      </div>`;
  }

  // ---------- Settings ----------
  function renderSettings() {
    const body = document.getElementById('tab-body');
    const s = overview.settings;
    body.innerHTML = `
      <div class="card">
        <h3>Settings</h3>
        <label>Price per photo (₦) <input type="number" id="st-price" min="1" value="${Math.round(s.priceKobo / 100)}"></label>
        <label>Current ordination year <input type="number" id="st-year" value="${s.currentYear}"></label>
        <p class="tiny muted">Visitors land on this year. When a new ordination year starts, change this — earlier years stay browsable as the archive.</p>
        <label>Ordination categories (comma-separated)
          <input type="text" id="st-cats" value="${esc(s.categories.join(', '))}"></label>
        <p class="tiny muted">These appear as the choices on the home page — e.g. Deacon &amp; Deaconess, Assistant Pastor, Pastor.
        Renaming a category does not move existing sections — edit each section to change its ordination.</p>
        <label>Watermark text <input type="text" id="st-wm" value="${esc(s.watermarkText)}"></label>
        <label>Site title <input type="text" id="st-title" value="${esc(s.siteTitle)}"></label>
        <div class="err" id="st-err"></div>
        <button class="btn gold" id="st-save">Save settings</button>
      </div>
      <div class="card">
        <h3>Regenerate previews</h3>
        <p class="tiny muted">Changed the watermark text? This re-creates every preview and thumbnail from the originals.
        It can take a while with many photos — leave the page open.</p>
        <button class="btn" id="st-regen">Regenerate all previews</button>
        <div class="progress" id="st-regen-out"></div>
      </div>
      <div class="card">
        <h3>Payments</h3>
        <p class="tiny muted">${overview.demoMode
          ? 'Currently in <b>demo mode</b>. To accept real payments: get your secret key from the Paystack Dashboard → Settings → API Keys, put it in .env as PAYSTACK_SECRET_KEY, set BASE_URL to your public site address, then restart the server.'
          : 'Paystack is <b>connected</b>. Payments are live.'}</p>
      </div>`;
    document.getElementById('st-save').onclick = async () => {
      const err = document.getElementById('st-err');
      try {
        await api('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            priceKobo: Math.round(Number(document.getElementById('st-price').value) * 100),
            watermarkText: document.getElementById('st-wm').value,
            siteTitle: document.getElementById('st-title').value,
            categories: document.getElementById('st-cats').value,
            currentYear: Number(document.getElementById('st-year').value),
          }),
        });
        await refreshOverview();
        renderShell();
      } catch (e) { err.textContent = e.message; }
    };
    document.getElementById('st-regen').onclick = async () => {
      if (!confirm('Regenerate all previews with the current watermark text?')) return;
      const out = document.getElementById('st-regen-out');
      out.textContent = 'Working… this may take a while.';
      try {
        const r = await api('/api/admin/regenerate', { method: 'POST' });
        out.textContent = `Done — ${r.regenerated} photos re-watermarked.`;
      } catch (e) { out.textContent = 'Error: ' + e.message; }
    };
  }

  boot().catch(() => renderLogin());
})();

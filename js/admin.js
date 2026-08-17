/* =========================================================
   CITY PETS — Lógica del panel de administración
   Conectado a la API (Prisma). Requiere rol admin.
   La sesión usa el mismo JWT del storefront (cp_session).
   ========================================================= */
(() => {
  'use strict';
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let productsCache = [];
  let ordersCache = [];
  let attributionCache = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindLogin();
    bindLogout();
    bindTabs();
    bindProducts();
    bindOrders();
    bindIncidents();
    initSession();
  }

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    $('#toastWrap').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /* ---------- Sesión / login admin ---------- */
  async function initSession() {
    if (!getToken()) { showGate(); return; }
    try {
      const data = await api('/auth/me');
      if (data.user.role !== 'admin') {
        toast('Acceso restringido: se requiere rol administrador', 'error');
        showGate();
        return;
      }
      showApp();
      await refreshAll();
    } catch {
      setToken(null);
      showGate();
    }
  }

  function bindLogin() {
    $('#btnAdminLogin').addEventListener('click', async () => {
      const email = $('#admEmail').value.trim();
      const password = $('#admPassword').value;
      if (!email || !password) { toast('Indica correo y contraseña', 'error'); return; }
      try {
        const data = await api('/auth/login', { method: 'POST', body: { email, password } });
        if (data.user.role !== 'admin') {
          toast('Acceso restringido: se requiere rol administrador', 'error');
          return;
        }
        setToken(data.token);
        $('#admEmail').value = $('#admPassword').value = '';
        showApp();
        await refreshAll();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  function bindLogout() {
    $('#btnAdminLogout').addEventListener('click', () => {
      setToken(null);
      showGate();
      toast('Sesión cerrada');
    });
  }

  function showGate() {
    $('#adminGate').classList.remove('hidden');
    $('#adminApp').classList.add('hidden');
    $('#btnAdminLogout').classList.add('hidden');
  }

  function showApp() {
    $('#adminGate').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    $('#btnAdminLogout').classList.remove('hidden');
  }

  async function refreshAll() {
    try {
      const [products, orders, attribution] = await Promise.all([
        api('/products', { auth: false }),
        api('/admin/orders'),
        api('/admin/attribution')
      ]);
      productsCache = products;
      ordersCache = orders;
      attributionCache = attribution;
      renderAll();
    } catch (e) {
      toast(e.message || 'No se pudieron cargar los datos', 'error');
    }
  }

  function renderAll() {
    renderKPIs();
    renderProductsTable();
    renderOrdersTable();
    renderIncidents();
    renderAttribution();
  }

  /* ---------- Tabs ---------- */
  function bindTabs() {
    document.querySelectorAll('[data-atab]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = a.dataset.atab;
        $$('[data-atab]').forEach(x => x.classList.toggle('active', x.dataset.atab === tab));
        $$('[data-aview]').forEach(v => v.classList.toggle('hidden', v.dataset.aview !== tab));
        renderAll();
      });
    });
  }

  /* ---------- KPIs ---------- */
  function renderKPIs() {
    const orders = ordersCache;
    const pending = orders.filter(o => o.status === 'pendiente');
    const incidents = orders.filter(o => o.status === 'incidente');
    const totalVal = orders.reduce((s, o) => s + o.total, 0);
    const stock = productsCache.reduce((s, p) => s + p.stock, 0);

    $('#kpiOrders').textContent = orders.length;
    $('#kpiOrdersVal').textContent = fmtMoney(totalVal) + ' en ventas';
    $('#kpiPending').textContent = pending.length;
    $('#kpiPendingVal').textContent = pending.length ? 'Próxima entrega: ' + pending[0].deliveryLabel : 'Todo entregado';
    $('#kpiStock').textContent = stock.toLocaleString('es-CO');
    $('#kpiStockProd').textContent = productsCache.length + ' referencias';
    $('#kpiIncidents').textContent = incidents.length;
    const incidentUsers = new Set(incidents.map(i => i.userName));
    $('#kpiIncidentsUsers').textContent = incidentUsers.size + ' usuarios no cumplieron';

    /* Barras de atribución (dashboard) */
    const attr = attributionCache ? attributionCache.channels : [];
    const max = Math.max(1, ...attr.map(a => a.count));
    $('#attributionBars').innerHTML = attr.length ? attr.map(a => `
      <div class="mb-3">
        <div class="row" style="justify-content:space-between;font-size:.85rem">
          <strong>${a.channel}</strong><span>${a.count} usuario${a.count === 1 ? '' : 's'}</span>
        </div>
        <div style="height:12px;background:var(--gray-100);border-radius:8px;overflow:hidden">
          <div style="width:${(a.count / max * 100).toFixed(0)}%;height:100%;background:linear-gradient(90deg,var(--gold-400),var(--gold-600));border-radius:8px"></div>
        </div>
      </div>`).join('') : '<p class="muted">Sin registros de usuarios aún.</p>';

    /* Últimos pedidos (la API ya los entrega ordenados desc) */
    $('#recentOrders').innerHTML = orders.length ? orders.slice(0, 4).map(o => `
      <div class="row" style="justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px dashed var(--gray-100)">
        <div>
          <strong style="font-size:.88rem">${o.id}</strong>
          <div class="muted" style="font-size:.78rem">${o.userName} · ${fmtMoney(o.total)}</div>
        </div>
        <span class="badge ${o.status === 'entregado' ? 'badge-green' : o.status === 'incidente' ? 'badge-red' : 'badge-gold'}">${o.status === 'entregado' ? 'Entregado' : o.status === 'incidente' ? 'Incidente' : 'Pendiente'}</span>
      </div>`).join('') : '<p class="muted">Sin pedidos aún.</p>';
  }

  /* ---------- Productos CMS ---------- */
  function bindProducts() {
    $('#btnNewProduct').addEventListener('click', () => {
      $('#apmId').value = '';
      ['#apmName', '#apmCategory', '#apmUnit', '#apmDesc', '#apmTags'].forEach(s => $(s).value = '');
      ['#apmPrice', '#apmGrams', '#apmStock', '#apmRation'].forEach(s => $(s).value = '');
      $('#apmSpecies').value = 'Perros';
      $('#apmImage').value = '';
      $('#apmVideo').value = '';
      $('#apmImagePreview').innerHTML = '';
      $('#apmTitle').textContent = 'Nuevo producto';
      openModal();
    });

    $('#btnDownloadTemplate').addEventListener('click', downloadTemplate);

    $('#csvInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => importCSV(ev.target.result);
      reader.readAsText(file);
      e.target.value = '';
    });

    $('#btnSaveProduct').addEventListener('click', saveProduct);

    $('#apmImage').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = () => { $('#apmImagePreview').innerHTML = `<img src="${r.result}" style="width:120px;height:90px;object-fit:cover;border-radius:8px" />`; };
      r.readAsDataURL(file);
    });

    $('#adminProducts').addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (edit) editProduct(edit.dataset.edit);
      if (del) deleteProduct(del.dataset.del);
    });
  }

  function renderProductsTable() {
    $('#adminProducts').innerHTML = productsCache.map(p => `
      <tr>
        <td><img src="${p.images[0]}" style="width:52px;height:44px;object-fit:cover;border-radius:6px" /></td>
        <td><strong>${p.name}</strong><br/><span class="muted" style="font-size:.78rem">${p.category} · ${p.unit}</span></td>
        <td>${p.species}</td>
        <td class="money">${fmtMoney(p.price)}</td>
        <td><span class="badge ${p.stock <= 10 ? 'badge-red' : p.stock <= 25 ? 'badge-gold' : 'badge-green'}">${p.stock}</span></td>
        <td>${p.video ? '📹 + 🖼' : '🖼'}</td>
        <td>
          <button class="btn btn-navy btn-sm" data-edit="${p.id}">Editar</button>
          <button class="btn btn-outline btn-sm" style="color:var(--red-500);border-color:var(--red-500)" data-del="${p.id}">Eliminar</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="7" class="ta-center muted">Sin productos. Carga el catálogo o crea uno.</td></tr>`;
  }

  function editProduct(id) {
    const p = productsCache.find(x => x.id === id);
    if (!p) return;
    $('#apmId').value = p.id;
    $('#apmName').value = p.name;
    $('#apmSpecies').value = p.species;
    $('#apmCategory').value = p.category;
    $('#apmPrice').value = p.price;
    $('#apmUnit').value = p.unit;
    $('#apmGrams').value = p.grams;
    $('#apmStock').value = p.stock;
    $('#apmRation').value = p.dailyRation;
    $('#apmDesc').value = p.desc;
    $('#apmTags').value = p.tags.join(';');
    $('#apmImagePreview').innerHTML = `<img src="${p.images[0]}" style="width:120px;height:90px;object-fit:cover;border-radius:8px" />`;
    $('#apmTitle').textContent = 'Editar: ' + p.name;
    openModal();
  }

  async function saveProduct() {
    const id = $('#apmId').value;
    const name = $('#apmName').value.trim();
    const price = parseFloat($('#apmPrice').value);
    const stock = parseInt($('#apmStock').value, 10);
    if (!name || isNaN(price) || isNaN(stock)) { toast('Completa nombre, precio y stock', 'error'); return; }

    const imageFile = $('#apmImage').files[0];
    const videoFile = $('#apmVideo').files[0];

    const commit = async (images, video) => {
      const base = {
        name, species: $('#apmSpecies').value, category: $('#apmCategory').value.trim() || 'General',
        price, unit: $('#apmUnit').value.trim() || '1 und', grams: parseInt($('#apmGrams').value) || 0,
        stock, desc: $('#apmDesc').value.trim(),
        dailyRation: parseInt($('#apmRation').value) || 0,
        tags: $('#apmTags').value.split(';').map(t => t.trim().toLowerCase()).filter(Boolean)
      };
      try {
        if (id) {
          await api('/products/' + id, {
            method: 'PUT',
            body: { ...base, images: images.length ? images : undefined, video: video || undefined }
          });
          toast('Producto actualizado', 'success');
        } else {
          await api('/products', {
            method: 'POST',
            body: {
              ...base,
              images: images.length ? images : ['https://picsum.photos/seed/admin' + Math.floor(Math.random() * 90) + '/600/450'],
              video: video || ''
            }
          });
          toast('Producto creado', 'success');
        }
        closeModal();
        await refreshAll();
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    const images = [];
    const loadImage = imageFile ? new Promise(res => {
      const r = new FileReader();
      r.onload = () => { images.push(r.result); res(); };
      r.readAsDataURL(imageFile);
    }) : Promise.resolve();

    loadImage.then(() => {
      if (videoFile) {
        const r = new FileReader();
        r.onload = () => commit(images, r.result);
        r.readAsDataURL(videoFile);
      } else {
        commit(images, '');
      }
    });
  }

  async function deleteProduct(id) {
    try {
      await api('/products/' + id, { method: 'DELETE' });
      toast('Producto eliminado');
      await refreshAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function downloadTemplate() {
    const header = 'name,species,category,price,unit,grams,stock,desc,dailyRation,tags';
    const rows = productsCache.map(p => `${csv(p.name)},${csv(p.species)},${csv(p.category)},${p.price},${csv(p.unit)},${p.grams},${p.stock},${csv(p.desc)},${p.dailyRation},${csv(p.tags.join(';'))}`);
    const blob = new Blob(['\uFEFF' + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'citypets_catalogo.csv';
    a.click();
  }

  function csv(v) {
    v = String(v ?? '');
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function parseCSV(text) {
    const rows = [];
    let cur = '', row = [], inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
          cur = ''; row = [];
        } else cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  async function importCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) { toast('CSV vacío', 'error'); return; }
    const hdr = rows[0].map(h => h.trim().toLowerCase());
    const idx = (k) => hdr.indexOf(k);
    let added = 0;
    const pending = [];
    rows.slice(1).forEach(r => {
      const get = (k) => { const i = idx(k); return i >= 0 ? (r[i] || '').trim() : ''; };
      const name = get('name');
      if (!name) return;
      pending.push({
        name,
        species: get('species') || 'General',
        category: get('category') || 'General',
        price: parseFloat(get('price')) || 0,
        unit: get('unit') || '1 und',
        grams: parseInt(get('grams')) || 0,
        stock: parseInt(get('stock')) || 0,
        desc: get('desc'),
        dailyRation: parseInt(get('dailyration')) || 0,
        tags: get('tags').split(';').map(t => t.trim().toLowerCase()).filter(Boolean),
        images: ['https://picsum.photos/seed/csv' + Math.floor(Math.random() * 90) + '/600/450']
      });
    });
    for (const body of pending) {
      try { await api('/products', { method: 'POST', body }); added++; } catch { /* fila inválida: se omite */ }
    }
    toast(`✅ ${added} producto(s) cargado(s)`, 'success');
    await refreshAll();
  }

  /* ---------- Pedidos ---------- */
  function bindOrders() {
    $('#adminOrders').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-odeliver]');
      const inc = e.target.closest('[data-oincident]');
      if (!del && !inc) return;
      const id = (del || inc).dataset[inc ? 'oincident' : 'odeliver'];
      const status = del ? 'entregado' : 'incidente';
      try {
        await api('/admin/orders/' + id + '/status', { method: 'PATCH', body: { status } });
        toast(del ? 'Pedido marcado como entregado' : 'Incidencia registrada', 'success');
        await refreshAll();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  function renderOrdersTable() {
    const orders = ordersCache;
    $('#adminOrders').innerHTML = orders.map(o => `
      <tr>
        <td><strong>${o.id}</strong><br/><span class="muted" style="font-size:.75rem">${new Date(o.createdAt).toLocaleString('es-CO')}</span></td>
        <td>${o.userName}<br/><span class="muted" style="font-size:.75rem">📱 ${o.phone}</span></td>
        <td class="money">${fmtMoney(o.total)}</td>
        <td>${o.deliveryLabel}<br/><span class="muted" style="font-size:.75rem">Franja ${o.deliverySlot === 'manana' ? '🌅' : '🌇'}</span></td>
        <td>${o.payment.method === 'efectivo' ? '💵 Efectivo' : '📲 Digital'}</td>
        <td><span class="badge ${o.status === 'entregado' ? 'badge-green' : o.status === 'incidente' ? 'badge-red' : 'badge-gold'}">${o.status === 'entregado' ? 'Entregado' : o.status === 'incidente' ? 'Incidente' : 'Pendiente'}</span></td>
        <td>
          ${o.status !== 'entregado' ? `<button class="btn btn-navy btn-sm" data-odeliver="${o.id}">✓ Entregado</button>` : ''}
          ${o.status !== 'incidente' ? `<button class="btn btn-outline btn-sm" style="color:var(--red-500);border-color:var(--red-500)" data-oincident="${o.id}">⚠ Incidencia</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="ta-center muted">Sin pedidos.</td></tr>';
  }

  /* ---------- Incidencias ---------- */
  function bindIncidents() {
    $('#adminIncidents').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-iresolve]');
      if (!btn) return;
      try {
        await api('/admin/orders/' + btn.dataset.iresolve + '/status', { method: 'PATCH', body: { status: 'entregado' } });
        toast('Incidencia resuelta');
        await refreshAll();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  function renderIncidents() {
    const incidents = ordersCache.filter(o => o.status === 'incidente');
    $('#adminIncidents').innerHTML = incidents.map(o => `
      <tr>
        <td><strong>${o.id}</strong></td>
        <td>${o.userName}</td>
        <td>${o.phone}</td>
        <td>${new Date(o.createdAt).toLocaleString('es-CO')}</td>
        <td>No se cumplió con la entrega programada (${o.deliveryLabel}).</td>
        <td><button class="btn btn-navy btn-sm" data-iresolve="${o.id}">Resolver</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="ta-center muted">No hay incidencias registradas. ✔</td></tr>';
  }

  /* ---------- Atribución ---------- */
  function renderAttribution() {
    const attr = attributionCache ? attributionCache.channels : [];
    const total = attr.reduce((s, a) => s + a.count, 0);
    $('#attributionTable').innerHTML = attr.length ? `
      <table>
        <thead><tr><th>Canal</th><th>Usuarios</th><th>%</th></tr></thead>
        <tbody>${attr.map(a => `
          <tr>
            <td>${a.channel}</td>
            <td>${a.count}</td>
            <td>${total ? (a.count / total * 100).toFixed(1) : 0}%</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">Sin usuarios registrados.</p>';

    const det = attributionCache ? attributionCache.detail.slice(0, 12) : [];
    $('#attributionDetail').innerHTML = det.length ? det.map(a => `
      <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--gray-100);font-size:.88rem">
        <span>${a.userName}</span>
        <span class="badge badge-gold">${a.channel}</span>
      </div>`).join('') : '<p class="muted">Sin registros de atribución.</p>';
  }

  /* ---------- Modal ---------- */
  function openModal() { $('#productModal').classList.add('open'); }
  function closeModal() { $('#productModal').classList.remove('open'); }
  document.querySelectorAll('[data-close-amy]').forEach(b => b.addEventListener('click', closeModal));
})();
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
  let settingsCache = { deliveryCost: 10000, freeDeliveryFrom: 100000 };
  let revenueCache = null;
  let closuresCache = [];

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindLogin();
    bindLogout();
    bindTabs();
    bindProducts();
    bindAdminFilters();
    bindImport();
    bindSettings();
    bindOrders();
    bindOrderFilters();
    bindOrderTools();
    bindRevenue();
    bindClosures();
    bindIncidents();
    bindConfirm();
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
      const period = $('#revPeriod') ? $('#revPeriod').value : 'diario';
      const [products, orders, attribution, settings, revenue, closures] = await Promise.all([
        api('/products', { auth: false }),
        api('/admin/orders?' + ordersQuery()),
        api('/admin/attribution'),
        api('/settings', { auth: false }),
        api('/admin/revenue?period=' + encodeURIComponent(period)),
        api('/admin/closures')
      ]);
      productsCache = products;
      ordersCache = Array.isArray(orders.items) ? orders.items : [];
      ordersMeta = {
        total: orders.total || 0,
        page: orders.page || 1,
        limit: orders.limit || ORDERS_PAGE_SIZE,
        pages: orders.pages || 1,
        totalVal: orders.totalVal || 0,
        byStatus: orders.byStatus || {}
      };
      attributionCache = attribution;
      settingsCache = settings || settingsCache;
      revenueCache = revenue;
      revCustomRange = false;
      closuresCache = Array.isArray(closures) ? closures : [];
      renderAll();
    } catch (e) {
      toast(e.message || 'No se pudieron cargar los datos', 'error');
    }
  }

  function renderAll() {
    renderKPIs();
    renderAlerts();
    renderProductsTable();
    renderOrderFilters();
    renderOrdersTable();
    renderPagination();
    renderIncidents();
    renderAttribution();
    renderSettings();
    renderRevenue();
    renderClosures();
  }

  /* ---------- Cierres de caja persistentes (P3.1) ---------- */
  let pendingCloseRange = null;

  async function loadClosures() {
    try {
      closuresCache = await api('/admin/closures');
      renderClosures();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderClosures() {
    const list = closuresCache;
    $('#closuresList').innerHTML = list.length ? list.map(c => `
      <tr>
        <td>${new Date(c.createdAt).toLocaleString('es-CO')}</td>
        <td>${esc(c.adminName)}</td>
        <td>${esc(c.period)}</td>
        <td>${esc(c.from)}</td>
        <td>${esc(c.to)}</td>
        <td class="money">${fmtMoney(c.total)}</td>
        <td class="money">${fmtMoney(c.efectivo)}</td>
        <td class="money">${fmtMoney(c.digital)}</td>
        <td class="ta-center">${c.cantidadPedidos}</td>
      </tr>`).join('')
    : '<tr><td colspan="9" class="ta-center muted">Aún no hay cierres de caja.</td></tr>';
  }

  function bindClosures() {
    $('#btnCloseCash').addEventListener('click', () => {
      if (!revenueCache) { toast('Consulta primero el recaudo', 'error'); return; }
      pendingCloseRange = {
        period: $('#revPeriod').value,
        from: revenueCache.from,
        to: revenueCache.to,
        label: revenueCache.periodLabel
      };
      $('#cfCloseBody').innerHTML = `
        <p>Se guardará una <strong>fotografía histórica</strong> del recaudo de pedidos entregados.</p>
        <p class="mt-2"><strong>${esc(pendingCloseRange.label)}</strong><br/>
        <span class="muted">Rango: ${pendingCloseRange.from} → ${pendingCloseRange.to}</span></p>
        <p class="mt-2">Total: <strong class="money">${fmtMoney(revenueCache.total)}</strong> · Efectivo: ${fmtMoney(revenueCache.efectivo)} · Digital: ${fmtMoney(revenueCache.digital)}</p>`;
      $('#closureModal').classList.add('open');
    });

    document.querySelectorAll('[data-close-closure]').forEach(b =>
      b.addEventListener('click', () => $('#closureModal').classList.remove('open')));

    $('#btnCloseConfirm').addEventListener('click', async () => {
      if (!pendingCloseRange) return;
      const body = revCustomRange
        ? { from: revenueCache.from, to: revenueCache.to }
        : { period: pendingCloseRange.period };
      try {
        const data = await api('/admin/closures', { method: 'POST', body });
        $('#closureModal').classList.remove('open');
        pendingCloseRange = null;
        toast(`Cierre creado: ${fmtMoney(data.total)} (${data.from} → ${data.to})`, 'success');
        await loadClosures();
      } catch (e) {
        $('#closureModal').classList.remove('open');
        pendingCloseRange = null;
        toast(e.message, 'error');
      }
    });
  }

  /* ---------- Recaudo / cierre de caja (P3) ---------- */
  let revCustomRange = false;

  async function loadRevenue() {
    revCustomRange = false;
    const period = $('#revPeriod').value;
    try {
      revenueCache = await api('/admin/revenue?period=' + encodeURIComponent(period));
      renderRevenue();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function loadRevenueRange() {
    const from = $('#revFrom').value;
    const to = $('#revTo').value;
    if (!from || !to) { toast('Indica desde y hasta para el rango', 'error'); return; }
    revCustomRange = true;
    try {
      revenueCache = await api('/admin/revenue?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
      renderRevenue();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderRevenue() {
    const r = revenueCache;
    if (!r) return;
    $('#revTotal').textContent = fmtMoney(r.total);
    $('#revCash').textContent = fmtMoney(r.efectivo);
    $('#revDigital').textContent = fmtMoney(r.digital);
    $('#revCount').textContent = r.cantidadPedidos;
    $('#revRange').textContent = `Período consultado: ${r.periodLabel} (${r.from} → ${r.to})`;
  }

  function bindRevenue() {
    $('#btnLoadRevenue').addEventListener('click', loadRevenue);
    $('#revPeriod').addEventListener('change', loadRevenue);
    $('#btnRevRange').addEventListener('click', loadRevenueRange);
  }

  /* ---------- Filtros de pedidos (P2.1) ---------- */
  let orderFilter = 'todos';
  let adminSearch = '';
  let adminDateFrom = '';
  let adminDateTo = '';
  let adminSort = 'fecha';
  let ordersPage = 1;
  let ordersMeta = { total: 0, page: 1, limit: 25, pages: 1, totalVal: 0, byStatus: {} };
  const ORDERS_PAGE_SIZE = 25;

  function renderOrderFilters() {
    const bs = ordersMeta.byStatus || {};
    const total = Object.values(bs).reduce((s, v) => s + (v || 0), 0);
    const counts = { todos: total, pendiente: bs.pendiente || 0, confirmado: bs.confirmado || 0, enviado: bs.enviado || 0, entregado: bs.entregado || 0, cancelado: bs.cancelado || 0 };
    $$('#orderFilters [data-ofcount]').forEach(el => {
      el.textContent = counts[el.dataset.ofcount] ?? 0;
    });
  }

  function bindOrderFilters() {
    $('#orderFilters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ofilter]');
      if (!b) return;
      orderFilter = b.dataset.ofilter;
      $$('#orderFilters .tab').forEach(t => t.classList.toggle('active', t.dataset.ofilter === orderFilter));
      ordersPage = 1;
      loadOrders();
    });
  }

  /* ---------- Búsqueda, fechas, orden y paginación de pedidos (P4/P5/P7.2) ---------- */
  function ordersQuery() {
    const params = new URLSearchParams();
    params.set('page', String(ordersPage));
    params.set('limit', String(ORDERS_PAGE_SIZE));
    if (adminSearch) params.set('q', adminSearch);
    if (adminDateFrom) params.set('from', adminDateFrom);
    if (adminDateTo) params.set('to', adminDateTo);
    if (orderFilter !== 'todos') params.set('status', orderFilter);
    params.set('sort', adminSort);
    return params.toString();
  }

  async function loadOrders() {
    try {
      const data = await api('/admin/orders?' + ordersQuery());
      ordersCache = Array.isArray(data.items) ? data.items : [];
      ordersMeta = {
        total: data.total || 0,
        page: data.page || 1,
        limit: data.limit || ORDERS_PAGE_SIZE,
        pages: data.pages || 1,
        totalVal: data.totalVal || 0,
        byStatus: data.byStatus || {}
      };
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* La exportación CSV envía los filtros actuales y exporta TODOS los
     coincidentes (el backend ignora página/limite). */
  function currentOrderExportQuery() {
    const params = new URLSearchParams();
    if (adminSearch) params.set('q', adminSearch);
    if (adminDateFrom) params.set('from', adminDateFrom);
    if (adminDateTo) params.set('to', adminDateTo);
    if (orderFilter !== 'todos') params.set('status', orderFilter);
    params.set('sort', adminSort);
    return params.toString();
  }

  async function downloadCSV(path, filename) {
    try {
      const res = await fetch(API_BASE + path, { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo exportar');
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Exportación descargada');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderPagination() {
    const el = $('#ordersPageInfo');
    if (!el) return;
    el.textContent = `Página ${ordersMeta.page} de ${ordersMeta.pages || 1} · ${ordersMeta.total} pedido(s)`;
    const prev = $('#ordersPrev');
    const next = $('#ordersNext');
    if (prev) prev.disabled = ordersMeta.page <= 1;
    if (next) next.disabled = ordersMeta.page >= (ordersMeta.pages || 1);
  }

  function bindOrderTools() {
    const reloadPage1 = () => { ordersPage = 1; loadOrders(); };
    $('#ordSearch').addEventListener('input', reloadPage1);
    $('#ordFrom').addEventListener('change', reloadPage1);
    $('#ordTo').addEventListener('change', reloadPage1);
    $('#ordSort').addEventListener('change', reloadPage1);
    $('#ordersPrev').addEventListener('click', () => { if (ordersMeta.page > 1) { ordersPage--; loadOrders(); } });
    $('#ordersNext').addEventListener('click', () => { if (ordersMeta.page < (ordersMeta.pages || 1)) { ordersPage++; loadOrders(); } });
    $('#btnExportOrders').addEventListener('click', () => downloadCSV('/admin/export/orders?' + currentOrderExportQuery(), 'citypets_pedidos.csv'));
    $('#btnExportClosures').addEventListener('click', () => downloadCSV('/admin/export/closures', 'citypets_cierres.csv'));
  }

  /* ---------- Configuración de domicilio (D3) ---------- */
  function renderSettings() {
    const s = settingsCache || {};
    $('#setDeliveryCost').value = s.deliveryCost ?? 10000;
    $('#setFreeFrom').value = s.freeDeliveryFrom ?? 100000;
    $('#setExplanation').textContent = s.freeDeliveryFrom > 0
      ? `Las compras iguales o superiores a ${fmtMoney(s.freeDeliveryFrom)} tienen domicilio gratis.`
      : 'No hay promoción automática de domicilio gratis por monto.';
  }

  function bindSettings() {
    $('#btnSaveSettings').addEventListener('click', async () => {
      const deliveryCost = parseInt($('#setDeliveryCost').value, 10);
      const freeDeliveryFrom = parseInt($('#setFreeFrom').value, 10);
      if (isNaN(deliveryCost) || deliveryCost < 0 || isNaN(freeDeliveryFrom) || freeDeliveryFrom < 0) {
        toast('El costo y el umbral deben ser números enteros >= 0', 'error');
        return;
      }
      try {
        const data = await api('/admin/settings', { method: 'PUT', body: { deliveryCost, freeDeliveryFrom } });
        settingsCache = data;
        renderSettings();
        toast('Configuración de domicilio guardada', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  /* ---------- Estado de stock (F4) ---------- */
  function productStockState(p) {
    if (p.stock <= 0) return 'out';
    const min = p.minStock === undefined ? 10 : p.minStock;
    return p.stock <= min ? 'low' : 'ok';
  }

  function renderAlerts() {
    const out = productsCache.filter(p => p.stock <= 0);
    const low = productsCache.filter(p => p.stock > 0 && p.stock <= (p.minStock === undefined ? 10 : p.minStock));
    const ok = productsCache.length - out.length - low.length;
    $('#alertsCount').textContent = out.length + low.length;

    const item = (icon, title, color, p, showMin) => `
      <div class="panel" style="margin-bottom:10px;padding:12px 14px;border-left:4px solid ${color}">
        <div style="font-weight:800;color:${color}">${icon} ${title}</div>
        <div style="font-size:.9rem;margin-top:4px"><strong>${esc(p.name)}</strong></div>
        <div class="muted" style="font-size:.85rem">Stock actual: ${p.stock}${showMin ? ' · Stock mínimo: ' + (p.minStock === undefined ? 10 : p.minStock) : ''}</div>
      </div>`;

    $('#alertsList').innerHTML = (out.length || low.length)
      ? [
          ...out.map(p => item('🔴', 'Producto agotado', 'var(--red-500)', p, false)),
          ...low.map(p => item('⚠️', 'Stock bajo', 'var(--gold-600)', p, true))
        ].join('') +
        `<p class="muted" style="font-size:.82rem;margin-top:6px">${ok} producto(s) en estado normal.</p>`
      : `<p class="muted">✅ Todos los productos están en estado normal (${ok}).</p>`;
  }

  /* ---------- Filtros rápidos (F5) ---------- */
  let adminFilter = 'todos';

  function applyAdminFilter(list) {
    if (adminFilter === 'todos') return list;
    return list.filter(p => {
      if (adminFilter === 'featured') return !!p.featured;
      if (adminFilter === 'low') return p.stock > 0 && p.stock <= (p.minStock === undefined ? 10 : p.minStock);
      if (adminFilter === 'out') return p.stock <= 0;
      return true;
    });
  }

  function bindAdminFilters() {
    $('#adminFilters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-afilter]');
      if (!b) return;
      adminFilter = b.dataset.afilter;
      $$('#adminFilters .tab').forEach(t => t.classList.toggle('active', t.dataset.afilter === adminFilter));
      renderProductsTable();
    });
  }

  /* ---------- Tabs ---------- */
  function bindTabs() {
    document.querySelectorAll('[data-atab]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = a.dataset.atab;
        $$('[data-atab]').forEach(x => x.classList.toggle('active', x.dataset.atab === tab));
        $$('[data-aview]').forEach(v => v.classList.toggle('hidden', v.dataset.aview !== tab));
        /* Dashboard siempre muestra la página 1 (KPIs globales). */
        if (tab === 'dashboard' && ordersPage !== 1) {
          ordersPage = 1;
          loadOrders();
        } else {
          renderAll();
        }
      });
    });
  }

  /* ---------- KPIs ---------- */
  function renderKPIs() {
    const orders = ordersCache;
    const bs = ordersMeta.byStatus || {};
    const pendingCount = bs.pendiente || 0;
    const incidentCount = bs.incidente || 0;
    const pending = orders.filter(o => o.status === 'pendiente');
    const incidents = orders.filter(o => o.status === 'incidente');
    const totalVal = ordersMeta.totalVal;
    const stock = productsCache.reduce((s, p) => s + p.stock, 0);

    $('#kpiOrders').textContent = ordersMeta.total;
    $('#kpiOrdersVal').textContent = fmtMoney(totalVal) + ' en ventas';
    $('#kpiPending').textContent = pendingCount;
    $('#kpiPendingVal').textContent = pending.length ? 'Próxima entrega: ' + pending[0].deliveryLabel : 'Todo entregado';
    $('#kpiStock').textContent = stock.toLocaleString('es-CO');
    $('#kpiStockProd').textContent = productsCache.length + ' referencias';
    $('#kpiIncidents').textContent = incidentCount;
    const incidentUsers = new Set(incidents.map(i => i.userName));
    $('#kpiIncidentsUsers').textContent = incidentUsers.size + ' usuarios no cumplieron';

    /* Barras de atribución (dashboard) */
    const attr = attributionCache ? attributionCache.channels : [];
    const max = Math.max(1, ...attr.map(a => a.count));
    $('#attributionBars').innerHTML = attr.length ? attr.map(a => `
      <div class="mb-3">
        <div class="row" style="justify-content:space-between;font-size:.85rem">
          <strong>${esc(a.channel)}</strong><span>${a.count} usuario${a.count === 1 ? '' : 's'}</span>
        </div>
        <div style="height:12px;background:var(--gray-100);border-radius:8px;overflow:hidden">
          <div style="width:${(a.count / max * 100).toFixed(0)}%;height:100%;background:linear-gradient(90deg,var(--gold-400),var(--gold-600));border-radius:8px"></div>
        </div>
      </div>`).join('') : '<p class="muted">Sin registros de usuarios aún.</p>';

    /* Últimos pedidos (la API ya los entrega ordenados desc) */
    $('#recentOrders').innerHTML = orders.length ? orders.slice(0, 4).map(o => `
      <div class="row" style="justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px dashed var(--gray-100)">
        <div>
          <strong style="font-size:.88rem">${esc(o.id)}</strong>
          <div class="muted" style="font-size:.78rem">${esc(o.userName)} · ${fmtMoney(o.total)}</div>
        </div>
<span class="badge ${statusInfo(o.status).cls}">${statusInfo(o.status).label}</span>
      </div>`).join('') : '<p class="muted">Sin pedidos aún.</p>';
  }

  /* ---------- Productos CMS ---------- */
  function bindProducts() {
    $('#btnNewProduct').addEventListener('click', () => {
      $('#apmId').value = '';
      ['#apmName', '#apmCategory', '#apmUnit', '#apmDesc', '#apmTags'].forEach(s => $(s).value = '');
      ['#apmPrice', '#apmGrams', '#apmStock', '#apmRation'].forEach(s => $(s).value = '');
      $('#apmSpecies').value = 'Perros';
      $('#apmFeatured').checked = false;
      $('#apmMinStock').value = 10;
      $('#apmImage').value = '';
      $('#apmVideo').value = '';
      $('#apmImagePreview').innerHTML = '';
      $('#apmTitle').textContent = 'Nuevo producto';
      openModal();
    });

    $('#btnDownloadTemplate').addEventListener('click', downloadExcelTemplate);

    $('#xlsxInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      importXlsx(file);
      e.target.value = '';
    });

    $('#btnSaveProduct').addEventListener('click', saveProduct);

    $('#apmImage').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      $('#apmImagePreview').innerHTML = `<img src="${URL.createObjectURL(file)}" style="width:120px;height:90px;object-fit:cover;border-radius:8px" />`;
    });

    $('#adminProducts').addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (edit) editProduct(edit.dataset.edit);
      if (del) openDeleteProductConfirm(del.dataset.del);
    });
  }

  function renderProductsTable() {
    const list = applyAdminFilter(productsCache);
    $('#adminProducts').innerHTML = list.map(p => {
      const state = productStockState(p);
      const badgeCls = state === 'out' ? 'badge-red' : state === 'low' ? 'badge-gold' : 'badge-green';
      const stateLabel = state === 'out' ? 'Agotado' : state === 'low' ? 'Stock bajo' : 'Normal';
      return `
      <tr>
        <td><img src="${esc(p.images[0] || IMG_PLACEHOLDER)}" style="width:52px;height:44px;object-fit:cover;border-radius:6px" /></td>
        <td><strong>${p.featured ? '⭐ ' : ''}${esc(p.name)}</strong><br/><span class="muted" style="font-size:.78rem">${esc(p.category)} · ${esc(p.unit)}</span></td>
        <td>${esc(p.species)}</td>
        <td class="money">${fmtMoney(p.price)}</td>
        <td><span class="badge ${badgeCls}">${p.stock}</span> <span class="muted" style="font-size:.72rem">${stateLabel}</span></td>
        <td>${p.video ? '📹 + 🖼' : '🖼'}</td>
        <td>
          <button class="btn btn-navy btn-sm" data-edit="${p.id}">Editar</button>
          <button class="btn btn-outline btn-sm" style="color:var(--red-500);border-color:var(--red-500)" data-del="${p.id}">Eliminar</button>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="7" class="ta-center muted">${productsCache.length ? 'Sin productos para este filtro.' : 'Sin productos. Carga el catálogo o crea uno.'}</td></tr>`;
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
    $('#apmFeatured').checked = !!p.featured;
    $('#apmMinStock').value = p.minStock === undefined ? 10 : p.minStock;
    $('#apmDesc').value = p.desc;
    $('#apmTags').value = p.tags.join(';');
    $('#apmImagePreview').innerHTML = `<img src="${p.images[0] || IMG_PLACEHOLDER}" style="width:120px;height:90px;object-fit:cover;border-radius:8px" />`;
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
        tags: $('#apmTags').value.split(';').map(t => t.trim().toLowerCase()).filter(Boolean),
        featured: $('#apmFeatured').checked,
        minStock: Math.max(0, parseInt($('#apmMinStock').value) || 10)
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
              images: images.length ? images : [],
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

    /* Fase 9.5B: los archivos se suben como multipart y el servidor devuelve
       la ruta /uploads/... Nunca se envía Base64 en el JSON. */
    (async () => {
      try {
        const images = imageFile ? [ (await uploadFile('/upload/image', imageFile)).url ] : [];
        const video = videoFile ? (await uploadFile('/upload/video', videoFile)).url : '';
        await commit(images, video);
      } catch (e) {
        toast(e.message, 'error');
      }
    })();
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

  /* ---------- Importación Excel (Fase 2): plantilla + vista previa + commit ---------- */
  let importId = null;
  let importRows = [];

  async function downloadExcelTemplate() {
    try {
      const res = await fetch('/api/admin/import/template', {
        headers: { Authorization: 'Bearer ' + getToken() }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo descargar la plantilla');
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'citypets_plantilla_inventario.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Plantilla Excel descargada');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function importXlsx(file) {
    if (!/\.xlsx$/i.test(file.name)) {
      toast('El archivo debe tener extensión .xlsx', 'error');
      return;
    }
    try {
      const data = await uploadFile('/admin/import/preview', file);
      importId = data.importId;
      importRows = Array.isArray(data.rows) ? data.rows : [];
      renderImportPreview(data);
      $('#importModal').classList.add('open');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderImportPreview(data) {
    const s = data.summary || { total: 0, valid: 0, invalid: 0 };
    $('#importSummary').innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <strong>${esc(data.fileName || 'inventario.xlsx')}</strong>
          <span class="muted" style="margin-left:8px">· ${s.total} fila${s.total === 1 ? '' : 's'}</span>
        </div>
        <div class="row">
          <span class="badge badge-green">✔ ${s.valid} válida${s.valid === 1 ? '' : 's'}</span>
          <span class="badge ${s.invalid ? 'badge-red' : 'badge-gold'}">${s.invalid ? '✘ ' : ''}${s.invalid} inválida${s.invalid === 1 ? '' : 's'}</span>
        </div>
      </div>
      ${s.invalid ? '<p class="muted" style="font-size:.8rem;margin-top:8px">Las filas inválidas no se importarán y se omitirán.</p>' : ''}`;

    $('#importPreviewRows').innerHTML = importRows.map(r => {
      const d = r.data || {};
      const errs = Array.isArray(r.errors) && r.errors.length
        ? r.errors.map(err => `<div style="color:var(--red-500)">• ${esc(err)}</div>`).join('')
        : '';
      return `
        <tr class="${r.valid ? '' : 'row-invalid'}">
          <td class="ta-center">${r.row}</td>
          <td>${r.valid ? '<span class="badge badge-green">✔ Válida</span>' : '<span class="badge badge-red">✘ Inválida</span>'}</td>
          <td><strong>${esc(d.name || '—')}</strong></td>
          <td>${esc(d.species || '—')}</td>
          <td>${esc(d.category || '—')}</td>
          <td class="money">${fmtMoney(d.price)}</td>
          <td>${esc(d.unit || '—')}</td>
          <td class="ta-center">${d.stock}</td>
          <td style="font-size:.8rem">${errs || '<span class="muted">OK</span>'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="9" class="ta-center muted">Sin filas para mostrar.</td></tr>';

    const btn = $('#btnImportCommit');
    btn.disabled = s.valid === 0;
    btn.textContent = s.valid ? `Importar ${s.valid} producto${s.valid === 1 ? '' : 's'}` : 'Sin filas válidas';
  }

  function closeImportModal() {
    importId = null;
    importRows = [];
    $('#importModal').classList.remove('open');
  }

  function bindImport() {
    document.querySelectorAll('[data-close-import]').forEach(b =>
      b.addEventListener('click', closeImportModal));
    $('#btnImportCommit').addEventListener('click', async () => {
      if (!importId) return;
      try {
        const data = await api('/admin/import/commit', { method: 'POST', body: { importId } });
        closeImportModal();
        const skip = Array.isArray(data.skipped) ? data.skipped.length : 0;
        toast(`✅ ${data.created} producto(s) importado(s)${skip ? ` · ${skip} omitido(s) por errores` : ''}`, 'success');
        await refreshAll();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  /* ---------- Confirmación de borrado (admin) ---------- */
  let pendingDeleteId = null;

  function openDeleteProductConfirm(id) {
    const p = productsCache.find(x => x.id === id);
    if (!p) return;
    pendingDeleteId = id;
    $('#cfmTitle').textContent = 'Eliminar producto';
    $('#cfmBody').innerHTML = `
      <p>Se eliminará el producto <strong>${esc(p.name)}</strong>.</p>
      <p class="mt-2" style="color:var(--red-500);font-weight:700">⚠️ Esta acción no se puede deshacer.</p>`;
    openConfirmModal();
  }

  function openConfirmModal() {
    $('#confirmModal').classList.add('open');
  }

  function closeConfirmModal() {
    pendingDeleteId = null;
    $('#confirmModal').classList.remove('open');
  }

  function bindConfirm() {
    document.querySelectorAll('[data-close-confirm]').forEach(b =>
      b.addEventListener('click', closeConfirmModal));
    $('#cfmDelete').addEventListener('click', () => {
      const id = pendingDeleteId;
      closeConfirmModal();
      if (id) deleteProduct(id);
    });
  }

  /* ---------- Detalle de pedido (admin) ---------- */
  async function setOrderStatus(id, status) {
    try {
      await api('/admin/orders/' + id + '/status', { method: 'PATCH', body: { status } });
      toast('Pedido actualizado a ' + statusInfo(status).label, 'success');
      await refreshAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function openOrderDetail(id) {
    const o = ordersCache.find(x => x.id === id);
    if (!o) return;
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsHtml = items.length
      ? items.map(i => `
        <tr>
          <td><img src="${esc(i.image || IMG_PLACEHOLDER)}" alt="${esc(i.name)}" style="width:40px;height:34px;object-fit:cover;border-radius:6px" /></td>
          <td><strong>${esc(i.name)}</strong><br/><span class="muted" style="font-size:.72rem">${i.productId ? 'ID: ' + esc(i.productId) : 'Producto histórico (eliminado del catálogo)'}</span></td>
          <td class="ta-center">${i.qty}</td>
          <td class="money">${fmtMoney(i.price)}</td>
          <td class="money">${fmtMoney(i.price * i.qty)}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" class="ta-center muted">Este pedido no tiene productos registrados.</td></tr>`;

    const pay = o.payment && typeof o.payment === 'object' ? o.payment : {};
    const isCash = pay.method === 'efectivo';
    const denom = parseInt(pay.denomination, 10) || 0;

    $('#odCustomer').textContent = o.userName;
    $('#odPhone').textContent = o.phone || '—';
    $('#odAddress').textContent = o.address || '—';
    $('#odStatus').textContent = statusInfo(o.status).label;
    $('#odStatus').className = 'badge ' + statusInfo(o.status).cls;
    $('#odId').textContent = o.id;
    $('#odCreated').textContent = new Date(o.createdAt).toLocaleString('es-CO');
    $('#odItems').innerHTML = itemsHtml;
    $('#odDeliveryLabel').textContent = o.deliveryLabel || '—';
    $('#odDeliverySlot').textContent = o.deliverySlot === 'manana'
      ? '🌅 Mañana (06:00 – 13:00)'
      : o.deliverySlot === 'tarde' ? '🌇 Tarde (13:00 – 22:00)' : (o.deliverySlot || '—');
    $('#odDeliveryDate').textContent = o.deliveryDate ? formatDate(o.deliveryDate) : '—';
    $('#odDeliveredAt').textContent = o.deliveredAt ? new Date(o.deliveredAt).toLocaleString('es-CO') : '—';
    $('#odPayment').textContent = isCash ? '💵 Efectivo' : '📲 Digital';
    $('#odPaymentExtra').textContent = isCash
      ? (denom > 0 ? `Billete con el que paga: ${fmtMoney(denom)}` : 'Pago en efectivo sin denominación')
      : 'Transferencia (Nequi/Daviplata/Bancolombia) o datáfono';
    $('#odSubtotal').textContent = fmtMoney(o.subtotal);
    $('#odDeliveryCost').textContent = (o.delivery === 0 && o.subtotal > 0) ? 'GRATIS' : fmtMoney(o.delivery);
    $('#odTotal').textContent = fmtMoney(o.total);

    const actions = nextStatuses(o.status).map(s => `
      <button class="btn btn-navy btn-sm" data-ostatus="${s}" data-id="${o.id}">${actionLabel(s)}</button>`).join('');
    $('#odActions').innerHTML = actions
      ? `<div class="row">${actions}</div>`
      : '<p class="muted" style="font-size:.82rem;margin-top:4px">Este pedido no tiene transiciones disponibles.</p>';

    $('#orderModal').classList.add('open');
  }

  /* ---------- Pedidos ---------- */
  function bindOrders() {
    $('#adminOrders').addEventListener('click', async (e) => {
      const st = e.target.closest('[data-ostatus]');
      const det = e.target.closest('[data-odetail]');
      if (det) { openOrderDetail(det.dataset.odetail); return; }
      if (!st) return;
      await setOrderStatus(st.dataset.id, st.dataset.ostatus);
    });
    $('#orderModal').addEventListener('click', async (e) => {
      const st = e.target.closest('[data-ostatus]');
      if (!st) return;
      await setOrderStatus(st.dataset.id, st.dataset.ostatus);
      openOrderDetail(st.dataset.id);
    });
  }

  function renderOrdersTable() {
    const orders = ordersCache;
    $('#adminOrders').innerHTML = orders.map(o => {
      const info = statusInfo(o.status);
      const actions = nextStatuses(o.status).map(s => `
        <button class="btn btn-navy btn-sm" data-ostatus="${s}" data-id="${o.id}">${actionLabel(s)}</button>`).join('');
      return `
      <tr>
        <td><strong>${esc(o.id)}</strong><br/><span class="muted" style="font-size:.75rem">${new Date(o.createdAt).toLocaleString('es-CO')}</span></td>
        <td>${esc(o.userName)}<br/><span class="muted" style="font-size:.75rem">📱 ${esc(o.phone)}</span></td>
        <td class="money">${fmtMoney(o.total)}</td>
        <td>${esc(o.deliveryLabel)}<br/><span class="muted" style="font-size:.75rem">Franja ${o.deliverySlot === 'manana' ? '🌅' : '🌇'}</span></td>
        <td>${o.payment.method === 'efectivo' ? '💵 Efectivo' : '📲 Digital'}</td>
        <td><span class="badge ${info.cls}">${info.label}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" data-odetail="${o.id}">Ver detalle</button>
          ${actions}
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="ta-center muted">Sin pedidos.</td></tr>';
  }

  /* ---------- Incidencias ---------- */
  function bindIncidents() {
    /* incidente es histórico: la pestaña solo lo lista, sin acciones. */
  }

  function renderIncidents() {
    const incidents = ordersCache.filter(o => o.status === 'incidente');
    $('#adminIncidents').innerHTML = incidents.map(o => `
      <tr>
        <td><strong>${esc(o.id)}</strong></td>
        <td>${esc(o.userName)}</td>
        <td>${esc(o.phone)}</td>
        <td>${new Date(o.createdAt).toLocaleString('es-CO')}</td>
        <td>No se cumplió con la entrega programada (${esc(o.deliveryLabel)}).</td>
        <td class="muted" style="font-size:.8rem">Histórico · sin transición</td>
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
            <td>${esc(a.channel)}</td>
            <td>${a.count}</td>
            <td>${total ? (a.count / total * 100).toFixed(1) : 0}%</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">Sin usuarios registrados.</p>';

    const det = attributionCache ? attributionCache.detail.slice(0, 12) : [];
    $('#attributionDetail').innerHTML = det.length ? det.map(a => `
      <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--gray-100);font-size:.88rem">
        <span>${esc(a.userName)}</span>
        <span class="badge badge-gold">${esc(a.channel)}</span>
      </div>`).join('') : '<p class="muted">Sin registros de atribución.</p>';
  }

  /* ---------- Modal ---------- */
  function openModal() { $('#productModal').classList.add('open'); }
  function closeModal() { $('#productModal').classList.remove('open'); }
  document.querySelectorAll('[data-close-amy]').forEach(b => b.addEventListener('click', closeModal));
  document.querySelectorAll('[data-close-order]').forEach(b => b.addEventListener('click', () => $('#orderModal').classList.remove('open')));
})();
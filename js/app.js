/* =========================================================
   CITY PETS — Lógica del storefront
   ========================================================= */
(() => {
  'use strict';
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  let compState = null;

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    populateChannels();
    bindNavigation();
    bindHero();
    bindStore();
    bindFeatured();
    bindCart();
    bindCheckout();
    bindProfile();
    bindPets();
    bindConfirm();
    bindTools();
    renderFeedbackList();
    window.addEventListener('store-settings-changed', () => { renderDeliveryPromo(); renderCommercialInfo(); });
    await Promise.all([initSession(), loadProducts(), loadStoreSettings()]);
    refreshSessionUI();
    refreshProfileView();
    normalizeCart();
    renderCart();
    renderProducts();
    renderFeatured();
    renderDeliveryPromo();
    renderCommercialInfo();
    fillCalcSelects();
    await fillRecommendations();
  }

  /* ---------- Sesión y catálogo desde el backend ---------- */
  async function initSession() {
    if (!getToken()) { App.setCurrentUser(null); return; }
    try {
      const data = await api('/auth/me');
      App.setCurrentUser(data.user);
    } catch {
      setToken(null);
      App.setCurrentUser(null);
    }
  }

  async function loadProducts() {
    try {
      const products = await api('/products', { auth: false });
      App.products = products;
    } catch {
      toast('No se pudo cargar el catálogo', 'error');
    }
  }

  /* ---------- Toasts ---------- */
  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    $('#toastWrap').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /* ---------- Navegación entre vistas ---------- */
  function bindNavigation() {
    const go = (view) => {
      $$('.view').forEach(v => v.classList.add('hidden'));
      $('#view-' + view).classList.remove('hidden');
      $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (view === 'perfil') refreshProfileView();
      if (view === 'historial') renderOrders();
    };
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-nav]');
      if (t && !t.hasAttribute('data-species')) { e.preventDefault(); go(t.dataset.nav); }
    });
    window.AppNav = go;
  }

  /* ---------- Hero split screen ---------- */
  let maximizedPanel = null;

  /* Alterna el control "Maximizar" de cada panel a "Restaurar vista"
     (y el botón ⤢) según el estado maximizado. */
  function syncPanelButtons(maximized) {
    $$('.split-panel').forEach(p => {
      const isActive = maximized && p.dataset.panel === maximizedPanel;
      const isDogs = p.dataset.panel === 'dogs';
      const textBtn = p.querySelector('.panel-actions .btn-gold[data-action]');
      const iconBtn = p.querySelector('.expand-btn');
      if (textBtn) {
        textBtn.dataset.action = isActive ? 'restore' : 'expand';
        textBtn.textContent = isActive ? 'Restaurar vista' : 'Maximizar';
      }
      if (iconBtn) {
        const label = (isActive ? 'Restaurar ' : 'Maximizar ') + (isDogs ? 'perros' : 'gatos');
        iconBtn.dataset.action = isActive ? 'restore' : 'expand';
        iconBtn.setAttribute('aria-label', label);
        iconBtn.title = label;
      }
    });
  }

  function bindHero() {
    const hero = $('#heroSplit');
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const panel = btn.dataset.panel;
      if (action === 'expand') {
        maximizedPanel = panel;
        hero.classList.add('maximized');
        hero.classList.remove('to-cats');
        if (panel === 'cats') hero.classList.add('to-cats');
        $$('.split-panel').forEach(p => p.classList.toggle('scrollable', p.dataset.panel === panel));
        syncPanelButtons(true);
        toast('Sección maximizada: ' + (panel === 'dogs' ? 'Perros' : 'Gatos'));
      } else if (action === 'restore') {
        maximizedPanel = null;
        hero.classList.remove('maximized', 'to-cats');
        $$('.split-panel').forEach(p => p.classList.remove('scrollable'));
        syncPanelButtons(false);
        hero.scrollIntoView({ behavior: 'smooth' });
      } else if (action === 'go-store') {
        setStoreFilter(btn.dataset.species);
        AppNav('tienda');
      }
    });
  }

  /* ---------- Tienda / Catálogo ---------- */
  let currentFilter = 'todos';
  function bindStore() {
    $('#storeTabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (!t) return;
      setStoreFilter(t.dataset.filter);
    });
    $('#productGrid').addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) return;
      const card = e.target.closest('[data-product]');
      if (card) openProductModal(card.dataset.product);
    });
    document.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) addToCart(add.dataset.add);
    });
  }

  function setStoreFilter(filter) {
    currentFilter = filter;
    $$('#storeTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.filter === filter));
    renderProducts();
  }

  function renderProducts() {
    const grid = $('#productGrid');
    let list = App.products;
    if (currentFilter !== 'todos') list = list.filter(p => p.species === currentFilter);
    $('#noProducts').classList.toggle('hidden', list.length > 0);
    $('#storeTitle').textContent = currentFilter === 'todos' ? 'Todos los productos' : 'Productos para ' + currentFilter;
    grid.innerHTML = list.map(p => {
      const outOfStock = p.stock <= 0;
      const lowStock = !outOfStock && p.stock <= 15;
      const perKg = p.grams > 0 ? fmtMoney(Math.round(p.price / p.grams * 1000)) : null;
      return `
      <article class="card" data-product="${p.id}">
        <div class="card-media">
          <img src="${esc(p.images[0] || IMG_PLACEHOLDER)}" alt="${esc(p.name)}" loading="lazy" />
          ${p.featured ? '<span class="tag-badge">⭐ Destacado</span>' : ''}
          <span class="stock-badge">${p.stock} en bodega</span>
        </div>
        <div class="card-body">
          <span class="cat">${esc(p.species)} · ${esc(p.category)}</span>
          <h3>${esc(p.name)}${productPresentation(p) ? ` <span class="muted" style="font-size:.82rem;font-weight:600">· ${productPresentation(p)}</span>` : ''}</h3>
          <p class="desc">${esc(p.desc)}</p>
          <div class="price-row">
            <span class="price money">${fmtMoney(p.price)}</span>
            <span class="unit">${esc(p.unit)}</span>
          </div>
          ${perKg ? `<div class="muted" style="font-size:.78rem">${perKg}/kg · ${esc(p.dailyRation)} g/día</div>` : ''}
          ${lowStock ? `<span class="badge badge-red">Solo quedan ${p.stock}</span>` : ''}
        </div>
        <div class="card-footer">
          <button class="btn btn-navy grow" data-add="${p.id}" ${outOfStock ? 'disabled' : ''}>${outOfStock ? 'Agotado' : 'Añadir al carrito'}</button>
          <button class="btn btn-outline" data-view="${p.id}">Ver</button>
        </div>
      </article>`;
    }).join('');
  }

  function openProductModal(id) {
    const p = App.products.find(x => x.id === id);
    if (!p) return;
    $('#pmTitle').textContent = p.name;
    $('#pmBody').innerHTML = `
      <img src="${esc(p.images[0] || IMG_PLACEHOLDER)}" alt="${esc(p.name)}" class="modal-media" />
      <p class="mt-3 muted">${esc(p.species)} · ${esc(p.category)}</p>
      <h3 class="mt-2">${esc(p.name)}</h3>
      <p>${esc(p.desc)}</p>
      <div class="price-row mt-3">
        <span class="price money">${fmtMoney(p.price)}</span><span class="unit">${esc(p.unit)}</span>
      </div>
      <p class="mt-2"><span class="stars-readonly">${renderStars(p.rating)}</span> ${p.rating} · ${p.stock} unidades en bodega</p>
      ${p.grams ? `<p class="mt-2 muted">📦 ${p.grams} g · Ración diaria sugerida: ${p.dailyRation} g/día</p>` : ''}
      ${p.video ? `<video src="${esc(p.video)}" controls style="width:100%;margin-top:12px;border-radius:10px"></video>` : ''}
      <button class="btn btn-gold btn-block mt-4" data-add="${p.id}">Añadir al carrito — ${fmtMoney(p.price)}</button>`;
    openModal('#productModal');
  }

  /* ---------- Productos destacados (dentro del hero) ----------
     Reutiliza la lógica "destacado" existente (tag 'top'). Se muestran
     ÚNICAMENTE los productos con tag 'top' de cada especie, integrados
     en su columna del hero (Perros a la izquierda, Gatos a la derecha).
     Todo viene del catálogo real (API), nunca hardcodeado. */
  function pickFeatured(species) {
    return App.products.filter(p => p.species === species && p.featured);
  }

  function featuredCard(p) {
    const outOfStock = p.stock <= 0;
    return `
      <article class="pf-card" data-product="${p.id}">
        <div class="pf-media">
          <img src="${esc(p.images[0] || IMG_PLACEHOLDER)}" alt="${esc(p.name)}" loading="lazy" />
          <span class="pf-tag">⭐ Destacado</span>
          ${outOfStock ? '<span class="pf-agotado">Agotado</span>' : ''}
        </div>
        <div class="pf-body">
          <span class="pf-name">${esc(p.name)}</span>
          <div class="pf-price-row">
            <span class="pf-price money">${fmtMoney(p.price)}</span>
            <span class="pf-unit">${esc(p.unit)}</span>
          </div>
        </div>
        <div class="pf-foot">
          <button class="btn btn-gold" data-add="${p.id}" ${outOfStock ? 'disabled' : ''}>${outOfStock ? 'Agotado' : 'Añadir'}</button>
          <button class="btn btn-outline" data-view="${p.id}">Ver</button>
        </div>
      </article>`;
  }

  function featuredPanel(species, items) {
    const isDogs = species === 'Perros';
    const label = isDogs ? '🐕 Destacados para perros' : '🐈 Destacados para gatos';
    const content = items.length
      ? `<div class="pf-strip">${items.map(featuredCard).join('')}</div>`
      : `<div class="pf-empty"><p>Próximamente tendremos productos destacados para ${isDogs ? 'perros' : 'gatos'} 🐾</p></div>`;
    return `<div class="pf-label">${label}</div>${content}`;
  }

  function renderFeatured() {
    $('#panelFeaturedDogs').innerHTML = featuredPanel('Perros', pickFeatured('Perros'));
    $('#panelFeaturedCats').innerHTML = featuredPanel('Gatos', pickFeatured('Gatos'));
  }

  function bindFeatured() {
    const root = $('#heroSplit');
    if (!root) return;
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) return;
      const card = e.target.closest('[data-product]');
      if (card) openProductModal(card.dataset.product);
    });
  }

  /* ---------- Carrito ---------- */
  function normalizeCart() {
    const raw = App.cart;
    if (!Array.isArray(raw) || !raw.length) { App.cart = []; return []; }
    const clean = [];
    for (const c of raw) {
      if (!c || typeof c.id !== 'string') continue;
      const p = App.products.find(x => x.id === c.id);
      if (!p) continue;
      if (p.stock <= 0) continue;
      const qty = Math.min(Math.max(1, parseInt(c.qty, 10) || 1), p.stock);
      clean.push({ id: p.id, qty });
    }
    const changed = clean.length !== raw.length || clean.some((c, i) => c.qty !== raw[i].qty);
    if (changed) App.cart = clean;
    return clean;
  }

  function addToCart(id) {
    const p = App.products.find(x => x.id === id);
    if (!p) return;
    if (p.stock <= 0) { toast('Producto agotado', 'error'); return; }
    const cart = App.cart;
    const found = cart.find(c => c.id === id);
    if (found) {
      if (found.qty >= p.stock) { toast('Stock máximo disponible alcanzado', 'error'); return; }
      found.qty++;
    } else {
      cart.push({ id, qty: 1 });
    }
    App.cart = cart;
    renderCart();
    toast(`${p.name} añadido al carrito`, 'success');
  }

  function cartTotals() {
    const items = App.cart.map(c => {
      const p = App.products.find(x => x.id === c.id);
      return { p, qty: c.qty };
    }).filter(i => i.p);
    const subtotal = items.reduce((s, i) => s + i.p.price * i.qty, 0);
    const delivery = computeDelivery(subtotal);
    return { items, subtotal, delivery, total: subtotal + delivery };
  }

  /* Muestra "GRATIS" cuando el envío está exento y hay artículos. */
  function deliveryDisplay(delivery, subtotal) {
    return delivery === 0 && subtotal > 0 ? 'GRATIS' : fmtMoney(delivery);
  }

  function freeDeliveryMsg(subtotal) {
    const hint = freeDeliveryHint(subtotal);
    if (!hint) return '';
    return hint.ok
      ? '🎉 ¡Tu domicilio es gratis!'
      : `Agrega ${fmtMoney(hint.need)} más para obtener domicilio gratis 🚚`;
  }

  /* Banner promocional del Inicio: refleja la configuración actual de
     domicilio (StoreSettings). Se re-renderiza al cargar settings y ante
     el evento store-settings-changed. */
  function renderDeliveryPromo() {
    const big = $('#flyerDelivery');
    const sub = $('#flyerDeliverySub');
    if (!big || !sub) return;
    const { deliveryCost: dc, freeDeliveryFrom: ff } = getStoreSettings();
    const sameDay = 'Entrega el mismo día en la franja siguiente';
    if (dc === 0 && ff === 0) {
      big.textContent = '🎉 ¡Domicilio gratis en todas las compras!';
      sub.textContent = sameDay;
      return;
    }
    if (dc === 0) {
      big.textContent = '🚚 ¡Domicilio gratis!';
      sub.textContent = sameDay;
      return;
    }
    big.textContent = `🚚 Domicilio: ${fmtMoney(dc)}`;
    sub.textContent = ff > 0 ? `🎁 Gratis en compras desde ${fmtMoney(ff)}` : sameDay;
  }

  /* Información comercial (WhatsApp, días y horario de atención) desde
     StoreSettings. Actualiza la barra informativa, el pie y el enlace de
     WhatsApp. Se re-renderiza al cargar settings y ante store-settings-changed. */
  function renderCommercialInfo() {
    const s = getStoreSettings();
    const schedule = $('#storeSchedule');
    const footSchedule = $('#footerSchedule');
    const footPhone = $('#footerPhone');
    const footWa = $('#footerWhatsApp');
    if (schedule) {
      schedule.textContent = `🕒 Horarios de atención: ${s.daysOfWeek} ${s.openingTime} – ${s.closingTime}`;
    }
    if (footSchedule) {
      footSchedule.textContent = `🕒 ${s.daysOfWeek} ${s.openingTime}-${s.closingTime}`;
    }
    if (footPhone) {
      footPhone.textContent = s.whatsapp || '—';
    }
    if (footWa) {
      const link = waLink();
      footWa.href = link;
      footWa.setAttribute('aria-label', 'Chatea con City Pets por WhatsApp');
    }
  }

  function renderCart() {
    const { items, subtotal, delivery, total } = cartTotals();
    $('#cartCount').textContent = items.reduce((s, i) => s + i.qty, 0);
    $('#cartSubtotal').textContent = fmtMoney(subtotal);
    $('#cartDelivery').textContent = deliveryDisplay(delivery, subtotal);
    $('#cartTotal').textContent = fmtMoney(total);
    $('#cartFreeMsg').innerHTML = items.length ? freeDeliveryMsg(subtotal) : '';
    const body = $('#cartBody');
    if (!items.length) {
      body.innerHTML = `<div class="ta-center muted mt-4">Tu carrito está vacío.<br/>Explora la tienda 🐾</div>`;
      return;
    }
    body.innerHTML = items.map(i => `
      <div class="cart-item">
        <img class="thumb" src="${esc(i.p.images[0] || IMG_PLACEHOLDER)}" alt="${esc(i.p.name)}" />
        <div class="cart-item-info">
          <h4>${esc(i.p.name)}</h4>
          <div class="price-row" style="margin:2px 0">
            <span class="price money" style="font-size:1.02rem">${fmtMoney(i.p.price)}</span>
          </div>
          <div class="qty-ctl">
            <button data-qty="dec" data-id="${i.p.id}">−</button>
            <span>${esc(i.qty)}</span>
            <button data-qty="inc" data-id="${i.p.id}">+</button>
          </div>
        </div>
        <div style="text-align:right">
          <div class="money" style="font-weight:800;color:var(--navy-800)">${fmtMoney(i.p.price * i.qty)}</div>
          <button class="ico-close" data-qty="del" data-id="${i.p.id}" style="font-size:1rem">🗑</button>
        </div>
      </div>`).join('');
  }

  function bindCart() {
    $('#btnCart').addEventListener('click', () => $('#cartDrawer').classList.add('open'));
    document.querySelectorAll('[data-close-cart]').forEach(el =>
      el.addEventListener('click', () => $('#cartDrawer').classList.remove('open')));
    $('#cartBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-qty]');
      if (!btn) return;
      const { qty, id } = btn.dataset;
      const cart = App.cart;
      const item = cart.find(c => c.id === id);
      if (!item) return;
      const p = App.products.find(x => x.id === id);
      if (qty === 'inc' && item.qty < p.stock) item.qty++;
      else if (qty === 'dec') { item.qty--; if (item.qty <= 0) cart.splice(cart.indexOf(item), 1); }
      else if (qty === 'del') cart.splice(cart.indexOf(item), 1);
      App.cart = cart;
      renderCart();
    });
    $('#btnCheckout').addEventListener('click', () => {
      const { items } = cartTotals();
      if (!items.length) { toast('Agrega productos al carrito', 'error'); return; }
      openCheckout();
    });
  }

  /* ---------- Checkout ---------- */
  let selectedPay = 'efectivo';
  let computedDelivery = null;
  let checkoutBusy = false;
  /* Idempotencia (P6.2): clave única por intención de compra. */
  let pendingCheckoutKey = null;
  let pendingCheckoutFingerprint = null;
  /* Modo del checkout: 'user' | 'guest' | 'login' | 'register'. */
  let checkoutMode = 'user';

  function newClientKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'cp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function checkoutFingerprint(items, address, payMethod, denom) {
    const sorted = items.map(i => `${i.p.id}:${i.qty}`).sort().join('|');
    return `${sorted}||${address.trim()}||${payMethod}:${denom}`;
  }

  function openCheckout() {
    const user = App.currentUser();
    const { subtotal, delivery, total } = cartTotals();
    computedDelivery = getNextDeliverySlot();
    const userInfo = $('#checkoutUserInfo');
    userInfo.style.display = user ? '' : 'none';
    if (user) {
      userInfo.innerHTML = `
        <strong>${esc(user.name)}</strong><br/>
        <span class="muted">📱 ${esc(user.phone)} · ✉️ ${esc(user.email)}</span>`;
      $('#checkoutGuestBlock').style.display = 'none';
      $('#checkoutAddress').value = user.address || '';
      checkoutMode = 'user';
    } else {
      $('#checkoutGuestBlock').style.display = '';
      checkoutMode = 'guest';
      switchCheckoutMode('guest');
    }
    $('#coSubtotal').textContent = fmtMoney(subtotal);
    $('#coDelivery').textContent = deliveryDisplay(delivery, subtotal);
    $('#coFreeMsg').innerHTML = freeDeliveryMsg(subtotal);
    $('#coTotal').textContent = fmtMoney(total);

    /* Franja auto-programada según regla logística */
    const current = getCurrentSlot();
    $('#slotOptions').innerHTML = SLOTS.map(s => `
      <div class="slot-card ${s.id === computedDelivery.slot ? 'selected' : ''}" data-slot="${s.id}">
        <div class="slot-name">${s.name}</div>
        <div class="slot-time">${s.hours}</div>
      </div>`).join('');
    $('#slotRule').textContent = `Regla logística: tu pedido se genera en la franja ${current === 'manana' ? '🌅 Mañana' : '🌇 Tarde'} → entrega automática programada para la franja siguiente: ${computedDelivery.name} (${computedDelivery.dateLabel}).`;

    selectedPay = 'efectivo';
    $('#payOptions').innerHTML = [
      { id: 'efectivo', icon: '💵', label: 'Efectivo', sub: 'Paga al recibir con billetes' },
      { id: 'digital', icon: '📲', label: 'Digital', sub: 'Transferencia (Nequi/Daviplata/Bancolombia) o datáfono' }
    ].map(p => `
      <div class="pay-option grow ${p.id === selectedPay ? 'selected' : ''}" data-pay="${p.id}">
        <div style="font-weight:800">${p.icon} ${p.label}</div>
        <div class="muted" style="font-size:.8rem">${p.sub}</div>
      </div>`).join('');
    $('#cashOptions').classList.toggle('hidden', false);
    $('#digitalOptions').classList.add('hidden');
    updateCashChange();
    openModal('#checkoutModal');
  }

  /* Cambia la pestaña activa del checkout (invitado / login / registro). */
  function switchCheckoutMode(mode) {
    checkoutMode = mode;
    $$('#checkoutTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.copt === mode));
    $('#checkoutGuestForm').classList.toggle('hidden', mode !== 'guest');
    $('#checkoutLoginForm').classList.toggle('hidden', mode !== 'login');
    $('#checkoutRegisterForm').classList.toggle('hidden', mode !== 'register');
    $('#checkoutLoginMsg').textContent = '';
    $('#checkoutRegisterMsg').textContent = '';
  }

  /* Tras autenticarse/registrarse desde el checkout: continúa en el modal
     como usuario, sin perder el carrito. */
  function afterCheckoutAuth(user) {
    const info = $('#checkoutUserInfo');
    info.innerHTML = `
      <strong>${esc(user.name)}</strong><br/>
      <span class="muted">📱 ${esc(user.phone)} · ✉️ ${esc(user.email)}</span>`;
    info.style.display = '';
    $('#checkoutGuestBlock').style.display = 'none';
    checkoutMode = 'user';
    if (user.address) $('#checkoutAddress').value = user.address;
    refreshSessionUI();
    toast(`¡Hola ${user.name}! 🐾`);
  }

  async function checkoutLogin() {
    const email = $('#checkoutLogEmail').value.trim();
    const password = $('#checkoutLogPassword').value;
    if (!email || !password) { $('#checkoutLoginMsg').textContent = 'Indica correo y contraseña.'; return; }
    const btn = $('#btnCheckoutLogin');
    btn.disabled = true;
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(data.token);
      App.setCurrentUser(data.user);
      afterCheckoutAuth(data.user);
    } catch (e) {
      $('#checkoutLoginMsg').textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function checkoutRegister() {
    const name = $('#checkoutRegName').value.trim();
    const email = $('#checkoutRegEmail').value.trim();
    const password = $('#checkoutRegPassword').value;
    const phone = $('#checkoutRegPhone').value.trim();
    const address = $('#checkoutAddress').value.trim();
    if (!name || !email || !password || !phone) {
      $('#checkoutRegisterMsg').textContent = 'Completa nombre, correo, contraseña y celular.';
      return;
    }
    const btn = $('#btnCheckoutRegister');
    btn.disabled = true;
    try {
      const channel = detectChannel() || 'Directo';
      const data = await api('/auth/register', { method: 'POST', body: { name, phone, email, password, channel } });
      setToken(data.token);
      App.setCurrentUser(data.user);
      /* Guarda la dirección de entrega en la cuenta (updateMe acepta address). */
      try {
        await api('/auth/me', { method: 'PUT', body: { address } });
        App.setCurrentUser({ ...data.user, address });
      } catch { /* no crítico: la cuenta ya existe */ }
      afterCheckoutAuth({ ...data.user, address });
    } catch (e) {
      $('#checkoutRegisterMsg').textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  function bindCheckout() {
    document.querySelectorAll('[data-close-modal]').forEach(el =>
      el.addEventListener('click', () => closeModals()));
    $('#checkoutModal').addEventListener('click', (e) => {
      const slot = e.target.closest('[data-slot]');
      const pay = e.target.closest('[data-pay]');
      if (slot) {
        if (slot.dataset.slot !== computedDelivery.slot) {
          toast(`Regla logística: tu pedido se genera en franja ${getCurrentSlot() === 'manana' ? 'Mañana' : 'Tarde'}, la entrega se programa automáticamente para ${computedDelivery.name}.`, 'error');
          $$('#slotOptions .slot-card').forEach(o => o.classList.toggle('selected', o.dataset.slot === computedDelivery.slot));
        }
      }
      if (pay) {
        selectedPay = pay.dataset.pay;
        $$('#payOptions .pay-option').forEach(o => o.classList.toggle('selected', o.dataset.pay === selectedPay));
        $('#cashOptions').classList.toggle('hidden', selectedPay !== 'efectivo');
        $('#digitalOptions').classList.toggle('hidden', selectedPay !== 'digital');
        updateCashChange();
      }
    });
    $('#cashDenom').addEventListener('change', updateCashChange);
    $('#btnConfirmOrder').addEventListener('click', confirmOrder);
    $('#checkoutTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-copt]');
      if (b) switchCheckoutMode(b.dataset.copt);
    });
    $('#btnCheckoutLogin').addEventListener('click', checkoutLogin);
    $('#btnCheckoutRegister').addEventListener('click', checkoutRegister);
  }

  function updateCashChange() {
    const { total } = cartTotals();
    const denom = parseInt($('#cashDenom').value || 0, 10);
    const change = denom > 0 ? Math.max(0, denom - total) : 0;
    $('#cashChange').textContent = change > 0 ? fmtMoney(change) : 'No aplica cambio';
  }

  async function confirmOrder() {
    const user = App.currentUser();
    const { items } = cartTotals();
    if (!items.length) return;
    if (checkoutBusy) return;
    const isGuest = checkoutMode === 'guest' && !user;
    const address = $('#checkoutAddress').value.trim();
    if (!address) { toast('Indica la dirección de entrega', 'error'); return; }

    /* Datos del cliente: invitado desde el formulario; autenticado de la sesión. */
    let name, phone;
    if (isGuest) {
      name = $('#guestName').value.trim();
      phone = $('#guestPhone').value.trim();
      if (name.length < 2) { toast('Indica tu nombre completo', 'error'); return; }
      if (phone.length < 7) { toast('Indica un número de celular válido', 'error'); return; }
    } else if (!user) {
      toast('Inicia sesión o regístrate para continuar', 'error');
      return;
    } else {
      name = user.name;
      phone = user.phone;
    }

    const payMethod = selectedPay === 'efectivo' ? 'efectivo' : 'digital';
    const denom = payMethod === 'efectivo' ? (parseInt($('#cashDenom').value || 0, 10) || 0) : 0;

    /* Idempotencia (P6.2): se reutiliza la misma clave mientras la intención
       no cambie (mismo carrito + dirección + pago). Nueva clave al cambiar
       la intención o tras completar el pedido. */
    const fp = checkoutFingerprint(items, address, payMethod, denom);
    if (!pendingCheckoutKey || pendingCheckoutFingerprint !== fp) {
      pendingCheckoutKey = newClientKey();
      pendingCheckoutFingerprint = fp;
    }

    checkoutBusy = true;
    const btn = $('#btnConfirmOrder');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Procesando…';

    const payload = {
      items: items.map(i => ({ productId: i.p.id, qty: i.qty })),
      address,
      payment: payMethod === 'efectivo'
        ? { method: 'efectivo', denomination: denom }
        : { method: 'digital' },
      clientOrderKey: pendingCheckoutKey
    };
    if (isGuest) { payload.name = name; payload.phone = phone; }

    try {
      /* Invitado: no se envía Authorization (auth:false), aunque exista un
         token residual en localStorage. */
      const order = await api('/orders', { method: 'POST', body: payload, auth: !isGuest });
      App.cart = [];
      pendingCheckoutKey = null;
      pendingCheckoutFingerprint = null;
      closeModals();
      $('#cartDrawer').classList.remove('open');
      renderCart();
      loadProducts();
      toast(`¡Pedido ${order.id} confirmado! Entrega ${order.deliverySlot === 'manana' ? '🌅 Mañana' : '🌇 Tarde'} — ${order.deliveryLabel}.`, 'success');
      AppNav('historial');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      checkoutBusy = false;
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  /* ---------- Perfil / Sesión ---------- */
  function populateChannels() {
    const sel = $('#regChannel');
    const detected = detectChannel();
    sel.innerHTML = '<option value="">Selecciona el canal…</option>' +
      CHANNELS.map(c => `<option value="${c}" ${c === detected ? 'selected' : ''}>${c}</option>`).join('');
    if (detected) toast(`Canal detectado: ${detected} 👀`);
  }

  function bindProfile() {
    $('#btnRegister').addEventListener('click', async () => {
      const name = $('#regName').value.trim();
      const phone = $('#regPhone').value.trim();
      const email = $('#regEmail').value.trim();
      const password = $('#regPassword').value;
      const channel = $('#regChannel').value;
      if (!name || !phone || !email || !password) { toast('Completa nombre, móvil, correo y contraseña', 'error'); return; }
      try {
        const data = await api('/auth/register', { method: 'POST', body: { name, phone, email, password, channel: channel || 'Directo' } });
        setToken(data.token);
        App.setCurrentUser(data.user);
        $('#regName').value = $('#regPhone').value = $('#regEmail').value = $('#regPassword').value = '';
        toast('¡Cuenta creada! Bienvenido a City Pets 🐾', 'success');
        refreshSessionUI();
        refreshProfileView();
        AppNav('perfil');
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    $('#btnGoLogin').addEventListener('click', () => {
      $('#registerPanel').classList.add('hidden');
      $('#loginPanel').classList.remove('hidden');
    });

    $('#btnGoRegister').addEventListener('click', () => {
      $('#loginPanel').classList.add('hidden');
      $('#registerPanel').classList.remove('hidden');
    });

    $('#btnLogin').addEventListener('click', async () => {
      const email = $('#logEmail').value.trim();
      const password = $('#logPassword').value;
      if (!email || !password) { toast('Indica correo y contraseña', 'error'); return; }
      try {
        const data = await api('/auth/login', { method: 'POST', body: { email, password } });
        setToken(data.token);
        App.setCurrentUser(data.user);
        $('#logEmail').value = $('#logPassword').value = '';
        toast('¡Sesión iniciada! 🐾', 'success');
        refreshSessionUI();
        refreshProfileView();
        AppNav('perfil');
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    $('#btnSaveProfile').addEventListener('click', async () => {
      const user = App.currentUser();
      if (!user) return;
      try {
        const data = await api('/auth/me', {
          method: 'PUT',
          body: {
            name: $('#profName').value.trim(),
            phone: $('#profPhone').value.trim(),
            email: $('#profEmail').value.trim(),
            address: $('#profAddress') ? $('#profAddress').value.trim() : ''
          }
        });
        App.setCurrentUser(data.user);
        toast('Perfil actualizado', 'success');
        refreshSessionUI();
        refreshProfileView();
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    $('#btnLogout').addEventListener('click', () => {
      setToken(null);
      App.setCurrentUser(null);
      toast('Sesión cerrada');
      refreshSessionUI();
      refreshProfileView();
    });
  }

  function refreshSessionUI() {
    const user = App.currentUser();
    $('#userChip').classList.toggle('hidden', !user);
    if (user) $('#userChip').textContent = '👋 ' + user.name.split(' ')[0];
  }

  function refreshProfileView() {
    const user = App.currentUser();
    if (user) {
      $('#registerPanel').classList.add('hidden');
      $('#loginPanel').classList.add('hidden');
    } else {
      $('#registerPanel').classList.remove('hidden');
      $('#loginPanel').classList.add('hidden');
    }
    $('#profilePanel').classList.toggle('hidden', !user);
    $('#petsPanel').classList.remove('hidden');
    $('#loginPetHint').classList.toggle('hidden', !!user);
    if (user) {
      $('#profileTitle').textContent = 'Hola, ' + user.name + ' 👋';
      $('#profName').value = user.name;
      $('#profPhone').value = user.phone;
      $('#profEmail').value = user.email;
      $('#profAddress').value = user.address || '';
    }
    renderPets();
  }

  /* ---------- Mascotas ---------- */
  let editingPetId = null;
  let petsCache = [];
  function bindPets() {
    $('#btnAddPet').addEventListener('click', () => {
      if (!App.currentUser()) { toast('Regístrate primero', 'error'); AppNav('perfil'); return; }
      editingPetId = null;
      $('#petModalTitle').textContent = 'Añadir mascota';
      $('#petName').value = $('#petBreed').value = $('#petAge').value = $('#petRation').value = $('#petWeight').value = '';
      $('#petSpecies').value = 'Perros';
      openModal('#petModal');
    });
    $('#petsGrid').addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit-pet]');
      const del = e.target.closest('[data-del-pet]');
      if (!edit && !del) return;
      const id = (edit || del).dataset[del ? 'delPet' : 'editPet'];
      if (del) { openDeletePetConfirm(id); return; }
      openPetModal(id);
    });
    $('#btnSavePet').addEventListener('click', savePet);
  }

  async function renderPets() {
    const grid = $('#petsGrid');
    if (!App.currentUser()) {
      petsCache = [];
      grid.innerHTML = `<p class="muted">Aún no registras mascotas.</p>`;
      return;
    }
    try {
      petsCache = await api('/pets');
      if (!petsCache.length) {
        grid.innerHTML = `<p class="muted">Aún no registras mascotas.</p>`;
        return;
      }
      grid.innerHTML = petsCache.map(p => `
      <div class="panel" style="margin:0">
        <div style="font-size:2rem">${p.species === 'Perros' ? '🐕' : '🐈'}</div>
        <h4 class="mt-2">${esc(p.name)}</h4>
        <p class="muted" style="font-size:.85rem">${esc(p.breed || 'Raza: —')} · ${p.age} años</p>
        <p class="muted" style="font-size:.85rem">Ración: ${p.ration ? p.ration + ' g/día' : 'no definida'}${p.weight ? ' · ' + p.weight + ' kg' : ''}</p>
        <div class="row mt-3">
          <button class="btn btn-outline btn-sm grow" data-edit-pet="${p.id}">Editar</button>
          <button class="btn btn-outline btn-sm" style="color:var(--red-500);border-color:var(--red-500)" data-del-pet="${p.id}">Eliminar</button>
        </div>
      </div>`).join('');
    } catch {
      grid.innerHTML = `<p class="muted">No se pudieron cargar tus mascotas.</p>`;
    }
  }

  function openPetModal(id) {
    const p = petsCache.find(x => x.id === id);
    if (!p) return;
    editingPetId = id;
    $('#petModalTitle').textContent = 'Editar mascota';
    $('#petName').value = p.name;
    $('#petSpecies').value = p.species;
    $('#petBreed').value = p.breed;
    $('#petAge').value = p.age;
    $('#petRation').value = p.ration;
    $('#petWeight').value = p.weight || '';
    openModal('#petModal');
  }

  async function deletePet(id) {
    try {
      await api('/pets/' + id, { method: 'DELETE' });
      toast('Mascota eliminada');
      renderPets();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function savePet() {
    if (!App.currentUser()) return;
    const name = $('#petName').value.trim();
    const species = $('#petSpecies').value;
    const breed = $('#petBreed').value.trim();
    const age = parseFloat($('#petAge').value);
    const ration = parseFloat($('#petRation').value) || 0;
    const weight = parseFloat($('#petWeight').value) || null;
    if (!name || isNaN(age)) { toast('Completa nombre y edad', 'error'); return; }
    const body = { name, species, breed, age, ration, weight };
    try {
      if (editingPetId) {
        await api('/pets/' + editingPetId, { method: 'PUT', body });
        toast('Mascota actualizada 🐾', 'success');
      } else {
        await api('/pets', { method: 'POST', body });
        toast('Mascota guardada 🐾', 'success');
      }
      closeModals();
      renderPets();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ---------- Historial ---------- */
  async function renderOrders() {
    const user = App.currentUser();
    const wrap = $('#ordersList');
    $('#loginHistHint').classList.toggle('hidden', !!user);
    if (!user) { wrap.innerHTML = ''; return; }
    try {
      const orders = await api('/orders');
      if (!orders.length) {
        wrap.innerHTML = `<div class="panel ta-center"><p class="muted">Aún no has realizado pedidos.</p><button class="btn btn-gold mt-3" data-nav="tienda">Ir a la tienda</button></div>`;
        return;
      }
      const statusBadge = (s) => `<span class="badge ${statusInfo(s).cls}">${statusInfo(s).label}</span>`;

      wrap.innerHTML = orders.map(o => `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>${esc(o.id)}</h3>
            <span class="muted" style="font-size:.85rem">${new Date(o.createdAt).toLocaleString('es-CO')}</span>
          </div>
          ${statusBadge(o.status)}
        </div>
        <div class="table-wrap mb-3">
          <table>
            <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
            <tbody>
              ${o.items.map(i => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td class="money">${fmtMoney(i.price)}</td><td class="money">${fmtMoney(i.price * i.qty)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="row" style="justify-content:space-between;align-items:flex-end">
          <div class="muted" style="font-size:.85rem">
            <div>🛵 Entrega: <strong>${esc(o.deliveryLabel)}</strong> (franja ${o.deliverySlot === 'manana' ? '🌅 Mañana' : '🌇 Tarde'})</div>
            ${o.status === 'entregado' ? `<div>📦 ${o.deliveredAt ? 'Entregado el ' + new Date(o.deliveredAt).toLocaleDateString('es-CO') : 'Entregado (sin fecha registrada)'}</div>` : ''}
            <div>💳 Pago: ${o.payment.method === 'efectivo' ? 'Efectivo' + (o.payment.denomination ? ` — billete $${o.payment.denomination.toLocaleString('es-CO')}` : ' — sin cambio') : 'Digital (transferencia/datáfono)'}</div>
            <div>📍 ${esc(o.address)}</div>
          </div>
          <div style="text-align:right">
            <div class="summary-line" style="padding:2px 0"><span>Subtotal</span><span class="money">${fmtMoney(o.subtotal)}</span></div>
            <div class="summary-line" style="padding:2px 0"><span>Domicilio</span><span class="money">${fmtMoney(o.delivery)}</span></div>
            <div class="summary-line total" style="margin-top:0"><span>Total</span><span class="money">${fmtMoney(o.total)}</span></div>
          </div>
        </div>
      </div>`).join('');
    } catch {
      wrap.innerHTML = `<div class="panel ta-center"><p class="muted">No se pudieron cargar tus pedidos.</p></div>`;
    }
  }

  /* ---------- Herramientas ---------- */
  function fillCalcSelects() {
    const food = App.products.filter(p => p.grams > 0);
    const label = (p) => `${esc(p.name)} — ${productPresentation(p) || esc(p.unit)}`;
    const opts = food.map(p => `<option value="${p.id}" data-grams="${p.grams}" data-ration="${p.dailyRation}" data-freq="${p.purchaseFrequencyMonths || 1}">${label(p)}</option>`).join('');
    $('#calcProduct').innerHTML = opts;
    $('#compProduct').innerHTML = food.map(p => `<option value="${p.id}" data-grams="${p.grams}" data-price="${p.price}" data-ration="${p.dailyRation}" data-freq="${p.purchaseFrequencyMonths || 1}">${label(p)}</option>`).join('');
    $('#calcProduct').addEventListener('change', (e) => {
      const o = e.target.selectedOptions[0];
      if (!o) return;
      $('#calcGrams').value = o.dataset.grams;
      $('#calcRation').value = o.dataset.ration;
    });
    const syncComp = () => {
      const o = $('#compProduct').selectedOptions[0];
      if (!o) return;
      $('#compGrams').value = o.dataset.grams / 1000;
    };
    $('#compProduct').addEventListener('change', () => { syncComp(); compState = null; $('#compResult').innerHTML = ''; });
    const toggleCompGrams = () => {
      $('#compGramsField').style.display = $('#compSame').checked ? 'none' : '';
      syncComp();
      compState = null;
      $('#compResult').innerHTML = '';
    };
    $('#compSame').addEventListener('change', toggleCompGrams);
    syncComp();
    toggleCompGrams();
  }

  function bindTools() {
    $('#btnCalcDuration').addEventListener('click', () => {
      const grams = parseFloat($('#calcGrams').value);
      const ration = parseFloat($('#calcRation').value);
      if (!grams || !ration || ration <= 0) { toast('Indica gramaje y ración diaria', 'error'); return; }
      const days = Math.floor(grams / ration);
      const bags = days > 0 ? Math.ceil(30 / days) : 0;
      $('#calcResult').innerHTML = `
        <div class="panel" style="background:var(--cloud)">
          <strong>📦 ${Number(grams).toLocaleString('es-CO')} g / ${ration} g/día</strong>
          <div class="row mt-3" style="justify-content:space-between">
            <div class="ta-center grow"><div style="font-size:1.8rem;font-weight:800;color:var(--navy-800)">${days}</div><div class="muted" style="font-size:.8rem">días de alimento</div></div>
            <div class="ta-center grow"><div style="font-size:1.8rem;font-weight:800;color:var(--navy-800)">${(days / 30.4).toFixed(1)}</div><div class="muted" style="font-size:.8rem">meses aprox.</div></div>
            <div class="ta-center grow"><div style="font-size:1.8rem;font-weight:800;color:var(--gold-600)">${bags}</div><div class="muted" style="font-size:.8rem">paquetes por mes</div></div>
          </div>
        </div>`;
    });

    const buildAnnual = () => {
      const s = compState;
      if (!s) return '';
      const money = (n) => fmtMoney(Math.round(n));
      const headline = (savings) => {
        if (s.equal) return { text: '⚖️ Sin ahorro anual — mismo precio por kg', color: 'var(--navy-800)' };
        if (s.cheaper) return { text: `💰 Ahorro anual estimado: ${money(savings)}`, color: 'var(--green-600)' };
        return { text: `💰 Costo adicional anual: ${money(Math.abs(savings))}`, color: 'var(--red-500)' };
      };
      if (s.ration > 0) {
        const annualKg = s.ration * 365 / 1000;
        const cpAnnual = s.cpPerKg * annualKg;
        const compAnnual = s.compPerKg * annualKg;
        const h = headline(compAnnual - cpAnnual);
        return `
          <div class="mt-3" style="border-top:1px dashed #d0d6dd;padding-top:.75rem">
            <div style="font-size:1.15rem;font-weight:800;color:${h.color};margin-bottom:.4rem">${h.text}</div>
            <div class="muted" style="font-size:.72rem;margin-bottom:.4rem">Estimación basada en la ración diaria de ${s.ration} g/día y 365 días de consumo.</div>
            <div class="summary-line"><span>Consumo diario</span><span>${s.ration} g/día</span></div>
            <div class="summary-line"><span>Consumo anual</span><span>${Number(annualKg).toLocaleString('es-CO', { maximumFractionDigits: 1 })} kg</span></div>
            <div class="summary-line"><span>City Pets al año</span><span class="money">${money(cpAnnual)}</span></div>
            <div class="summary-line"><span>Competencia al año</span><span class="money">${money(compAnnual)}</span></div>
          </div>`;
      }
      const pesoKg = s.grams / 1000;
      const comprasAnuales = 12 / s.freq;
      const annualKg = pesoKg * comprasAnuales;
      const cpAnnual = s.cpPerKg * annualKg;
      const compAnnual = s.compPerKg * annualKg;
      const h = headline(compAnnual - cpAnnual);
      return `
        <div class="mt-3" style="border-top:1px dashed #d0d6dd;padding-top:.75rem">
          <div style="font-size:1.15rem;font-weight:800;color:${h.color};margin-bottom:.4rem">${h.text}</div>
          <div class="muted" style="font-size:.72rem;margin-bottom:.4rem">Estimación para productos sin ración diaria, según la frecuencia de compra del producto (cada ${s.freq} mes${s.freq > 1 ? 'es' : ''}).</div>
          <div class="summary-line"><span>Presentación</span><span>${Number(pesoKg).toLocaleString('es-CO', { maximumFractionDigits: 1 })} kg</span></div>
          <div class="summary-line"><span>Periodicidad de compra</span><span>Cada ${s.freq} mes${s.freq > 1 ? 'es' : ''}</span></div>
          <div class="summary-line"><span>Compras estimadas al año</span><span>${Number(comprasAnuales).toLocaleString('es-CO', { maximumFractionDigits: 1 })}</span></div>
          <div class="summary-line"><span>Consumo anual estimado</span><span>${Number(annualKg).toLocaleString('es-CO', { maximumFractionDigits: 1 })} kg</span></div>
          <div class="summary-line"><span>Gasto anual City Pets</span><span class="money">${money(cpAnnual)}</span></div>
          <div class="summary-line"><span>Gasto anual competidor</span><span class="money">${money(compAnnual)}</span></div>
        </div>`;
    };

    const runCompare = () => {
      const opt = $('#compProduct').selectedOptions[0];
      const p = opt ? App.products.find(x => x.id === opt.value) : null;
      if (!p) { toast('Selecciona un producto City Pets', 'error'); return; }
      const same = $('#compSame').checked;
      const compPrice = parseFloat($('#compPrice').value);
      const compGrams = same ? p.grams : parseFloat($('#compGrams').value) * 1000;
      const grams = typeof p.grams === 'number' ? p.grams : (parseInt(p.grams, 10) || 0);
      const ration = typeof p.dailyRation === 'number' ? p.dailyRation : (parseInt(p.dailyRation, 10) || 0);
      let freq = typeof p.purchaseFrequencyMonths === 'number' ? p.purchaseFrequencyMonths : (parseInt(p.purchaseFrequencyMonths, 10) || 1);
      if (isNaN(freq) || freq < 1) freq = 1;
      freq = Math.min(freq, 24);
      if (isNaN(compPrice) || compPrice <= 0 || isNaN(compGrams) || compGrams <= 0) {
        compState = null;
        $('#compResult').innerHTML = '';
        toast('Completa precio y gramaje de la competencia (positivos)', 'error');
        return;
      }
      if (!grams || grams <= 0) {
        compState = null;
        $('#compResult').innerHTML = '';
        toast('Este producto no tiene gramaje registrado; no se puede calcular el precio por kg', 'error');
        return;
      }
      const cpPrice = p.price;
      const cpGrams = grams;
      const fmtKg = (g) => `${Number(g / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} kg`;
      const cpPerKg = cpPrice / cpGrams * 1000;
      const compPerKg = compPrice / compGrams * 1000;
      const diff = cpPerKg - compPerKg;
      const pct = (Math.abs(diff) / compPerKg * 100).toFixed(1);
      const equal = Math.abs(diff) < 0.005;
      const cheaper = diff < 0;
      const diffColor = equal ? 'var(--navy-800)' : cheaper ? 'var(--green-600)' : 'var(--red-500)';
      const diffLabel = equal
        ? 'Sin diferencia'
        : `${fmtMoney(Math.round(Math.abs(diff)))}/kg ${cheaper ? 'a favor de City Pets' : 'a favor de la competencia'}`;

      compState = { ration, grams, freq, cpPerKg, compPerKg, equal, cheaper, diffColor };
      const perKgHtml = `
        <div class="panel" style="background:var(--cloud)">
          <div class="muted" style="font-size:.85rem;margin-bottom:.5rem">${esc(p.name)} · ${esc(p.unit)}${same ? ' — Referencia: mismo producto / mismas características' : ''}</div>
          <div class="row" style="justify-content:space-between">
            <div class="ta-center grow">
              <div class="muted" style="font-size:.75rem">CITY PETS</div>
              <div style="font-size:1.4rem;font-weight:800;color:var(--navy-800)" class="money">${fmtMoney(cpPrice)}</div>
              <div class="muted" style="font-size:.72rem">${fmtMoney(Math.round(cpPerKg))}/kg · ${fmtKg(cpGrams)}</div>
            </div>
            <div class="ta-center grow">
              <div class="muted" style="font-size:.75rem">COMPETENCIA</div>
              <div style="font-size:1.4rem;font-weight:800;color:var(--gray-700)" class="money">${fmtMoney(compPrice)}</div>
              <div class="muted" style="font-size:.72rem">${fmtMoney(Math.round(compPerKg))}/kg · ${fmtKg(compGrams)}</div>
            </div>
          </div>
          <div class="mt-3" style="border-top:1px dashed #d0d6dd;padding-top:.75rem">
            <div class="summary-line">
              <span>Diferencia por kg</span>
              <span style="font-weight:800;color:${diffColor}">${diffLabel}</span>
            </div>
            <div class="ta-center mt-2" style="font-weight:800;color:${diffColor}">
              ${equal
                ? '⚖️ Mismo precio por kg'
                : cheaper
                  ? `✅ City Pets es ${pct}% más económico`
                  : `⚠️ City Pets es ${pct}% más caro`}
            </div>
          </div>
        </div>`;
      compState.perKgHtml = perKgHtml;
      $('#compResult').innerHTML = perKgHtml + buildAnnual();
    };

    $('#btnCompare').addEventListener('click', runCompare);

    $('#btnFeedback').addEventListener('click', submitFeedback);
  }

  async function fillRecommendations() {
    const user = App.currentUser();
    let list = App.products;
    let species = [];
    if (user) {
      try {
        const pets = petsCache.length ? petsCache : await api('/pets');
        species = pets.map(p => p.species);
      } catch { species = []; }
    }
    if (species.length) {
      list = list.filter(p => species.includes(p.species));
      const pref = list.filter(p => p.featured);
      if (pref.length) list = pref.concat(list.filter(p => !p.featured));
    } else {
      list = [...list].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    }
    const recs = list.slice(0, 6);
    $('#recommendations').innerHTML = recs.length ? recs.map(p => `
      <article class="card" data-product="${p.id}">
        <div class="card-media">
          <img src="${esc(p.images[0] || IMG_PLACEHOLDER)}" alt="${esc(p.name)}" loading="lazy" />
          ${p.stock <= 15 ? '<span class="tag-badge" style="background:var(--red-500);color:#fff">Últimas unidades</span>' : '<span class="tag-badge">Recomendado</span>'}
        </div>
        <div class="card-body">
          <span class="cat">${esc(p.species)} · ${esc(p.category)}</span>
          <h3>${esc(p.name)}</h3>
          <div class="price-row"><span class="price money">${fmtMoney(p.price)}</span><span class="unit">${esc(p.unit)}</span></div>
        </div>
        <div class="card-footer"><button class="btn btn-gold grow" data-add="${p.id}">Añadir — ${fmtMoney(p.price)}</button></div>
      </article>`).join('')
    : '<p class="muted">Sin recomendaciones por ahora.</p>';
  }

  function submitFeedback() {
    const get = (name) => parseInt(($('input[name="' + name + '"]:checked') || {}).value, 10) || 0;
    const f = { calidad: get('f_calidad'), uso: get('f_uso'), cumplimiento: get('f_cumpl'), confianza: get('f_conf') };
    const msg = $('#feedbackMsg').value.trim();
    if (!f.calidad || !f.uso || !f.cumplimiento || !f.confianza) { toast('Califica los 4 pilares', 'error'); return; }
    const user = App.currentUser();
    const item = { id: uid('FB'), ...f, msg, userName: user ? user.name : 'Anónimo', date: new Date().toISOString() };
    App.feedback = [...App.feedback, item];
    $('#feedbackMsg').value = '';
    $$('#view-herramientas input[type=radio]').forEach(r => r.checked = false);
    toast('¡Gracias por tu feedback! 💛', 'success');
    renderFeedbackList();
  }

  function renderFeedbackList() {
    const list = App.feedback.slice(-5).reverse();
    const avg = (arr, k) => arr.length ? (arr.reduce((s, x) => s + x[k], 0) / arr.length).toFixed(1) : '—';
    $('#feedbackList').innerHTML = list.length ? `
      <div class="panel" style="background:var(--cloud)">
        <div class="row" style="justify-content:space-around;text-align:center">
          <div><div class="muted" style="font-size:.7rem">CALIDAD</div><strong>${avg(App.feedback, 'calidad')}</strong></div>
          <div><div class="muted" style="font-size:.7rem">USO</div><strong>${avg(App.feedback, 'uso')}</strong></div>
          <div><div class="muted" style="font-size:.7rem">CUMPLIMIENTO</div><strong>${avg(App.feedback, 'cumplimiento')}</strong></div>
          <div><div class="muted" style="font-size:.7rem">CONFIANZA</div><strong>${avg(App.feedback, 'confianza')}</strong></div>
        </div>
      </div>
      <h4 class="mt-3 mb-3">Opiniones recientes</h4>
      ${list.map(x => `
        <div class="panel" style="padding:14px">
          <div class="row" style="justify-content:space-between;align-items:center">
            <strong>${esc(x.userName)}</strong>
            <span class="muted" style="font-size:.75rem">${new Date(x.date).toLocaleDateString('es-CO')}</span>
          </div>
          <div class="mt-2" style="font-size:.85rem">
            Calidad <span class="stars-readonly">${renderStars(x.calidad)}</span> ·
            Uso <span class="stars-readonly">${renderStars(x.uso)}</span> ·
            Cumplimiento <span class="stars-readonly">${renderStars(x.cumplimiento)}</span> ·
            Confianza <span class="stars-readonly">${renderStars(x.confianza)}</span>
          </div>
          ${x.msg ? `<p class="mt-2" style="font-size:.9rem">“${esc(x.msg)}”</p>` : ''}
        </div>`).join('')}`
    : '<p class="muted">Aún no hay evaluaciones.</p>';
  }

  /* ---------- Confirmación de borrado ---------- */
  let pendingDeletePetId = null;

  function openDeletePetConfirm(id) {
    const p = petsCache.find(x => x.id === id);
    if (!p) return;
    pendingDeletePetId = id;
    $('#cfmTitle').textContent = 'Eliminar mascota';
    $('#cfmBody').innerHTML = `
      <p>Se eliminará a <strong>${esc(p.name)}</strong> de tu perfil.</p>
      <p class="mt-2" style="color:var(--red-500);font-weight:700">⚠️ Esta acción no se puede deshacer.</p>`;
    $('#confirmModal').classList.add('open');
  }

  function closeConfirmModal() {
    pendingDeletePetId = null;
    $('#confirmModal').classList.remove('open');
  }

  function bindConfirm() {
    document.querySelectorAll('[data-close-confirm]').forEach(b =>
      b.addEventListener('click', closeConfirmModal));
    $('#cfmDelete').addEventListener('click', () => {
      const id = pendingDeletePetId;
      closeConfirmModal();
      if (id) deletePet(id);
    });
  }

  /* ---------- Modales ---------- */
  function openModal(sel) {
    $(sel).classList.add('open');
  }
  function closeModals() {
    $$('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
  }
  window.closeModals = closeModals;
})();
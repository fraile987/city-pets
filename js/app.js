/* =========================================================
   CITY PETS — Lógica del storefront
   ========================================================= */
(() => {
  'use strict';
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    seedProducts();
    populateChannels();
    bindNavigation();
    bindHero();
    bindStore();
    bindCart();
    bindCheckout();
    bindProfile();
    bindPets();
    bindTools();
    renderCart();
    refreshSessionUI();
    renderProducts();
    fillCalcSelects();
    fillRecommendations();
    renderFeedbackList();
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
  function bindHero() {
    const hero = $('#heroSplit');
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const panel = btn.dataset.panel;
      if (action === 'expand') {
        hero.classList.add('maximized');
        hero.classList.remove('to-cats');
        if (panel === 'cats') hero.classList.add('to-cats');
        $$('.split-panel').forEach(p => p.classList.toggle('scrollable', p.dataset.panel === panel));
        toast('Sección maximizada: ' + (panel === 'dogs' ? 'Perros' : 'Gatos'));
      } else if (action === 'restore') {
        hero.classList.remove('maximized', 'to-cats');
        $$('.split-panel').forEach(p => p.classList.remove('scrollable'));
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
    grid.innerHTML = list.map(p => `
      <article class="card" data-product="${p.id}">
        <div class="card-media">
          <img src="${p.images[0]}" alt="${p.name}" loading="lazy" />
          ${p.tags.includes('top') ? '<span class="tag-badge">Destacado</span>' : ''}
          <span class="stock-badge">${p.stock} en bodega</span>
        </div>
        <div class="card-body">
          <span class="cat">${p.species} · ${p.category}</span>
          <h3>${p.name}</h3>
          <p class="desc">${p.desc}</p>
          <div class="price-row">
            <span class="price money">${fmtMoney(p.price)}</span>
            <span class="unit">${p.unit}</span>
          </div>
        </div>
        <div class="card-footer">
          <button class="btn btn-navy grow" data-add="${p.id}">Añadir al carrito</button>
          <button class="btn btn-outline" data-view="${p.id}">Ver</button>
        </div>
      </article>`).join('');
  }

  function openProductModal(id) {
    const p = App.products.find(x => x.id === id);
    if (!p) return;
    $('#pmTitle').textContent = p.name;
    $('#pmBody').innerHTML = `
      <img src="${p.images[0]}" alt="${p.name}" style="border-radius:10px;aspect-ratio:4/3;object-fit:cover;width:100%" />
      <p class="mt-3 muted">${p.species} · ${p.category}</p>
      <h3 class="mt-2">${p.name}</h3>
      <p>${p.desc}</p>
      <div class="price-row mt-3">
        <span class="price money">${fmtMoney(p.price)}</span><span class="unit">${p.unit}</span>
      </div>
      <p class="mt-2"><span class="stars-readonly">${renderStars(p.rating)}</span> ${p.rating} · ${p.stock} unidades en bodega</p>
      ${p.grams ? `<p class="mt-2 muted">📦 ${p.grams} g · Ración diaria sugerida: ${p.dailyRation} g/día</p>` : ''}
      ${p.video ? `<video src="${p.video}" controls style="width:100%;margin-top:12px;border-radius:10px"></video>` : ''}
      <button class="btn btn-gold btn-block mt-4" data-add="${p.id}">Añadir al carrito — ${fmtMoney(p.price)}</button>`;
    openModal('#productModal');
  }

  /* ---------- Carrito ---------- */
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
    return { items, subtotal, delivery: subtotal > 0 ? DELIVERY_COST : 0, total: subtotal + (subtotal > 0 ? DELIVERY_COST : 0) };
  }

  function renderCart() {
    const { items, subtotal, delivery, total } = cartTotals();
    $('#cartCount').textContent = items.reduce((s, i) => s + i.qty, 0);
    $('#cartSubtotal').textContent = fmtMoney(subtotal);
    $('#cartTotal').textContent = fmtMoney(total);
    const body = $('#cartBody');
    if (!items.length) {
      body.innerHTML = `<div class="ta-center muted mt-4">Tu carrito está vacío.<br/>Explora la tienda 🐾</div>`;
      return;
    }
    body.innerHTML = items.map(i => `
      <div class="cart-item">
        <img src="${i.p.images[0]}" alt="${i.p.name}" />
        <div class="cart-item-info">
          <h4>${i.p.name}</h4>
          <div class="price-row" style="margin:2px 0">
            <span class="price money" style="font-size:1.02rem">${fmtMoney(i.p.price)}</span>
          </div>
          <div class="qty-ctl">
            <button data-qty="dec" data-id="${i.p.id}">−</button>
            <span>${i.qty}</span>
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
      const user = App.currentUser();
      if (!user) { toast('Debes registrarte antes de pagar', 'error'); $('#cartDrawer').classList.remove('open'); AppNav('perfil'); return; }
      openCheckout(user);
    });
  }

  /* ---------- Checkout ---------- */
  let selectedPay = 'efectivo';
  let computedDelivery = null;

  function openCheckout(user) {
    const { subtotal, total } = cartTotals();
    computedDelivery = getNextDeliverySlot();
    $('#checkoutUserInfo').innerHTML = `
      <strong>${user.name}</strong><br/>
      <span class="muted">📱 ${user.phone} · ✉️ ${user.email}</span>`;
    $('#coSubtotal').textContent = fmtMoney(subtotal);
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
    $('#checkoutAddress').value = user.address || '';
    openModal('#checkoutModal');
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
  }

  function updateCashChange() {
    const { total } = cartTotals();
    const denom = parseInt($('#cashDenom').value || 0, 10);
    const change = denom > 0 ? Math.max(0, denom - total) : 0;
    $('#cashChange').textContent = change > 0 ? fmtMoney(change) : 'No aplica cambio';
  }

  function confirmOrder() {
    const user = App.currentUser();
    const { items, subtotal, delivery, total } = cartTotals();
    if (!user || !items.length) return;
    const address = $('#checkoutAddress').value.trim();
    if (!address) { toast('Indica la dirección de entrega', 'error'); return; }

    const order = {
      id: uid('ORD'),
      userId: user.id,
      userName: user.name,
      phone: user.phone,
      address,
      items: items.map(i => ({ id: i.p.id, name: i.p.name, qty: i.qty, price: i.p.price, image: i.p.images[0] })),
      subtotal, delivery, total,
      createdAt: new Date().toISOString(),
      slotGenerated: getCurrentSlot(),
      deliverySlot: computedDelivery.slot,
      deliveryDate: computedDelivery.deliveryDate,
      deliveryLabel: computedDelivery.dateLabel,
      payment: selectedPay === 'efectivo'
        ? { method: 'efectivo', denomination: parseInt($('#cashDenom').value || 0, 10) }
        : { method: 'digital' },
      status: 'pendiente'
    };

    /* Descontar inventario */
    const prods = App.products.map(p => {
      const it = items.find(i => i.id === p.id);
      return it ? { ...p, stock: p.stock - it.qty } : p;
    });
    App.products = prods;

    const orders = App.orders;
    orders.push(order);
    App.orders = orders;
    App.cart = [];

    closeModals();
    $('#cartDrawer').classList.remove('open');
    renderCart();
    toast(`¡Pedido ${order.id} confirmado! Entrega ${computedDelivery.name} — ${order.deliveryLabel}.`, 'success');
    AppNav('historial');
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
    $('#btnRegister').addEventListener('click', () => {
      const name = $('#regName').value.trim();
      const phone = $('#regPhone').value.trim();
      const email = $('#regEmail').value.trim();
      const channel = $('#regChannel').value;
      if (!name || !phone || !email) { toast('Completa nombre, móvil y correo', 'error'); return; }
      if (App.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        toast('Ya existe una cuenta con ese correo. Usa el inicio de sesión.', 'error'); return;
      }
      const user = { id: uid('USR'), name, phone, email, address: '', pets: [], channel: channel || 'Directo', createdAt: new Date().toISOString() };
      App.users = [...App.users, user];
      App.attributions = [...App.attributions, { userId: user.id, channel: channel || 'Directo', date: new Date().toISOString() }];
      App.session = user.id;
      $('#regName').value = $('#regPhone').value = $('#regEmail').value = '';
      toast('¡Cuenta creada! Bienvenido a City Pets 🐾', 'success');
      refreshSessionUI();
      refreshProfileView();
      AppNav('perfil');
    });

    $('#btnSaveProfile').addEventListener('click', () => {
      const user = App.currentUser();
      if (!user) return;
      user.name = $('#profName').value.trim();
      user.phone = $('#profPhone').value.trim();
      user.email = $('#profEmail').value.trim();
      user.address = $('#profAddress') ? $('#profAddress').value.trim() : user.address;
      App.users = App.users.map(u => u.id === user.id ? user : u);
      toast('Perfil actualizado', 'success');
      refreshSessionUI();
      refreshProfileView();
    });

    $('#btnLogout').addEventListener('click', () => {
      App.session = null;
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
    $('#registerPanel').classList.toggle('hidden', !!user);
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
  function bindPets() {
    $('#btnAddPet').addEventListener('click', () => {
      const user = App.currentUser();
      if (!user) { toast('Regístrate primero', 'error'); AppNav('perfil'); return; }
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
      const user = App.currentUser();
      if (!user) return;
      const id = (edit || del).dataset[del ? 'delPet' : 'editPet'];
      if (del) {
        user.pets = user.pets.filter(p => p.id !== id);
        App.users = App.users.map(u => u.id === user.id ? user : u);
        toast('Mascota eliminada');
        renderPets();
        return;
      }
      const pet = user.pets.find(p => p.id === id);
      if (!pet) return;
      editingPetId = id;
      $('#petModalTitle').textContent = 'Editar mascota';
      $('#petName').value = pet.name;
      $('#petSpecies').value = pet.species;
      $('#petBreed').value = pet.breed;
      $('#petAge').value = pet.age;
      $('#petRation').value = pet.ration;
      $('#petWeight').value = pet.weight || '';
      openModal('#petModal');
    });
    $('#btnSavePet').addEventListener('click', () => {
      const user = App.currentUser();
      if (!user) return;
      const name = $('#petName').value.trim();
      const species = $('#petSpecies').value;
      const breed = $('#petBreed').value.trim();
      const age = parseFloat($('#petAge').value);
      const ration = parseFloat($('#petRation').value) || 0;
      const weight = parseFloat($('#petWeight').value) || null;
      if (!name || isNaN(age)) { toast('Completa nombre y edad', 'error'); return; }
      const pet = { id: editingPetId || uid('PET'), name, species, breed, age, ration, weight };
      if (editingPetId) {
        user.pets = user.pets.map(p => p.id === editingPetId ? pet : p);
      } else {
        user.pets = [...user.pets, pet];
      }
      App.users = App.users.map(u => u.id === user.id ? user : u);
      toast('Mascota guardada 🐾', 'success');
      closeModals();
      renderPets();
    });
  }

  function renderPets() {
    const user = App.currentUser();
    const grid = $('#petsGrid');
    if (!user || user.pets.length === 0) {
      grid.innerHTML = `<p class="muted">Aún no registras mascotas.</p>`;
      return;
    }
    grid.innerHTML = user.pets.map(p => `
      <div class="panel" style="margin:0">
        <div style="font-size:2rem">${p.species === 'Perros' ? '🐕' : '🐈'}</div>
        <h4 class="mt-2">${p.name}</h4>
        <p class="muted" style="font-size:.85rem">${p.breed || 'Raza: —'} · ${p.age} años</p>
        <p class="muted" style="font-size:.85rem">Ración: ${p.ration ? p.ration + ' g/día' : 'no definida'}${p.weight ? ' · ' + p.weight + ' kg' : ''}</p>
        <div class="row mt-3">
          <button class="btn btn-outline btn-sm grow" data-edit-pet="${p.id}">Editar</button>
          <button class="btn btn-outline btn-sm" style="color:var(--red-500);border-color:var(--red-500)" data-del-pet="${p.id}">Eliminar</button>
        </div>
      </div>`).join('');
  }

  /* ---------- Historial ---------- */
  function renderOrders() {
    const user = App.currentUser();
    const wrap = $('#ordersList');
    $('#loginHistHint').classList.toggle('hidden', !!user);
    if (!user) { wrap.innerHTML = ''; return; }
    const orders = App.orders.filter(o => o.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!orders.length) {
      wrap.innerHTML = `<div class="panel ta-center"><p class="muted">Aún no has realizado pedidos.</p><button class="btn btn-gold mt-3" data-nav="tienda">Ir a la tienda</button></div>`;
      return;
    }
    const statusBadge = (s) => s === 'entregado' ? '<span class="badge badge-green">Entregado</span>'
      : s === 'incidente' ? '<span class="badge badge-red">Incidente</span>'
      : '<span class="badge badge-gold">Pendiente por entregar</span>';

    wrap.innerHTML = orders.map(o => `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>${o.id}</h3>
            <span class="muted" style="font-size:.85rem">${new Date(o.createdAt).toLocaleString('es-CO')}</span>
          </div>
          ${statusBadge(o.status)}
        </div>
        <div class="table-wrap mb-3">
          <table>
            <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
            <tbody>
              ${o.items.map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td class="money">${fmtMoney(i.price)}</td><td class="money">${fmtMoney(i.price * i.qty)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="row" style="justify-content:space-between;align-items:flex-end">
          <div class="muted" style="font-size:.85rem">
            <div>🛵 Entrega: <strong>${o.deliveryLabel}</strong> (franja ${o.deliverySlot === 'manana' ? '🌅 Mañana' : '🌇 Tarde'})</div>
            <div>💳 Pago: ${o.payment.method === 'efectivo' ? 'Efectivo' + (o.payment.denomination ? ` — billete $${o.payment.denomination.toLocaleString('es-CO')}` : ' — sin cambio') : 'Digital (transferencia/datáfono)'}</div>
            <div>📍 ${o.address}</div>
          </div>
          <div style="text-align:right">
            <div class="summary-line" style="padding:2px 0"><span>Subtotal</span><span class="money">${fmtMoney(o.subtotal)}</span></div>
            <div class="summary-line" style="padding:2px 0"><span>Domicilio</span><span class="money">${fmtMoney(o.delivery)}</span></div>
            <div class="summary-line total" style="margin-top:0"><span>Total</span><span class="money">${fmtMoney(o.total)}</span></div>
          </div>
        </div>
      </div>`).join('');
  }

  /* ---------- Herramientas ---------- */
  function fillCalcSelects() {
    const food = App.products.filter(p => p.grams > 0);
    const opts = food.map(p => `<option value="${p.id}" data-grams="${p.grams}" data-ration="${p.dailyRation}">${p.name} (${p.unit})</option>`).join('');
    $('#calcProduct').innerHTML = opts;
    $('#compProduct').innerHTML = food.map(p => `<option value="${p.id}" data-grams="${p.grams}" data-price="${p.price}">${p.name}</option>`).join('');
    $('#calcProduct').addEventListener('change', (e) => {
      const o = e.target.selectedOptions[0];
      if (!o) return;
      $('#calcGrams').value = o.dataset.grams;
      $('#calcRation').value = o.dataset.ration;
    });
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
          <strong>📦 ${fmtMoney(grams)} g / ${ration} g/día</strong>
          <div class="row mt-3" style="justify-content:space-between">
            <div class="ta-center grow"><div style="font-size:1.8rem;font-weight:800;color:var(--navy-800)">${days}</div><div class="muted" style="font-size:.8rem">días de alimento</div></div>
            <div class="ta-center grow"><div style="font-size:1.8rem;font-weight:800;color:var(--navy-800)">${(days / 30.4).toFixed(1)}</div><div class="muted" style="font-size:.8rem">meses aprox.</div></div>
            <div class="ta-center grow"><div style="font-size:1.8rem;font-weight:800;color:var(--gold-600)">${bags}</div><div class="muted" style="font-size:.8rem">paquetes por mes</div></div>
          </div>
        </div>`;
    });

    $('#btnCompare').addEventListener('click', () => {
      const opt = $('#compProduct').selectedOptions[0];
      const compPrice = parseFloat($('#compPrice').value);
      const compGrams = parseFloat($('#compGrams').value);
      if (!opt || !compPrice || !compGrams || compGrams <= 0) { toast('Completa precio y gramaje del competidor', 'error'); return; }
      const cpPrice = parseFloat(opt.dataset.price);
      const cpGrams = parseFloat(opt.dataset.grams);
      const cpPerKg = cpPrice / cpGrams * 1000;
      const compPerKg = compPrice / compGrams * 1000;
      const diff = cpPerKg - compPerKg;
      const pct = (Math.abs(diff) / compPerKg * 100).toFixed(1);
      const cheaper = diff < 0;
      $('#compResult').innerHTML = `
        <div class="panel" style="background:var(--cloud)">
          <div class="row" style="justify-content:space-between">
            <div class="ta-center grow">
              <div class="muted" style="font-size:.75rem">CITY PETS</div>
              <div style="font-size:1.4rem;font-weight:800;color:var(--navy-800)" class="money">${fmtMoney(cpPerKg)}</div>
              <div class="muted" style="font-size:.72rem">por kg (${fmtMoney(cpPrice)} / ${cpGrams} g)</div>
            </div>
            <div class="ta-center grow">
              <div class="muted" style="font-size:.75rem">COMPETIDOR</div>
              <div style="font-size:1.4rem;font-weight:800;color:var(--gray-700)" class="money">${fmtMoney(compPerKg)}</div>
              <div class="muted" style="font-size:.72rem">por kg (${fmtMoney(compPrice)} / ${compGrams} g)</div>
            </div>
          </div>
          <div class="ta-center mt-3" style="font-weight:800;color:${cheaper ? 'var(--green-600)' : 'var(--red-500)'}">
            ${cheaper ? `✅ City Pets es ${pct}% más económico por kg` : `⚠️ City Pets cuesta ${pct}% más por kg`}
          </div>
        </div>`;
    });

    $('#btnFeedback').addEventListener('click', submitFeedback);
  }

  function fillRecommendations() {
    const user = App.currentUser();
    let list = App.products;
    if (user && user.pets.length) {
      const species = user.pets.map(p => p.species);
      list = list.filter(p => species.includes(p.species));
      const pref = list.filter(p => p.tags.includes('top'));
      if (pref.length) list = pref.concat(list.filter(p => !p.tags.includes('top')));
    } else {
      list = [...list].sort((a, b) => (b.tags.includes('top') ? 1 : 0) - (a.tags.includes('top') ? 1 : 0));
    }
    const recs = list.slice(0, 6);
    $('#recommendations').innerHTML = recs.length ? recs.map(p => `
      <article class="card" data-product="${p.id}">
        <div class="card-media">
          <img src="${p.images[0]}" alt="${p.name}" loading="lazy" />
          ${p.stock <= 15 ? '<span class="tag-badge" style="background:var(--red-500);color:#fff">Últimas unidades</span>' : '<span class="tag-badge">Recomendado</span>'}
        </div>
        <div class="card-body">
          <span class="cat">${p.species} · ${p.category}</span>
          <h3>${p.name}</h3>
          <div class="price-row"><span class="price money">${fmtMoney(p.price)}</span><span class="unit">${p.unit}</span></div>
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
            <strong>${x.userName}</strong>
            <span class="muted" style="font-size:.75rem">${new Date(x.date).toLocaleDateString('es-CO')}</span>
          </div>
          <div class="mt-2" style="font-size:.85rem">
            Calidad <span class="stars-readonly">${renderStars(x.calidad)}</span> ·
            Uso <span class="stars-readonly">${renderStars(x.uso)}</span> ·
            Cumplimiento <span class="stars-readonly">${renderStars(x.cumplimiento)}</span> ·
            Confianza <span class="stars-readonly">${renderStars(x.confianza)}</span>
          </div>
          ${x.msg ? `<p class="mt-2" style="font-size:.9rem">“${x.msg}”</p>` : ''}
        </div>`).join('')}`
    : '<p class="muted">Aún no hay evaluaciones.</p>';
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
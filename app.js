const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: STORE_CONFIG.currency, maximumFractionDigits: 0 }).format(Number(value) || 0);
const api = async (path, options = {}) => {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api/${path}`, {
    credentials: 'same-origin', ...options,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Permintaan tidak berhasil. Periksa koneksi lalu coba lagi.');
  return data;
};
const dialogs = ['product-dialog', 'checkout-dialog', 'admin-dialog', 'payment-dialog'].reduce((all, id) => (all[id] = $('#' + id), all), {});
let products = [], categories = [], selectedProduct = null, currentUser = null, authMode = 'login', adminTab = 'products', pollTimer = null;
const open = id => { if (!dialogs[id].open) dialogs[id].showModal(); };
const close = id => { if (dialogs[id].open) dialogs[id].close(); };
function esc(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function toast(element, message, type = '') { if (element) element.innerHTML = `<div class="notice ${type}">${esc(message)}</div>`; }
function setBusy(button, busy, label) { button.disabled = busy; if (label) button.textContent = label; }

function renderAuth(message = '') {
  $('#auth-screen').hidden = false;
  $('#store-app').hidden = true;
  if (dialogs['admin-dialog'].open) close('admin-dialog');
  $('#auth-screen').innerHTML = `
    <div class="auth-layout">
      <section class="auth-story">
        <a class="brand" href="#"><span class="brand-mark">NG</span><span>NEXTGEN<span class="brand-light"> STORE</span></span></a>
        <div class="story-content">
          <span class="eyebrow"><i></i> TOKO DIGITAL INDEPENDEN</span>
          <h1>Urusan digital,<br><em>lebih praktis.</em></h1>
          <p>Temukan produk digital yang kamu butuhkan. Bayar dengan QRIS, lalu pantau pesanan langsung dari akunmu.</p>
          <div class="story-notes"><span><b>01</b> Produk terpilih</span><span><b>02</b> Pembayaran terverifikasi</span><span><b>03</b> Riwayat tersimpan</span></div>
        </div>
        <div class="story-footer"><span>Belanja digital, dengan jelas.</span><span>EST. 2026</span></div>
      </section>
      <section class="auth-side">
        <div class="auth-card">
          <div class="auth-heading"><span class="eyebrow">AKUN NEXTGEN</span><h2>${authMode === 'login' ? 'Senang melihatmu lagi.' : 'Mulai dari sini.'}</h2><p>${authMode === 'login' ? 'Masuk dengan username atau email untuk melanjutkan.' : 'Buat akun untuk berbelanja dan menyimpan riwayat pesananmu.'}</p></div>
          <div class="auth-switch"><button type="button" data-auth-mode="login" class="${authMode === 'login' ? 'active' : ''}">Masuk</button><button type="button" data-auth-mode="register" class="${authMode === 'register' ? 'active' : ''}">Daftar</button></div>
          <form id="auth-form" class="auth-form">
            ${authMode === 'register' ? `<label class="field"><span>Nama lengkap</span><input name="display_name" required minlength="2" maxlength="80" autocomplete="name" placeholder="Nama kamu"></label>` : ''}
            <label class="field"><span>${authMode === 'login' ? 'Username atau email' : 'Username'}</span><input name="identity" ${authMode === 'register' ? 'pattern="[a-zA-Z0-9_]{3,24}" minlength="3" maxlength="24"' : ''} required autocomplete="username" placeholder="${authMode === 'login' ? 'username / email' : 'username_kamu'}"></label>
            ${authMode === 'register' ? `<label class="field"><span>Email</span><input name="email" type="email" required maxlength="120" autocomplete="email" placeholder="nama@email.com"></label>` : ''}
            <label class="field"><span>Password</span><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="${authMode === 'login' ? 'current-password' : 'new-password'}" placeholder="Minimal 8 karakter"></label>
            <button class="button button-primary auth-submit" type="submit">${authMode === 'login' ? 'Masuk ke toko' : 'Buat akun'} <span>↗</span></button>
          </form>
          <div id="auth-message" aria-live="polite">${message ? `<div class="notice error">${esc(message)}</div>` : ''}</div>
          <p class="auth-footnote">Akunmu digunakan untuk mengelola pesanan dan menyimpan riwayat transaksi. Jangan bagikan kata sandi kepada siapa pun.</p>
        </div>
        <span class="auth-copyright">© ${new Date().getFullYear()} NEXTGEN STORE</span>
      </section>
    </div>`;
  $$('[data-auth-mode]').forEach(button => button.addEventListener('click', () => { authMode = button.dataset.authMode; renderAuth(); }));
  $('#auth-form').addEventListener('submit', submitAuth);
}

async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget, data = new FormData(form), button = $('button[type="submit"]', form);
  setBusy(button, true, authMode === 'login' ? 'Memeriksa akun…' : 'Membuat akun…');
  try {
    let result;
    if (authMode === 'register') {
      result = await api('auth/register', { method: 'POST', body: JSON.stringify({ display_name: data.get('display_name'), username: data.get('identity'), email: data.get('email'), password: data.get('password') }) });
    } else {
      result = await api('auth/login', { method: 'POST', body: JSON.stringify({ identity: data.get('identity'), password: data.get('password') }) });
    }
    currentUser = result.user;
    await enterApplication();
  } catch (error) {
    toast($('#auth-message'), error.message, 'error');
    setBusy(button, false, authMode === 'login' ? 'Masuk ke toko ↗' : 'Buat akun ↗');
  }
}

async function enterApplication() {
  $('#auth-screen').hidden = true;
  $('#store-app').hidden = false;
  $('#account-label').textContent = currentUser.role === 'admin' ? 'Administrator' : (currentUser.display_name || currentUser.username);
  $('.account-avatar').textContent = (currentUser.display_name || currentUser.username || 'N').trim().charAt(0).toUpperCase();
  $('#admin-open').hidden = currentUser.role !== 'admin';
  $('#account-role').textContent = currentUser.role === 'admin' ? 'ADMIN' : 'MEMBER';
  await loadCatalog();
  if (currentUser.role === 'admin') {
    adminTab = 'products';
    renderAdmin();
    open('admin-dialog');
  } else {
    await loadMyOrders();
  }
}

async function logout() {
  try { await api('auth/logout', { method: 'POST' }); } catch (_) {}
  if (pollTimer) clearInterval(pollTimer);
  currentUser = null; products = []; categories = []; authMode = 'login'; renderAuth();
}

async function loadCatalog() {
  try {
    const data = await api('products');
    products = data.products || []; categories = data.categories || [];
    renderCatalog();
  } catch (error) {
    $('#products').innerHTML = `<div class="empty-state">Katalog belum dapat dimuat.<small>${esc(error.message)}</small></div>`;
  }
}
function renderCatalog() {
  const filter = $('#category-filter').value, query = $('#search').value.trim().toLowerCase();
  $('#category-filter').innerHTML = '<option value="">Semua kategori</option>' + categories.map(category => `<option value="${esc(category.id)}">${esc(category.name)}</option>`).join('');
  $('#category-filter').value = filter;
  const list = products.filter(product => product.is_active !== false && (!filter || product.category_id === filter) && (!query || `${product.name} ${product.description} ${product.category_name || ''}`.toLowerCase().includes(query)));
  $('#products').innerHTML = list.length ? list.map(product => `
    <article class="product-card">
      <button class="product-open" data-product="${esc(product.id)}" aria-label="Lihat ${esc(product.name)}">
        <div class="product-image">${product.image_url ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy">` : '<span class="product-placeholder">NG<span>.</span></span>'}<span class="image-index">PRODUK / ${String(products.indexOf(product) + 1).padStart(2, '0')}</span></div>
        <div class="product-info"><span class="product-category">${esc(product.category_name || 'Produk digital')}</span><h3>${esc(product.name)}</h3><p>${esc(product.description || 'Produk digital pilihan.')}</p><div class="product-foot"><strong class="price">${money(product.price)}</strong><span class="product-arrow">↗</span></div></div>
      </button>
    </article>`).join('') : '<div class="empty-state">Belum ada produk yang cocok.<small>Coba kata kunci atau kategori lain.</small></div>';
  $$('[data-product]').forEach(button => button.addEventListener('click', () => showProduct(button.dataset.product)));
}
function showProduct(id) {
  selectedProduct = products.find(product => product.id === id); if (!selectedProduct) return;
  const product = selectedProduct;
  $('#product-detail').innerHTML = `<div class="eyebrow">DETAIL PRODUK</div><h2>${esc(product.name)}</h2>${product.image_url ? `<img class="detail-image" src="${esc(product.image_url)}" alt="${esc(product.name)}">` : ''}<p>${esc(product.description || 'Produk digital pilihan.')}</p><div class="detail-meta"><span>${esc(product.category_name || 'Produk digital')}</span><strong class="price">${money(product.price)}</strong></div><button class="button button-primary full-button" id="start-checkout">Lanjut checkout <span>↗</span></button>`;
  $('#start-checkout').onclick = () => { close('product-dialog'); showCheckout(product); };
  open('product-dialog');
}
function showCheckout(product) {
  selectedProduct = product;
  $('#checkout-content').innerHTML = `<div class="eyebrow">PEMBAYARAN</div><h2>Periksa pesananmu.</h2><p>Pesanan akan terhubung ke akun <b>${esc(currentUser.display_name || currentUser.username)}</b>.</p><div class="checkout-summary"><span>${esc(product.name)}</span><strong>${money(product.price)}</strong></div><div class="checkout-account"><span>EMAIL PENERIMA</span><b>${esc(currentUser.email)}</b></div><button class="button button-primary full-button" id="create-invoice">Buat pembayaran QRIS <span>↗</span></button><div id="checkout-message"></div>`;
  $('#create-invoice').onclick = async event => {
    const button = event.currentTarget; setBusy(button, true, 'Membuat invoice…');
    try {
      const result = await api('checkout', { method: 'POST', body: JSON.stringify({ product_id: product.id }) });
      close('checkout-dialog'); showPayment(result.order); await loadMyOrders();
    } catch (error) { toast($('#checkout-message'), error.message, 'error'); setBusy(button, false, 'Buat pembayaran QRIS ↗'); }
  };
  open('checkout-dialog');
}
function showPayment(order) {
  $('#payment-content').innerHTML = `<div class="payment-box"><div class="eyebrow centered">PEMBAYARAN / ${esc(order.order_code)}</div><h2>Selesaikan pembayaran.</h2><p>Bayar sesuai nominal berikut. Status akan diperiksa otomatis oleh server.</p><div class="payment-total">${money(order.total)}</div>${order.qris_image ? `<img class="qr-image" src="${esc(order.qris_image)}" alt="QRIS payment">` : ''}${order.payment_link ? `<a class="payment-link" target="_blank" rel="noopener" href="${esc(order.payment_link)}">Buka halaman pembayaran ↗</a>` : ''}<span id="payment-status" class="status-pill">Menunggu pembayaran</span><p class="small-note">Jangan bagikan kode pesanan kepada orang lain.</p></div>`;
  open('payment-dialog'); checkPayment(order.order_code); if (pollTimer) clearInterval(pollTimer); pollTimer = setInterval(() => checkPayment(order.order_code), 12000);
}
async function checkPayment(code) {
  try {
    const data = await api(`orders/status?code=${encodeURIComponent(code)}`), order = data.order, status = $('#payment-status');
    if (!status) return;
    status.textContent = order.status === 'paid' ? 'Pembayaran berhasil' : order.status === 'expired' ? 'Invoice kedaluwarsa' : 'Menunggu pembayaran';
    status.className = `status-pill ${order.status === 'paid' ? 'paid' : ''}`;
    if (order.status === 'paid' || order.status === 'expired') {
      clearInterval(pollTimer);
      if (order.status === 'paid') { $('#payment-content').insertAdjacentHTML('beforeend', `<div class="notice success">Pembayaran terverifikasi. Produk sudah tersedia di bagian Pesanan Saya.</div>`); await loadMyOrders(); }
    }
  } catch (_) { /* retry on next interval */ }
}

async function loadMyOrders() {
  if (!currentUser || currentUser.role !== 'user') return;
  const container = $('#my-orders'); if (!container) return;
  try {
    const data = await api('account/orders');
    container.innerHTML = data.orders.length ? data.orders.map(order => `<article class="order-card"><div class="order-top"><div><span class="order-code">${esc(order.order_code)}</span><h3>${esc(order.product_name)}</h3><small>${new Date(order.created_at).toLocaleString('id-ID')}</small></div><span class="status-pill ${order.status === 'paid' ? 'paid' : ''}">${esc(order.status.toUpperCase())}</span></div><div class="order-bottom"><strong>${money(order.total)}</strong>${order.status === 'paid' ? `<button class="mini-btn" data-delivery="${esc(order.order_code)}">Lihat pengiriman ↗</button>` : `<span class="muted">${order.status === 'pending' ? 'Menunggu pembayaran' : 'Transaksi selesai'}</span>`}</div><div class="delivery-content" id="delivery-${esc(order.order_code)}">${order.status === 'paid' ? `<pre>${esc(order.delivery_value || 'Belum ada instruksi pengiriman.')}</pre>` : ''}</div></article>`).join('') : '<div class="orders-empty"><span class="empty-symbol">↗</span><b>Belum ada pesanan</b><p>Pesanan yang kamu buat akan muncul di sini.</p><a href="#catalog">Lihat katalog</a></div>';
    $$('[data-delivery]').forEach(button => button.addEventListener('click', () => { const target = $(`#delivery-${CSS.escape(button.dataset.delivery)}`); target.classList.toggle('visible'); button.textContent = target.classList.contains('visible') ? 'Tutup detail ↑' : 'Lihat pengiriman ↗'; }));
  } catch (error) { container.innerHTML = `<div class="notice error">${esc(error.message)}</div>`; }
}

function renderAdmin() {
  $('#admin-content').innerHTML = `<div class="admin-head"><div><div class="eyebrow">CONTROL ROOM / 01</div><h2>Store management.</h2><p>Signed in as <b>${esc(currentUser.username)}</b></p></div><div class="admin-head-actions"><button class="mini-btn" id="storefront">Lihat toko</button><button class="mini-btn" id="admin-logout">Keluar</button></div></div><div class="admin-tabs"><button data-tab="products" class="${adminTab === 'products' ? 'active' : ''}">Produk</button><button data-tab="orders" class="${adminTab === 'orders' ? 'active' : ''}">Pesanan</button><button data-tab="backup" class="${adminTab === 'backup' ? 'active' : ''}">Backup & Restore</button></div><div id="admin-panel"></div>`;
  $('#storefront').onclick = () => close('admin-dialog');
  $('#admin-logout').onclick = logout;
  $$('[data-tab]').forEach(button => button.onclick = () => { adminTab = button.dataset.tab; renderAdmin(); });
  renderAdminPanel();
}
async function renderAdminPanel() {
  const panel = $('#admin-panel'); if (!panel) return;
  try {
    if (adminTab === 'products') {
      const data = await api('admin/products');
      panel.innerHTML = `<div class="admin-section-title"><div><span class="eyebrow">CATALOG / INVENTORY</span><h3>Tambah produk</h3></div><span class="count-tag">${data.products.length} ITEMS</span></div><form id="product-form" class="form-grid"><label class="field"><span>Nama produk</span><input name="name" required maxlength="100" placeholder="Contoh: Premium Access"></label><label class="field"><span>Harga (rupiah)</span><input name="price" type="number" min="1" required placeholder="25000"></label><label class="field"><span>Kategori</span><input name="category" required placeholder="Voucher"></label><label class="field"><span>Gambar produk</span><input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label><label class="field full"><span>Deskripsi</span><textarea name="description" placeholder="Jelaskan isi dan ketentuan produk…"></textarea></label><label class="field"><span>Jenis pengiriman</span><select name="delivery_type"><option value="text">Teks / link</option><option value="code">Kode digital</option></select></label><label class="field"><span>Isi pengiriman / stok kode</span><textarea name="delivery_value" placeholder="Untuk kode, satu kode per baris."></textarea></label><div class="full"><button class="button button-primary">Simpan produk <span>＋</span></button></div></form><div id="product-message"></div><div class="admin-section-title list-title"><div><span class="eyebrow">LIVE INVENTORY</span><h3>Daftar produk</h3></div></div><div class="admin-list">${data.products.map(product => `<div class="admin-row"><div class="admin-product-name"><b>${esc(product.name)}</b><small>${money(product.price)} · ${esc(product.category_name || '')}</small></div><div class="admin-actions"><button class="mini-btn" data-toggle="${esc(product.id)}" data-active="${product.is_active}">${product.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button><button class="mini-btn danger" data-delete="${esc(product.id)}">Hapus</button></div></div>`).join('') || '<p class="muted">Belum ada produk.</p>'}</div>`;
      $('#product-form').onsubmit = async event => {
        event.preventDefault(); const form = new FormData(event.currentTarget), image = form.get('image'); let imageData = null;
        if (image && image.size) { if (image.size > 3 * 1024 * 1024) return toast($('#product-message'), 'Ukuran gambar maksimal 3 MB.', 'error'); imageData = { name: image.name, type: image.type, data: await fileToBase64(image) }; }
        const button = $('button', event.currentTarget); setBusy(button, true, 'Menyimpan…');
        try { await api('admin/products', { method: 'POST', body: JSON.stringify({ name: form.get('name'), price: Number(form.get('price')), category: form.get('category'), description: form.get('description'), delivery_type: form.get('delivery_type'), delivery_value: form.get('delivery_value'), image: imageData }) }); await loadCatalog(); renderAdminPanel(); }
        catch (error) { toast($('#product-message'), error.message, 'error'); setBusy(button, false, 'Simpan produk ＋'); }
      };
      $$('[data-toggle]').forEach(button => button.onclick = async () => { try { await api('admin/products', { method: 'PATCH', body: JSON.stringify({ id: button.dataset.toggle, is_active: button.dataset.active !== 'true' }) }); await renderAdminPanel(); await loadCatalog(); } catch (error) { alert(error.message); } });
      $$('[data-delete]').forEach(button => button.onclick = async () => { if (!confirm('Hapus produk ini? Riwayat pesanan lama tetap disimpan.')) return; try { await api('admin/products', { method: 'DELETE', body: JSON.stringify({ id: button.dataset.delete }) }); await renderAdminPanel(); await loadCatalog(); } catch (error) { alert(error.message); } });
    } else if (adminTab === 'orders') {
      const data = await api('admin/orders');
      panel.innerHTML = `<div class="admin-section-title"><div><span class="eyebrow">TRANSACTIONS</span><h3>Riwayat pesanan</h3></div><span class="count-tag">${data.orders.length} ORDERS</span></div><div class="admin-list">${data.orders.map(order => `<div class="admin-row"><div><b>${esc(order.product_name)}</b><small>${esc(order.order_code)} · ${esc(order.customer_email)} · ${new Date(order.created_at).toLocaleString('id-ID')}</small></div><div class="order-admin-meta"><b>${money(order.total)}</b><small>${esc(order.status)}</small></div></div>`).join('') || '<p class="muted">Belum ada pesanan.</p>'}</div>`;
    } else {
      panel.innerHTML = `<div class="admin-section-title"><div><span class="eyebrow">DATA SAFETY</span><h3>Backup & restore</h3></div></div><p class="admin-copy">Unduh satu arsip ZIP berisi database JSON, stok, riwayat transaksi, dan semua gambar produk. Restore akan mengganti data toko saat ini.</p><div class="notice">Password akun, hash password, SESSION_SECRET, dan API key tidak dimasukkan ke arsip. Akun yang sudah ada tetap dipertahankan saat restore.</div><div class="backup-actions"><button class="button button-primary" id="download-backup">Download backup <span>↓</span></button><label class="button button-secondary" for="restore-file">Pilih file backup <span>↑</span></label><input id="restore-file" type="file" accept=".zip,application/zip" hidden></div><div id="backup-message"></div><p class="small-note">Simpan file backup di tempat pribadi. Jangan mengirimkannya ke orang lain.</p>`;
      $('#download-backup').onclick = async event => { const button = event.currentTarget; setBusy(button, true, 'Menyiapkan arsip…'); try { const response = await fetch('/api/admin/backup', { credentials: 'same-origin' }); if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Backup gagal.'); } const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `nextgen-store-backup-${new Date().toISOString().slice(0, 10)}.zip`; anchor.click(); URL.revokeObjectURL(url); toast($('#backup-message'), 'Backup berhasil diunduh.', 'success'); } catch (error) { toast($('#backup-message'), error.message, 'error'); } finally { setBusy(button, false, 'Download backup ↓'); } };
      $('#restore-file').onchange = async event => { const file = event.target.files[0]; if (!file) return; if (!confirm('Restore akan mengganti seluruh produk, stok, kategori, pesanan, dan gambar saat ini. Akun pengguna tetap dipertahankan. Lanjutkan?')) { event.target.value = ''; return; } const form = new FormData(); form.append('backup', file); try { const response = await fetch('/api/admin/restore', { method: 'POST', body: form, credentials: 'same-origin' }), result = await response.json(); if (!response.ok) throw new Error(result.error || 'Restore gagal.'); toast($('#backup-message'), 'Restore berhasil. Data toko sudah dipulihkan.', 'success'); await loadCatalog(); } catch (error) { toast($('#backup-message'), error.message, 'error'); } event.target.value = ''; };
    }
  } catch (error) { panel.innerHTML = `<div class="notice error">${esc(error.message)}</div>`; }
}
function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }

$('#search').addEventListener('input', renderCatalog);
$('#category-filter').addEventListener('change', renderCatalog);
$('#year').textContent = new Date().getFullYear();
$('#account-logout').addEventListener('click', logout);
$('#admin-open').addEventListener('click', () => { adminTab = 'products'; renderAdmin(); open('admin-dialog'); });
$('#refresh-orders').addEventListener('click', loadMyOrders);
$('#auth-screen').addEventListener('click', event => { if (event.target.closest('[data-auth-mode]')) return; });

(async function boot() {
  renderAuth();
  try { const data = await api('auth/me'); currentUser = data.user; await enterApplication(); }
  catch (_) { /* authentication screen remains visible */ }
})();

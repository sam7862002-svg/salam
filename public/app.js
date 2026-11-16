let parties = [];
let products = [];
let shops = [];
let cart = [];
let currentRole = 'ADMIN';
let currentStaffName = 'Admin';
let currentShopId = 1;
let currentShopName = 'Shop 1 - Main Branch';
let appSettings = {};
let lastCompletedReceipt = null;
let loginInProgress = false;

window.addEventListener('DOMContentLoaded', () => {
  const savedRole = localStorage.getItem('zatca_pos_role');
  const savedName = localStorage.getItem('zatca_pos_name');
  const savedShopId = localStorage.getItem('zatca_pos_shop_id');
  const savedShopName = localStorage.getItem('zatca_pos_shop_name');

  if (savedRole && savedName) {
    currentRole = savedRole;
    currentStaffName = savedName;
    currentShopId = Number(savedShopId || 1);
    currentShopName = savedShopName || 'Shop 1 - Main Branch';

    document.getElementById('roleBadge').innerText = `${currentStaffName} (${currentRole}) | ${currentShopName}`;
    document.getElementById('loginScreen').classList.add('hidden');
    init();
  } else {
    document.getElementById('loginPin').focus();
  }
});

async function doLogin() {
  if (loginInProgress) return;
  const pinInput = document.getElementById('loginPin');
  const pin = pinInput.value;
  if (!pin) return;

  loginInProgress = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (data.error) {
      pinInput.value = '';
      alert('Invalid PIN!');
      pinInput.focus();
      loginInProgress = false;
      return;
    }

    currentRole = data.role;
    currentStaffName = data.staff_name || data.role;
    currentShopId = data.shop_id || 1;
    currentShopName = data.shop_name || 'Shop 1 - Main Branch';

    localStorage.setItem('zatca_pos_role', currentRole);
    localStorage.setItem('zatca_pos_name', currentStaffName);
    localStorage.setItem('zatca_pos_shop_id', currentShopId);
    localStorage.setItem('zatca_pos_shop_name', currentShopName);

    document.getElementById('roleBadge').innerText = `${currentStaffName} (${currentRole}) | ${currentShopName}`;
    document.getElementById('loginScreen').classList.add('hidden');
    await init();
  } finally {
    loginInProgress = false;
  }
}

function explicitLogout() {
  localStorage.removeItem('zatca_pos_role');
  localStorage.removeItem('zatca_pos_name');
  localStorage.removeItem('zatca_pos_shop_id');
  localStorage.removeItem('zatca_pos_shop_name');
  location.reload();
}

async function init() {
  await loadShops();
  await loadSettings();
  await loadParties();
  await loadProducts();
  if (currentRole === 'ADMIN' || currentRole === 'SUPERVISOR') {
    loadStaffUsers();
  }
}

function showTab(tab) {
  document.querySelectorAll('.tab-section').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(`tab-${tab}`);
  if (target) target.classList.remove('hidden');
}

async function loadShops() {
  try {
    const res = await fetch('/api/shops');
    shops = await res.json();
    
    // സെറ്റിംഗ്സ് പേജിലെ Staff Shop Dropdown-ലേക്ക് ഷോപ്പുകൾ ഓട്ടോമാറ്റിക്കായി ലോഡ് ചെയ്യാൻ
    const shopSelect = document.getElementById('newStaffShop');
    if (shopSelect) {
      shopSelect.innerHTML = '';
      shops.forEach(sh => {
        shopSelect.innerHTML += `<option value="${sh.shop_id}">${sh.shop_name_en} (${sh.prefix})</option>`;
      });
    }
  } catch (e) {
    console.error('Error loading shops:', e);
  }
}

async function loadSettings() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  appSettings = data || {};
  if (data.company_name_en) {
    document.getElementById('setCompEn').value = data.company_name_en || '';
    document.getElementById('setCompAr').value = data.company_name_ar || '';
    document.getElementById('setShopPhone').value = data.shop_phone || '';
    document.getElementById('setVat').value = data.vat_number || '';
  }
}

async function saveSettings() {
  const payload = {
    company_name_en: document.getElementById('setCompEn').value,
    company_name_ar: document.getElementById('setCompAr').value,
    shop_phone: document.getElementById('setShopPhone').value,
    vat_number: document.getElementById('setVat').value
  };
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  alert('Settings Saved!');
  loadSettings();
}

async function loadParties() {
  const res = await fetch('/api/parties');
  parties = await res.json();
  const saleSel = document.getElementById('saleParty');
  if (!saleSel) return;
  saleSel.innerHTML = '';
  parties.forEach(p => {
    saleSel.innerHTML += `<option value="${p.party_id}">${p.name_en} (${p.party_type})</option>`;
  });
}

async function loadProducts() {
  const res = await fetch('/api/products');
  products = await res.json();
}

function showLiveSearchDropdown(q, mode) {
  const box = document.getElementById('posSearchDropdown');
  const query = (q || '').trim().toLowerCase();
  if (!query) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const matches = products.filter(p => p.name_en.toLowerCase().includes(query) || (p.barcode && p.barcode.toLowerCase().includes(query))).slice(0, 10);
  if (!matches.length) { box.innerHTML = `<div class="p-2 text-xs">No product found</div>`; box.classList.remove('hidden'); return; }
  box.innerHTML = matches.map(p => `
    <div onclick="selectProduct(${p.product_id})" class="p-2 border-b hover:bg-emerald-50 cursor-pointer flex justify-between text-xs">
      <div><strong>${p.name_en}</strong></div>
      <div class="font-bold text-emerald-700">${p.selling_price} SAR</div>
    </div>
  `).join('');
  box.classList.remove('hidden');
}

function hideDropdowns() {
  document.getElementById('posSearchDropdown')?.classList.add('hidden');
}

function selectProduct(id) {
  hideDropdowns();
  const prod = products.find(p => p.product_id === id);
  if (!prod) return;
  const existing = cart.find(c => c.product_id === prod.product_id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      product_id: prod.product_id,
      name_en: prod.name_en,
      name_ar: prod.name_ar,
      qty: 1,
      unit_price: Number(prod.selling_price),
      vat_rate: Number(prod.vat_rate ?? 15)
    });
  }
  renderCart();
  document.getElementById('posBarcodeInput').value = '';
}

function handleBarcodeScan(code, mode) {
  const clean = (code || '').trim();
  if (!clean) return;
  const prod = products.find(p => (p.barcode && p.barcode.toLowerCase() === clean.toLowerCase()) || p.name_en.toLowerCase() === clean.toLowerCase());
  if (prod) {
    selectProduct(prod.product_id);
  } else {
    alert('Product not found with barcode: ' + clean);
  }
}

function renderCart() {
  const tbody = document.getElementById('cartBody');
  tbody.innerHTML = '';
  let totalIncl = 0, totalBase = 0, totalVat = 0;

  cart.forEach((item, idx) => {
    const lineIncl = item.qty * item.unit_price;
    const lineBase = lineIncl / (1 + item.vat_rate / 100);
    const lineVat = lineIncl - lineBase;
    totalIncl += lineIncl;
    totalBase += lineBase;
    totalVat += lineVat;

    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2"><strong>${item.name_en}</strong></td>
      <td class="p-2"><input type="number" value="${item.qty}" onchange="cart[${idx}].qty=Number(this.value);renderCart()" class="w-16 border p-1 rounded font-bold" /></td>
      <td class="p-2">${item.unit_price}</td>
      <td class="p-2">${item.vat_rate}%</td>
      <td class="p-2 font-bold text-emerald-800">${lineIncl.toFixed(2)}</td>
      <td class="p-2"><button onclick="cart.splice(${idx},1);renderCart()" class="text-red-600 font-bold">X</button></td>
    </tr>`;
  });

  document.getElementById('cartSub').innerText = totalBase.toFixed(2) + ' SAR';
  document.getElementById('cartVat').innerText = totalVat.toFixed(2) + ' SAR';
  document.getElementById('cartTotal').innerText = totalIncl.toFixed(2) + ' SAR';
  calcChange();
}

function calcChange() {
  const total = Number(document.getElementById('cartTotal').innerText.replace(' SAR', '') || 0);
  const tendered = Number(document.getElementById('cashTendered').value || 0);
  const change = tendered > 0 ? (tendered - total) : 0;
  document.getElementById('cashChange').innerText = change.toFixed(2) + ' SAR';
}

async function submitSale() {
  if (!cart.length) return alert('Cart is empty!');
  const payload = {
    party_id: Number(document.getElementById('saleParty').value || 1),
    doc_type: document.getElementById('saleDocType').value,
    original_invoice_ref: document.getElementById('origInvRef')?.value || '',
    return_reason: document.getElementById('returnReason')?.value || '',
    payment_mode: document.getElementById('salePaymentMode').value,
    created_by: currentStaffName,
    shop_id: currentShopId,
    items: cart
  };

  const res = await fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.error) return alert('Error: ' + data.error);

  cart = [];
  renderCart();
  showReceipt(data);
  loadProducts();
}

function showReceipt(data) {
  lastCompletedReceipt = data;
  const { sale, items, company } = data;
  document.getElementById('recCompAr').innerText = company.company_name_ar;
  document.getElementById('recCompEn').innerText = company.company_name_en;
  document.getElementById('recVat').innerText = company.vat_number;
  document.getElementById('recDocType').innerText = `${sale.doc_type} [Branch ID: ${sale.shop_id}]`;
  document.getElementById('recInvNo').innerText = sale.invoice_number;
  document.getElementById('recDate').innerText = new Date(sale.created_at).toLocaleString();
  document.getElementById('recGrand').innerText = sale.grand_total;

  const tbody = document.getElementById('recItems');
  tbody.innerHTML = '';
  items.forEach(i => {
    tbody.innerHTML += `<tr><td>${i.name_en}</td><td>${i.qty}</td><td>${Number(i.line_total).toFixed(2)}</td></tr>`;
  });

  const qrDiv = document.getElementById('qrcode');
  qrDiv.innerHTML = '';
  new QRCode(qrDiv, { text: sale.qr_code_base64, width: 180, height: 180 });
  document.getElementById('receiptModal').classList.remove('hidden');
}

async function loadStaffUsers() {
  const res = await fetch('/api/staff');
  const list = await res.json();
  const tbody = document.getElementById('staffTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  list.forEach(u => {
    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2 font-bold">${u.staff_name}</td>
      <td class="p-2">${u.role}</td>
      <td class="p-2 font-semibold text-emerald-800">${u.shop_name_en || 'Shop 1'}</td>
      <td class="p-2 font-mono">${u.pin}</td>
      <td class="p-2"><button onclick="deleteStaffUser(${u.user_id})" class="text-red-600 font-bold">Del</button></td>
    </tr>`;
  });
}

async function addStaffUser() {
  const payload = {
    staff_name: document.getElementById('newStaffName').value,
    role: document.getElementById('newStaffRole').value,
    shop_id: Number(document.getElementById('newStaffShop').value || 1),
    pin: document.getElementById('newStaffPin').value,
    phone: document.getElementById('newStaffPhone').value || ''
  };
  if (!payload.staff_name || payload.pin.length !== 4) return alert('Enter Name & 4-Digit PIN');
  const res = await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.error) return alert(data.error);
  document.getElementById('newStaffName').value = '';
  document.getElementById('newStaffPin').value = '';
  document.getElementById('newStaffPhone').value = '';
  loadStaffUsers();
  alert('Staff added to selected branch successfully!');
}

async function deleteStaffUser(id) {
  await fetch(`/api/staff/${id}`, { method: 'DELETE' });
  loadStaffUsers();
}

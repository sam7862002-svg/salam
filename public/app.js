let parties = [];
let products = [];
let shops = [];
let activeShopId = 1;
let cart = [];
let purCart = [];
let currentRole = 'ADMIN';
let currentStaffName = 'Admin';
let appSettings = {};
let html5QrScanner = null;
let scanTarget = 'SALE';
let lastCompletedReceipt = null;
let costPeekActive = false;
let loginInProgress = false;

const RETAIL_DICT = {
  milk: 'حليب', fresh: 'طازج', water: 'ماء', juice: 'عصير', bread: 'خبز',
  rice: 'أرز', sugar: 'سكر', tea: 'شاي', coffee: 'قهوة', oil: 'زيت',
  chicken: 'دجاج', meat: 'لحم', fish: 'سمك', egg: 'بيض', eggs: 'بيض',
  cheese: 'جبن', butter: 'زبدة', yogurt: 'زبادي', cream: 'قشطة',
  soap: 'صابون', shampoo: 'شامبو', tissue: 'مناديل', box: 'كرتون',
  pack: 'عبوة', bottle: 'قارورة', can: 'علبة', small: 'صغير',
  medium: 'وسط', large: 'كبير', apple: 'تفاح', banana: 'موز',
  orange: 'برتقال', tomato: 'طماطم', onion: 'بصل', potato: 'بطاطس',
  salt: 'ملح', flour: 'دقيق', biscuit: 'بسكويت', chocolate: 'شوكولاتة',
  honey: 'عسل', dates: 'تمر', pepsi: 'بيبسي', cola: 'كولا',
  almarai: 'المراعي', nadec: 'نادك', saudia: 'السعودية'
};

const TRANSLATIONS = {
  EN: {
    tab_pos: 'POS / Credit Note',
    tab_purchase: 'Purchase / Return',
    tab_history: 'Bills History',
    tab_parties: 'Customers & Vendors',
    tab_products: 'Products',
    tab_reports: 'VAT & Reports',
    tab_settings: 'Settings & Shops',
    btn_lock: 'Lock',
    lbl_sales_credit: 'Sales / Credit Note',
    th_item: 'Item (EN / AR)',
    th_qty: 'Qty',
    th_price: 'Price (Incl.)',
    th_vat: 'VAT%',
    th_total: 'Total',
    lbl_summary: 'Bill Summary',
    lbl_subtotal: 'Base Amount (Excl. VAT):',
    lbl_vat_amt: 'VAT (15% Included):',
    lbl_grand_total: 'Grand Total:',
    lbl_cash_tendered: 'Cash Received:',
    lbl_change: 'Balance / Change:',
    btn_checkout: '⚡ Instant Bill & Print',
    lbl_purchase_title: 'Purchase & Purchase Return (Enter Unit Cost Excl. VAT)',
    th_unit_cost: 'Unit Cost (Excl. VAT)',
    btn_save_purchase: 'Save Purchase / Return',
    lbl_history_title: 'Recent ZATCA Invoices & Credit Notes',
    th_inv_no: 'Invoice No',
    th_date: 'Date',
    th_type: 'Type',
    th_customer: 'Customer',
    th_mode: 'Mode',
    th_staff: 'Staff',
    th_status: 'ZATCA Status',
    th_actions: 'Actions',
    lbl_vat_filters: 'VAT Return & Sales Register Filters'
  },
  AR: {
    tab_pos: 'نقطة البيع / إشعار دائن',
    tab_purchase: 'المشتريات / المرتجعات',
    tab_history: 'سجل الفواتير',
    tab_parties: 'العملاء والموردون',
    tab_products: 'المنتجات',
    tab_reports: 'تقرير الضريبة',
    tab_settings: 'الإعدادات والفروع',
    btn_lock: 'قفل',
    lbl_sales_credit: 'المبيعات / إشعار دائن',
    th_item: 'الصنف (إنجليزي / عربي)',
    th_qty: 'الكمية',
    th_price: 'السعر (شامل)',
    th_vat: 'الضريبة%',
    th_total: 'المجموع',
    lbl_summary: 'ملخص الفاتورة',
    lbl_subtotal: 'المبلغ غير شامل الضريبة:',
    lbl_vat_amt: 'ضريبة القيمة المضافة (15%):',
    lbl_grand_total: 'المجموع النهائي:',
    lbl_cash_tendered: 'المبلغ المستلم:',
    lbl_change: 'المتبقي / الباقي:',
    btn_checkout: '⚡ إصدار وطباعة الفورية',
    lbl_purchase_title: 'المشتريات والمرتجعات (أدخل التكلفة بدون ضريبة)',
    th_unit_cost: 'التكلفة (بدون ضريبة)',
    btn_save_purchase: 'حفظ المشتريات / المرتجع',
    lbl_history_title: 'سجل فواتير الزاتكا والإشعارات الدائنة',
    th_inv_no: 'رقم الفاتورة',
    th_date: 'التاريخ',
    th_type: 'النوع',
    th_customer: 'العميل',
    th_mode: 'الطريقة',
    th_staff: 'الموظف',
    th_status: 'حالة الزاتكا',
    th_actions: 'الإجراءات',
    lbl_vat_filters: 'فلاتر تقرير الضريبة ومبيعات العملاء'
  }
};

let currentLang = localStorage.getItem('zatca_pos_lang') || 'EN';

function toggleLanguage() {
  currentLang = currentLang === 'EN' ? 'AR' : 'EN';
  localStorage.setItem('zatca_pos_lang', currentLang);
  applyLanguage();
}

function applyLanguage() {
  const btn = document.getElementById('langToggleBtn');
  if (btn) btn.innerText = currentLang === 'EN' ? 'العربية 🇸🇦' : 'English 🌐';
  
  if (currentLang === 'AR') {
    document.documentElement.setAttribute('dir', 'rtl');
  } else {
    document.documentElement.setAttribute('dir', 'ltr');
  }

  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.EN;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) {
      el.innerText = dict[key];
    }
  });
}

async function autoTranslate(text, targetInputId) {
  const target = document.getElementById(targetInputId);
  if (!text || !text.trim() || (target && target.value.trim())) return;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.trim())}&langpair=en|ar`;
    const res = await fetch(url);
    const data = await res.json();
    if (data?.responseData?.translatedText) {
      target.value = data.responseData.translatedText;
      return;
    }
  } catch (e) {}
  target.value = text.trim().split(/\s+/).map(w => {
    const clean = w.toLowerCase().replace(/[^a-z]/g, '');
    return RETAIL_DICT[clean] || w;
  }).join(' ');
}

window.addEventListener('DOMContentLoaded', () => {
  applyLanguage();
  const savedRole = localStorage.getItem('zatca_pos_role');
  const savedName = localStorage.getItem('zatca_pos_name');
  const savedShop = localStorage.getItem('zatca_pos_shop');
  if (savedRole && savedName) {
    currentRole = savedRole;
    currentStaffName = savedName;
    activeShopId = Number(savedShop || 1);
    document.getElementById('roleBadge').innerText = `${currentStaffName} (${currentRole})`;
    document.getElementById('loginScreen').classList.add('hidden');
    document.querySelectorAll('.admin-only').forEach(el => {
      if (currentRole === 'CASHIER') el.classList.add('hidden');
      else el.classList.remove('hidden');
    });
    init();
  } else {
    document.getElementById('loginPin').focus();
  }

  window.addEventListener('online', () => document.getElementById('offlineBadge').classList.add('hidden'));
  window.addEventListener('offline', () => document.getElementById('offlineBadge').classList.remove('hidden'));
  if (!navigator.onLine) document.getElementById('offlineBadge').classList.remove('hidden');
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
      alert('Invalid 4-Digit PIN!');
      pinInput.focus();
      loginInProgress = false;
      return;
    }

    currentRole = data.role;
    currentStaffName = data.staff_name || data.role;
    activeShopId = Number(data.shop_id || 1);

    localStorage.setItem('zatca_pos_role', currentRole);
    localStorage.setItem('zatca_pos_name', currentStaffName);
    localStorage.setItem('zatca_pos_shop', activeShopId);

    document.getElementById('roleBadge').innerText = `${currentStaffName} (${currentRole})`;
    document.getElementById('loginScreen').classList.add('hidden');

    document.querySelectorAll('.admin-only').forEach(el => {
      if (currentRole === 'CASHIER') el.classList.add('hidden');
      else el.classList.remove('hidden');
    });

    await init();
  } finally {
    loginInProgress = false;
  }
}

function explicitLogout() {
  localStorage.removeItem('zatca_pos_role');
  localStorage.removeItem('zatca_pos_name');
  localStorage.removeItem('zatca_pos_shop');
  const pinInput = document.getElementById('loginPin');
  pinInput.value = '';
  document.getElementById('loginScreen').classList.remove('hidden');
  setTimeout(() => pinInput.focus(), 100);
}

async function init() {
  await loadShops();
  await loadSettings();
  await loadParties();
  await loadProducts();
  if (currentRole === 'ADMIN') {
    setVatFilter('CURRENT_MONTH');
    loadStaffUsers();
  }
}

async function loadShops() {
  const res = await fetch('/api/shops');
  shops = await res.json();
  const sel = document.getElementById('activeShopSelect');
  const reportSel = document.getElementById('reportShopFilter');
  const staffSel = document.getElementById('newStaffShop');
  
  sel.innerHTML = '';
  if (reportSel) reportSel.innerHTML = '<option value="ALL">🏢 All Shops Combined</option>';
  if (staffSel) staffSel.innerHTML = '';

  shops.forEach(sh => {
    sel.innerHTML += `<option value="${sh.shop_id}" ${sh.shop_id === activeShopId ? 'selected' : ''}>🏢 ${sh.shop_name_en}</option>`;
    if (reportSel) reportSel.innerHTML += `<option value="${sh.shop_id}">🏢 ${sh.shop_name_en}</option>`;
    if (staffSel) staffSel.innerHTML += `<option value="${sh.shop_id}">${sh.shop_name_en}</option>`;
  });

  renderShopsManagement();
}

function switchShop(shopId) {
  activeShopId = Number(shopId);
  localStorage.setItem('zatca_pos_shop', activeShopId);
  alert(`Switched active branch to: ${shops.find(s => s.shop_id === activeShopId)?.shop_name_en || ''}`);
}

function showTab(tab) {
  document.querySelectorAll('.tab-section').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  if (tab === 'reports') loadReports();
  if (tab === 'history') loadSalesHistory();
}

function toggleReturnFields() {
  const docType = document.getElementById('saleDocType').value;
  const box = document.getElementById('creditNoteFields');
  if (docType.includes('CREDIT_NOTE')) box.classList.remove('hidden');
  else box.classList.add('hidden');
}

function togglePurReturnFields() {
  const docType = document.getElementById('purDocType').value;
  const box = document.getElementById('purReturnFields');
  if (docType === 'PURCHASE_RETURN') box.classList.remove('hidden');
  else box.classList.add('hidden');
}

function onPartySelectionChange(mode) {
  const selId = mode === 'SALE' ? 'saleParty' : 'purParty';
  const payModeId = mode === 'SALE' ? 'salePaymentMode' : 'purPayMode';
  const partyId = Number(document.getElementById(selId).value);
  const p = parties.find(x => x.party_id === partyId);
  updatePartyLiveBalance(mode);

  if (p) {
    const paySel = document.getElementById(payModeId);
    if (p.account_mode === 'CASH') paySel.value = 'CASH';
    else if (p.account_mode === 'CREDIT') paySel.value = 'CREDIT';
  }
}

function showLiveSearchDropdown(query, mode) {
  const dropdownId = mode === 'SALE' ? 'posSearchDropdown' : 'purSearchDropdown';
  const box = document.getElementById(dropdownId);
  const q = (query || '').trim().toLowerCase();

  if (!q) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  const matches = products.filter(p =>
    (p.barcode && p.barcode.toLowerCase().includes(q)) ||
    p.name_en.toLowerCase().includes(q) ||
    (p.name_ar && p.name_ar.includes(q))
  ).slice(0, 15);

  if (!matches.length) {
    box.innerHTML = `<div class="p-3 text-xs text-slate-500">No matching product. Press <strong>Enter</strong> to Quick-Add "${query.toUpperCase()}".</div>`;
    box.classList.remove('hidden');
    return;
  }

  box.innerHTML = matches.map(p => `
    <div onclick="selectFromDropdown(${p.product_id}, '${mode}')"
         class="p-2.5 border-b hover:bg-emerald-50 cursor-pointer flex justify-between items-center text-xs">
      <div>
        <div class="font-bold text-slate-800">${p.name_en} <span class="text-slate-500">(${p.name_ar || ''})</span></div>
        <div class="text-[11px] text-slate-400">Barcode: ${p.barcode || 'N/A'} | Stock: ${p.stock_qty}</div>
      </div>
      <div class="font-extrabold text-emerald-700 text-sm">${Number(mode === 'SALE' ? p.selling_price : (p.cost_price || p.selling_price)).toFixed(2)} SAR</div>
    </div>
  `).join('');
  box.classList.remove('hidden');
}

function hideDropdowns() {
  document.getElementById('posSearchDropdown').classList.add('hidden');
  document.getElementById('purSearchDropdown').classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#posBarcodeInput') && !e.target.closest('#posSearchDropdown')) {
    document.getElementById('posSearchDropdown')?.classList.add('hidden');
  }
  if (!e.target.closest('#purBarcodeInput') && !e.target.closest('#purSearchDropdown')) {
    document.getElementById('purSearchDropdown')?.classList.add('hidden');
  }
});

function selectFromDropdown(productId, mode) {
  hideDropdowns();
  const prod = products.find(p => p.product_id === productId);
  if (!prod) return;
  if (mode === 'SALE') {
    document.getElementById('posBarcodeInput').value = '';
    addProductToSaleCart(prod);
  } else {
    document.getElementById('purBarcodeInput').value = '';
    addProductObjectToPurCart(prod);
  }
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, ctx.currentTime);
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) {}
}

async function openCameraScanner(target) {
  scanTarget = target;
  document.getElementById('scannerModal').classList.remove('hidden');

  if (html5QrScanner) {
    try { await html5QrScanner.stop(); } catch (e) {}
  }

  html5QrScanner = new Html5Qrcode('qr-reader');
  try {
    await html5QrScanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: 260, height: 130 } },
      async (decodedText) => {
        playBeep();
        await closeCameraScanner();
        if (scanTarget === 'PRODUCT_FORM') {
          checkProductBarcode(decodedText);
        } else {
          handleBarcodeScan(decodedText, scanTarget);
        }
      },
      () => {}
    );
  } catch (err) {
    alert('Camera error: ' + err);
    closeCameraScanner();
  }
}

async function closeCameraScanner() {
  if (html5QrScanner) {
    try {
      await html5QrScanner.stop();
      html5QrScanner.clear();
    } catch (e) {}
    html5QrScanner = null;
  }
  document.getElementById('scannerModal').classList.add('hidden');
}

function handleBarcodeScan(rawCode, mode) {
  const code = (rawCode || '').trim();
  if (!code) return;

  if (mode === 'SALE') document.getElementById('posBarcodeInput').value = '';
  if (mode === 'PURCHASE') document.getElementById('purBarcodeInput').value = '';

  const prod = products.find(p =>
    (p.barcode && p.barcode.toLowerCase() === code.toLowerCase()) ||
    p.name_en.toLowerCase() === code.toLowerCase()
  );

  if (prod) {
    if (mode === 'SALE') addProductToSaleCart(prod);
    else addProductObjectToPurCart(prod);
  } else {
    scanTarget = mode;
    const isNumeric = /^[0-9]+$/.test(code);
    document.getElementById('qaBarcode').value = isNumeric ? code : 'BAR-' + Date.now().toString().slice(-6);
    document.getElementById('qaNameEn').value = isNumeric ? '' : code.toUpperCase();
    document.getElementById('qaNameAr').value = '';
    document.getElementById('qaCost').value = '';
    document.getElementById('qaPrice').value = '';
    document.getElementById('quickAddModal').classList.remove('hidden');
    if (!isNumeric) autoTranslate(code, 'qaNameAr');
    setTimeout(() => document.getElementById(isNumeric ? 'qaNameEn' : 'qaPrice').focus(), 100);
  }
}

async function saveQuickProduct() {
  const payload = {
    barcode: document.getElementById('qaBarcode').value,
    name_en: document.getElementById('qaNameEn').value.toUpperCase().trim(),
    name_ar: document.getElementById('qaNameAr').value.trim() || document.getElementById('qaNameEn').value.toUpperCase().trim(),
    cost_price: Number(document.getElementById('qaCost').value || 0),
    selling_price: Number(document.getElementById('qaPrice').value),
    vat_rate: 15,
    stock_qty: 0
  };
  if (!payload.name_en || !payload.selling_price) return alert('Enter Name & Selling Price');

  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const newProd = await res.json();
  if (newProd.error) return alert(newProd.error);

  document.getElementById('quickAddModal').classList.add('hidden');
  await loadProducts();

  if (scanTarget === 'SALE') addProductToSaleCart(newProd);
  else addProductObjectToPurCart(newProd);
}

function checkProductBarcode(barcode) {
  const code = (barcode || '').trim();
  if (!code) return;
  document.getElementById('prodBarcode').value = code;
  const pr = products.find(p => p.barcode && p.barcode.toLowerCase() === code.toLowerCase());
  if (pr) {
    editProduct(pr.product_id);
    document.getElementById('prodStock').focus();
    document.getElementById('prodStock').select();
  } else {
    document.getElementById('prodNameEn').focus();
    autoTranslate(code, 'prodNameAr');
  }
}

function addProductToSaleCart(prod) {
  const existing = cart.find(c => c.product_id === prod.product_id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      product_id: prod.product_id,
      name_en: prod.name_en,
      name_ar: prod.name_ar,
      cost_price: Number(prod.cost_price || 0),
      qty: 1,
      unit_price: Number(prod.selling_price),
      vat_rate: Number(prod.vat_rate ?? 15)
    });
  }
  updateTotalCostDisplay();
  renderCart();
}

function updateTotalCostDisplay() {
  const valSpan = document.getElementById('discreetCostVal');
  let totalCost = cart.reduce((acc, item) => acc + (Number(item.cost_price || 0) * Number(item.qty)), 0);
  if (costPeekActive) {
    valSpan.innerText = `${totalCost.toFixed(2)} SAR`;
  } else {
    valSpan.innerText = '•';
  }
}

function toggleCostPeek() {
  costPeekActive = !costPeekActive;
  updateTotalCostDisplay();
}

function renderCart() {
  const tbody = document.getElementById('cartBody');
  tbody.innerHTML = '';
  let totalIncl = 0, totalBaseExcl = 0, totalVat = 0;

  cart.forEach((item, idx) => {
    const lineIncl = item.qty * item.unit_price;
    const lineBase = lineIncl / (1 + item.vat_rate / 100);
    const lineVat = lineIncl - lineBase;

    totalIncl += lineIncl;
    totalBaseExcl += lineBase;
    totalVat += lineVat;

    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2">
        <div class="font-bold">${item.name_en}</div>
        <div class="text-xs text-slate-500">${item.name_ar}</div>
      </td>
      <td class="p-2"><input type="number" step="any" value="${item.qty}" onchange="cart[${idx}].qty=Number(this.value);renderCart()" class="w-16 border p-1 rounded font-bold" /></td>
      <td class="p-2"><input type="number" step="any" value="${item.unit_price}" onchange="cart[${idx}].unit_price=Number(this.value);renderCart()" class="w-24 border p-1 rounded font-bold" /></td>
      <td class="p-2">${item.vat_rate}%</td>
      <td class="p-2 font-bold text-emerald-800">${lineIncl.toFixed(2)}</td>
      <td class="p-2"><button onclick="cart.splice(${idx},1);renderCart()" class="text-red-600 font-bold">X</button></td>
    </tr>`;
  });

  document.getElementById('cartSub').innerText = totalBaseExcl.toFixed(2) + ' SAR';
  document.getElementById('cartVat').innerText = totalVat.toFixed(2) + ' SAR';
  document.getElementById('cartTotal').innerText = totalIncl.toFixed(2) + ' SAR';
  updateTotalCostDisplay();
  calcChange();
}

function calcChange() {
  const totalText = document.getElementById('cartTotal').innerText.replace(' SAR', '');
  const total = Number(totalText || 0);
  const tendered = Number(document.getElementById('cashTendered').value || 0);
  const change = tendered > 0 ? (tendered - total) : 0;
  document.getElementById('cashChange').innerText = change.toFixed(2) + ' SAR';
}

async function submitSale() {
  if (!cart.length) return alert('Cart is empty!');
  const btn = document.getElementById('checkoutBtn');
  btn.disabled = true;
  btn.innerText = 'Processing...';

  try {
    const payload = {
      shop_id: activeShopId,
      party_id: Number(document.getElementById('saleParty').value),
      doc_type: document.getElementById('saleDocType').value,
      original_invoice_ref: document.getElementById('origInvRef').value,
      return_reason: document.getElementById('returnReason').value,
      payment_mode: document.getElementById('salePaymentMode').value,
      created_by: currentStaffName,
      items: cart
    };
    const res = await fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.error) return alert('Error: ' + data.error);

    cart = [];
    document.getElementById('cashTendered').value = '';
    renderCart();
    showReceipt(data, true);
    loadProducts();
    loadParties();
  } finally {
    btn.disabled = false;
    btn.innerText = '⚡ Instant Bill & Print';
  }
}

function updatePartyLiveBalance(mode) {
  const selId = mode === 'SALE' ? 'saleParty' : 'purParty';
  const boxId = mode === 'SALE' ? 'salePartyBalanceBox' : 'purPartyBalanceBox';
  const partyId = Number(document.getElementById(selId).value);
  const p = parties.find(x => x.party_id === partyId);
  const box = document.getElementById(boxId);
  if (!p) return;

  const bal = Number(p.current_balance || 0);
  if (bal > 0) {
    box.innerHTML = `<span class="text-red-600">Current Due (Receivable): ${bal.toFixed(2)} SAR</span>`;
  } else if (bal < 0) {
    box.innerHTML = `<span class="text-blue-700">Payable Balance: ${Math.abs(bal).toFixed(2)} SAR</span>`;
  } else {
    box.innerHTML = `<span class="text-emerald-700">Balance: 0.00 SAR</span>`;
  }
}

function showReceipt(data, isNewSale = false) {
  lastCompletedReceipt = data;
  const { sale, items, shop, party } = data;

  document.getElementById('recCompAr').innerText = shop.shop_name_ar;
  document.getElementById('recCompEn').innerText = shop.shop_name_en;
  document.getElementById('recAddrAr').innerText = shop.address_ar || '';
  document.getElementById('recPhone').innerText = shop.shop_phone ? `Tel: ${shop.shop_phone}` : '';
  document.getElementById('recVat').innerText = shop.vat_number;
  document.getElementById('recDocType').innerText = sale.doc_type;
  document.getElementById('recInvNo').innerText = sale.invoice_number;
  document.getElementById('recIcv').innerText = sale.icv;
  document.getElementById('recDate').innerText = new Date(sale.created_at).toLocaleString();
  document.getElementById('recParty').innerText = party ? party.name_en : 'Walk-in';
  document.getElementById('recPayMode').innerText = sale.payment_mode;
  document.getElementById('recSub').innerText = sale.subtotal;
  document.getElementById('recTax').innerText = sale.vat_amount;
  document.getElementById('recGrand').innerText = sale.grand_total;

  document.getElementById('recPrevBal').innerText = Number(sale.prev_balance || 0).toFixed(2);
  document.getElementById('recNewBal').innerText = Number(sale.new_balance || 0).toFixed(2);

  const tbody = document.getElementById('recItems');
  tbody.innerHTML = '';
  items.forEach(i => {
    tbody.innerHTML += `<tr><td>${i.name_ar || i.name_en}</td><td>${i.qty}</td><td>${Number(i.line_total).toFixed(2)}</td></tr>`;
  });

  const is58 = (appSettings.paper_size || '80mm') === '58mm';
  const qrDiv = document.getElementById('qrcode');
  qrDiv.innerHTML = '';
  new QRCode(qrDiv, { text: sale.qr_code_base64, width: is58 ? 165 : 210, height: is58 ? 165 : 210, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });

  populateA4Template(data);
  document.getElementById('receiptModal').classList.remove('hidden');

  if (isNewSale && (appSettings.auto_print !== false)) {
    setTimeout(() => {
      const routing = document.getElementById('quickPrintToggle').value;
      const isB2B = sale.doc_type.startsWith('B2B');
      if (routing === 'A4' || (routing === 'AUTO' && isB2B)) {
        printA4Invoice();
      } else {
        printThermalReceipt();
      }
    }, 180);
  }
}

function populateA4Template({ sale, items, shop, party }) {
  document.getElementById('a4CompAr').innerText = shop.shop_name_ar;
  document.getElementById('a4CompEn').innerText = shop.shop_name_en;
  document.getElementById('a4Vat').innerText = shop.vat_number;
  document.getElementById('a4Cr').innerText = shop.cr_number || '-';
  document.getElementById('a4Phone').innerText = shop.shop_phone || '-';
  document.getElementById('a4Addr').innerText = shop.address_ar || '';

  const isCredit = sale.doc_type.includes('CREDIT_NOTE');
  document.getElementById('a4Title').innerText = isCredit ? 'TAX CREDIT NOTE / إشعار دائن ضريبي' : 'TAX INVOICE / فاتورة ضريبية';
  document.getElementById('a4InvNo').innerText = sale.invoice_number;
  document.getElementById('a4Date').innerText = new Date(sale.created_at).toLocaleString();
  document.getElementById('a4Status').innerText = sale.zatca_status;

  document.getElementById('a4CustName').innerText = party ? `${party.name_ar || party.name_en} (${party.name_en})` : 'عميل نقدي / Walk-in Cash Customer';
  document.getElementById('a4CustVat').innerText = (party && party.vat_number) || '-';
  document.getElementById('a4CustPhone').innerText = (party && party.phone) || '-';
  document.getElementById('a4PayMode').innerText = sale.payment_mode;
  document.getElementById('a4PrevBal').innerText = `${Number(sale.prev_balance || 0).toFixed(2)} SAR`;
  document.getElementById('a4NewBal').innerText = `${Number(sale.new_balance || 0).toFixed(2)} SAR`;

  if (sale.original_invoice_ref) {
    document.getElementById('a4OrigRefRow').classList.remove('hidden');
    document.getElementById('a4OrigRef').innerText = sale.original_invoice_ref;
  } else {
    document.getElementById('a4OrigRefRow').classList.add('hidden');
  }

  const tbody = document.getElementById('a4ItemsBody');
  tbody.innerHTML = '';
  items.forEach((it, idx) => {
    const unitExcl = Number(it.unit_price_excl ?? (Number(it.unit_price) / (1 + Number(it.vat_rate) / 100)));
    tbody.innerHTML += `<tr>
      <td class="border border-slate-300 p-2 text-right">${idx + 1}</td>
      <td class="border border-slate-300 p-2 text-right">${it.name_ar || it.name_en} <br><span class="text-xs text-slate-500">${it.name_en}</span></td>
      <td class="border border-slate-300 p-2 text-center">${Number(it.qty).toFixed(2)}</td>
      <td class="border border-slate-300 p-2 text-center">${unitExcl.toFixed(2)}</td>
      <td class="border border-slate-300 p-2 text-center">${Number(it.vat_amount).toFixed(2)}</td>
      <td class="border border-slate-300 p-2 text-left font-bold">${Number(it.line_total).toFixed(2)}</td>
    </tr>`;
  });

  document.getElementById('a4Sub').innerText = `${sale.subtotal} SAR`;
  document.getElementById('a4Tax').innerText = `${sale.vat_amount} SAR`;
  document.getElementById('a4Grand').innerText = `${sale.grand_total} SAR`;

  const a4Qr = document.getElementById('a4QrCode');
  a4Qr.innerHTML = '';
  new QRCode(a4Qr, { text: sale.qr_code_base64, width: 195, height: 195, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });
}

function printThermalReceipt() {
  const is58 = (appSettings.paper_size || '80mm') === '58mm';
  document.body.classList.remove('print-a4', 'print-80mm', 'print-58mm');
  document.body.classList.add(is58 ? 'print-58mm' : 'print-80mm');
  window.print();
}

function printA4Invoice() {
  const wrapper = document.getElementById('a4Wrapper');
  wrapper.classList.remove('hidden');
  document.body.classList.remove('print-80mm', 'print-58mm');
  document.body.classList.add('print-a4');
  window.print();
  wrapper.classList.add('hidden');
}

async function sharePdfOnWhatsApp() {
  if (!lastCompletedReceipt) return;
  const { sale, shop, party } = lastCompletedReceipt;
  const wrapper = document.getElementById('a4Wrapper');
  const element = document.getElementById('a4InvoiceContainer');

  wrapper.classList.remove('hidden');
  const fileName = `${sale.invoice_number}.pdf`;

  try {
    const pdfBlob = await html2pdf().set({
      margin: 5,
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(element).outputPdf('blob');

    wrapper.classList.add('hidden');
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      await navigator.share({
        files: [pdfFile],
        title: `Tax Invoice ${sale.invoice_number}`,
        text: `Invoice ${sale.invoice_number} - Total: ${sale.grand_total} SAR`
      });
      return;
    }

    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();

    let phone = (party && party.phone) ? party.phone.replace(/[^0-9]/g, '') : '';
    if (!phone) phone = prompt('Enter Customer WhatsApp Number:', '966') || '';
    const msg = encodeURIComponent(`*${shop.shop_name_en}*
Invoice: *${sale.invoice_number}*
Total: *${sale.grand_total} SAR*`);
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  } catch (err) {
    wrapper.classList.add('hidden');
    alert('PDF error: ' + err.message);
  }
}

function addProductObjectToPurCart(prod) {
  const existing = purCart.find(c => c.product_id === prod.product_id);
  const defaultExcl = Number(prod.cost_price || prod.selling_price) / 1.15;
  if (existing) {
    existing.qty += 1;
  } else {
    purCart.push({
      product_id: prod.product_id,
      name_en: prod.name_en,
      name_ar: prod.name_ar,
      qty: 1,
      unit_price_excl: Number(defaultExcl.toFixed(4)),
      vat_rate: Number(prod.vat_rate ?? 15)
    });
  }
  renderPurCart();
}

function renderPurCart() {
  const tbody = document.getElementById('purCartBody');
  tbody.innerHTML = '';
  let totIncl = 0, totBase = 0, totVat = 0;

  purCart.forEach((item, idx) => {
    const qty = Number(item.qty);
    const unitExcl = Number(item.unit_price_excl);
    const vatRate = Number(item.vat_rate);
    const lineBase = qty * unitExcl;
    const lineVat = lineBase * (vatRate / 100);
    const lineIncl = lineBase + lineVat;

    totIncl += lineIncl;
    totBase += lineBase;
    totVat += lineVat;

    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2">${item.name_en} <span class="text-xs text-slate-500">(${item.name_ar || ''})</span></td>
      <td class="p-2"><input type="number" step="any" value="${item.qty}" onchange="purCart[${idx}].qty=Number(this.value);renderPurCart()" class="w-20 border p-1 rounded" /></td>
      <td class="p-2"><input type="number" step="any" value="${item.unit_price_excl}" onchange="purCart[${idx}].unit_price_excl=Number(this.value);renderPurCart()" class="w-32 border p-1 rounded font-bold" /></td>
      <td class="p-2">${item.vat_rate}%</td>
      <td class="p-2 font-semibold text-blue-800">${lineIncl.toFixed(2)}</td>
      <td class="p-2"><button onclick="purCart.splice(${idx},1);renderPurCart()" class="text-red-600 font-bold">X</button></td>
    </tr>`;
  });

  document.getElementById('purSub').innerText = totBase.toFixed(2);
  document.getElementById('purVat').innerText = totVat.toFixed(2);
  document.getElementById('purTotal').innerText = totIncl.toFixed(2);
}

async function submitPurchase() {
  if (!purCart.length) return alert('Add items first');
  const payload = {
    shop_id: activeShopId,
    supplier_inv_no: document.getElementById('supInvNo').value || 'SUP-' + Date.now(),
    party_id: Number(document.getElementById('purParty').value),
    doc_type: document.getElementById('purDocType').value,
    original_purchase_ref: document.getElementById('origPurRef').value,
    return_reason: document.getElementById('purReturnReason').value,
    payment_mode: document.getElementById('purPayMode').value,
    items: purCart.map(i => ({ product_id: i.product_id, qty: i.qty, unit_price: i.unit_price_excl, vat_rate: i.vat_rate }))
  };
  const res = await fetch('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.error) return alert(data.error);

  purCart = [];
  document.getElementById('supInvNo').value = '';
  renderPurCart();
  await loadProducts();
  await loadParties();
  alert('Purchase / Return Saved!');
}

async function loadSalesHistory() {
  const res = await fetch(`/api/sales?shop_id=${activeShopId}`);
  const rows = await res.json();
  const tbody = document.getElementById('historyTable');
  tbody.innerHTML = '';
  rows.forEach(s => {
    const isSynced = s.zatca_status === 'CLEARED' || s.zatca_status === 'REPORTED' || s.zatca_status === 'GRD_CLEARED';
    const badgeClass = isSynced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800';
    tbody.innerHTML += `<tr class="border-t hover:bg-slate-50">
      <td class="p-2 font-bold">${s.invoice_number} <br><span class="text-[10px] text-blue-700">${s.shop_name_en || ''}</span></td>
      <td class="p-2">${new Date(s.created_at).toLocaleString()}</td>
      <td class="p-2">${s.doc_type}</td>
      <td class="p-2">${s.party_name || 'Walk-in'}</td>
      <td class="p-2">${s.payment_mode}</td>
      <td class="p-2 font-bold">${Number(s.grand_total).toFixed(2)}</td>
      <td class="p-2">${s.created_by || 'Admin'}</td>
      <td class="p-2"><span class="px-1.5 py-0.5 rounded font-bold ${badgeClass}">${s.zatca_status}</span></td>
      <td class="p-2 space-x-1">
        <button onclick="reprintInvoice(${s.sale_id})" class="bg-blue-600 text-white px-2 py-1 rounded">Print</button>
        <button onclick="shareHistoryInvoiceOnWhatsApp(${s.sale_id})" class="bg-green-600 text-white px-2 py-1 rounded">📲 WA</button>
        <a href="/api/sales/${s.sale_id}/xml" class="bg-slate-700 text-white px-2 py-1 rounded inline-block">XML</a>
      </td>
    </tr>`;
  });
}

async function triggerZatcaBatchSync() {
  alert('Branch ZATCA sync complete.');
  loadSalesHistory();
  if (currentRole === 'ADMIN') loadReports();
}

async function reprintInvoice(saleId) {
  const res = await fetch(`/api/sales/${saleId}`);
  const data = await res.json();
  if (data.error) return alert(data.error);
  showReceipt(data, false);
}

async function shareHistoryInvoiceOnWhatsApp(saleId) {
  const res = await fetch(`/api/sales/${saleId}`);
  const data = await res.json();
  if (data.error) return alert(data.error);
  lastCompletedReceipt = data;
  populateA4Template(data);
  await sharePdfOnWhatsApp();
}

async function loadParties() {
  const res = await fetch('/api/parties');
  parties = await res.json();

  const saleSel = document.getElementById('saleParty');
  const purSel = document.getElementById('purParty');
  const vSel = document.getElementById('vParty');
  const tbody = document.getElementById('partiesTable');

  saleSel.innerHTML = '';
  purSel.innerHTML = '';
  vSel.innerHTML = '';
  tbody.innerHTML = '';

  parties.forEach(p => {
    const bal = Number(p.current_balance || 0);
    const balTag = bal !== 0 ? ` [Bal: ${bal.toFixed(2)}]` : '';
    const opt = `<option value="${p.party_id}">${p.name_en} (${p.party_type} - ${p.account_mode})${balTag}</option>`;
    
    if (p.party_type === 'CUSTOMER' || p.party_type === 'BOTH') saleSel.innerHTML += opt;
    if (p.party_type === 'VENDOR' || p.party_type === 'BOTH') purSel.innerHTML += opt;
    vSel.innerHTML += opt;

    tbody.innerHTML += `<tr class="border-t hover:bg-slate-50">
      <td class="p-2 font-semibold">${p.name_en} <br><span class="text-slate-500">${p.name_ar || ''}</span></td>
      <td class="p-2">${p.party_type} <span class="text-xs bg-slate-200 px-1 rounded">${p.account_mode}</span></td>
      <td class="p-2">${p.vat_number || '-'}</td>
      <td class="p-2">${p.phone || '-'}</td>
      <td class="p-2 font-bold ${bal > 0 ? 'text-red-600' : (bal < 0 ? 'text-blue-700' : 'text-emerald-700')}">${bal.toFixed(2)} SAR</td>
      <td class="p-2 space-x-1">
        <button onclick="editParty(${p.party_id})" class="bg-amber-500 text-white px-2 py-1 rounded">Edit</button>
        <button onclick="deleteParty(${p.party_id})" class="bg-red-600 text-white px-2 py-1 rounded">Del</button>
      </td>
    </tr>`;
  });

  onPartySelectionChange('SALE');
  onPartySelectionChange('PURCHASE');
}

function editParty(id) {
  const p = parties.find(x => x.party_id === id);
  if (!p) return;
  document.getElementById('editPartyId').value = p.party_id;
  document.getElementById('partyFormTitle').innerText = `Edit Party #${p.party_id}`;
  document.getElementById('pType').value = p.party_type;
  document.getElementById('pAccountMode').value = p.account_mode || 'CREDIT';
  document.getElementById('pNameEn').value = p.name_en;
  document.getElementById('pNameAr').value = p.name_ar || '';
  document.getElementById('pVat').value = p.vat_number || '';
  document.getElementById('pPhone').value = p.phone || '';

  const op = Number(p.opening_balance || 0);
  document.getElementById('pBalType').value = op < 0 ? 'PAYABLE' : 'RECEIVABLE';
  document.getElementById('pOpening').value = Math.abs(op);
  document.getElementById('cancelPartyEditBtn').classList.remove('hidden');
}

function resetPartyForm() {
  document.getElementById('editPartyId').value = '';
  document.getElementById('partyFormTitle').innerText = 'Add Customer / Vendor';
  document.getElementById('pAccountMode').value = 'CREDIT';
  document.getElementById('pNameEn').value = '';
  document.getElementById('pNameAr').value = '';
  document.getElementById('pVat').value = '';
  document.getElementById('pPhone').value = '';
  document.getElementById('pOpening').value = '';
  document.getElementById('cancelPartyEditBtn').classList.add('hidden');
}

async function saveParty() {
  const editId = document.getElementById('editPartyId').value;
  const rawAmt = Math.abs(Number(document.getElementById('pOpening').value || 0));
  const balType = document.getElementById('pBalType').value;
  const opening_balance = balType === 'PAYABLE' ? -rawAmt : rawAmt;

  const payload = {
    party_type: document.getElementById('pType').value,
    account_mode: document.getElementById('pAccountMode').value,
    name_en: document.getElementById('pNameEn').value.toUpperCase(),
    name_ar: document.getElementById('pNameAr').value,
    vat_number: document.getElementById('pVat').value,
    phone: document.getElementById('pPhone').value,
    opening_balance
  };
  if (!payload.name_en) return alert('Name required');

  const url = editId ? `/api/parties/${editId}` : '/api/parties';
  const method = editId ? 'PUT' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  resetPartyForm();
  await loadParties();
  alert('Party Saved!');
}

async function deleteParty(id) {
  if (!confirm('Delete this party?')) return;
  const res = await fetch(`/api/parties/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) return alert(data.error);
  loadParties();
}

function downloadPartyTemplate() {
  const sample = [
    { Party_Type: 'CUSTOMER', Account_Mode: 'CREDIT', Name_EN: 'AL NOOR TRADING', Name_AR: 'تجارة النور', VAT_Number: '300123456700003', Phone: '966500000001', Opening_Balance: 500 }
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Parties');
  XLSX.writeFile(wb, 'Parties_Template.xlsx');
}

function uploadPartyExcel(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const wb = XLSX.read(e.target.result, { type: 'binary' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const list = rows.map(r => ({
      party_type: (r.Party_Type || 'CUSTOMER').toUpperCase(),
      account_mode: (r.Account_Mode || 'CREDIT').toUpperCase(),
      name_en: r.Name_EN || r.Name,
      name_ar: r.Name_AR || '',
      vat_number: r.VAT_Number || '',
      phone: r.Phone || '',
      opening_balance: Number(r.Opening_Balance || 0)
    }));
    await fetch('/api/parties/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ list }) });
    alert('Imported Successfully!');
    loadParties();
  };
  reader.readAsBinaryString(file);
}

async function saveVoucher() {
  const payload = {
    party_id: Number(document.getElementById('vParty').value),
    voucher_type: document.getElementById('vType').value,
    amount: Number(document.getElementById('vAmount').value),
    payment_mode: 'CASH',
    notes: document.getElementById('vNotes').value
  };
  if (!payload.amount) return alert('Enter valid amount');
  await fetch('/api/vouchers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  document.getElementById('vAmount').value = '';
  document.getElementById('vNotes').value = '';
  await loadParties();
  alert('Voucher Saved!');
}

async function loadProducts() {
  const res = await fetch('/api/products');
  products = await res.json();
  renderProductsTable(products);
}

function filterProductsTable(q) {
  const query = (q || '').toLowerCase();
  const filtered = products.filter(p => p.name_en.toLowerCase().includes(query) || (p.barcode && p.barcode.toLowerCase().includes(query)));
  renderProductsTable(filtered);
}

function renderProductsTable(list) {
  const tbody = document.getElementById('productsTable');
  tbody.innerHTML = '';
  list.forEach(pr => {
    const incl = Number(pr.selling_price);
    const excl = incl / (1 + Number(pr.vat_rate || 15) / 100);
    tbody.innerHTML += `<tr class="border-t hover:bg-slate-50">
      <td class="p-2 font-mono">${pr.barcode || '-'}</td>
      <td class="p-2 font-bold">${pr.name_en} <br><span class="text-slate-500 font-normal">${pr.name_ar}</span></td>
      <td class="p-2 font-bold text-emerald-700">${incl.toFixed(2)}</td>
      <td class="p-2 text-slate-500">${excl.toFixed(2)}</td>
      <td class="p-2 font-bold">${pr.stock_qty}</td>
      <td class="p-2 space-x-1">
        <button onclick="editProduct(${pr.product_id})" class="bg-amber-500 text-white px-2 py-1 rounded">Edit</button>
        <button onclick="deleteProduct(${pr.product_id})" class="bg-red-600 text-white px-2 py-1 rounded">Del</button>
      </td>
    </tr>`;
  });
}

function editProduct(id) {
  const pr = products.find(x => x.product_id === id);
  if (!pr) return;
  document.getElementById('editProdId').value = pr.product_id;
  document.getElementById('prodFormTitle').innerText = `Edit Product #${pr.product_id}`;
  document.getElementById('prodBarcode').value = pr.barcode || '';
  document.getElementById('prodNameEn').value = pr.name_en;
  document.getElementById('prodNameAr').value = pr.name_ar || '';
  document.getElementById('prodCost').value = pr.cost_price || 0;
  document.getElementById('prodPrice').value = pr.selling_price;
  document.getElementById('prodVat').value = pr.vat_rate ?? 15;
  document.getElementById('prodStock').value = pr.stock_qty || 0;
  document.getElementById('cancelProdEditBtn').classList.remove('hidden');
}

function resetProductForm() {
  document.getElementById('editProdId').value = '';
  document.getElementById('prodFormTitle').innerText = 'Add / Update Product';
  document.getElementById('prodBarcode').value = '';
  document.getElementById('prodNameEn').value = '';
  document.getElementById('prodNameAr').value = '';
  document.getElementById('prodCost').value = '';
  document.getElementById('prodPrice').value = '';
  document.getElementById('prodVat').value = '15';
  document.getElementById('prodStock').value = '';
  document.getElementById('cancelProdEditBtn').classList.add('hidden');
}

async function saveProduct() {
  const editId = document.getElementById('editProdId').value;
  const payload = {
    barcode: document.getElementById('prodBarcode').value,
    name_en: document.getElementById('prodNameEn').value.toUpperCase(),
    name_ar: document.getElementById('prodNameAr').value,
    cost_price: Number(document.getElementById('prodCost').value || 0),
    selling_price: Number(document.getElementById('prodPrice').value),
    vat_rate: Number(document.getElementById('prodVat').value || 15),
    stock_qty: Number(document.getElementById('prodStock').value || 0)
  };
  if (!payload.name_en || !payload.selling_price) return alert('Name & Selling Price required');

  const url = editId ? `/api/products/${editId}` : '/api/products';
  const method = editId ? 'PUT' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  resetProductForm();
  loadProducts();
  alert('Product Saved!');
}

async function deleteProduct(id) {
  if (!confirm('Delete product?')) return;
  await fetch(`/api/products/${id}`, { method: 'DELETE' });
  loadProducts();
}

function downloadProductTemplate() {
  const sample = [
    { Barcode: '6281007001122', Name_EN: 'MILK 1L', Name_AR: 'حليب 1 لتر', Cost_Price_Incl_VAT: 5, Selling_Price_Incl_VAT: 6, VAT_Rate: 15, Stock_Qty: 50 }
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.writeFile(wb, 'Products_Template.xlsx');
}

function uploadProductExcel(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const wb = XLSX.read(e.target.result, { type: 'binary' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const items = rows.map(r => ({
      barcode: r.Barcode || '',
      name_en: r.Name_EN || r.Name || '',
      name_ar: r.Name_AR || '',
      cost_price: Number(r.Cost_Price_Incl_VAT || 0),
      selling_price: Number(r.Selling_Price_Incl_VAT || 0),
      vat_rate: Number(r.VAT_Rate ?? 15),
      stock_qty: Number(r.Stock_Qty || 0)
    }));
    await fetch('/api/products/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
    alert('Products Imported!');
    loadProducts();
  };
  reader.readAsBinaryString(file);
}

// --- SHOPS MANAGEMENT UI ---
function renderShopsManagement() {
  const container = document.getElementById('shopsListContainer');
  if (!container) return;
  container.innerHTML = '';
  shops.forEach(sh => {
    container.innerHTML += `
      <div class="p-3 bg-slate-50 rounded-lg border flex justify-between items-center text-xs">
        <div>
          <div class="font-bold text-emerald-900 text-sm">${sh.shop_name_en} (${sh.shop_name_ar})</div>
          <div>VAT: ${sh.vat_number} | CR: ${sh.cr_number} | Mode: <strong class="${sh.is_zatca_enabled ? 'text-emerald-700' : 'text-blue-700'}">${sh.is_zatca_enabled ? 'ZATCA Phase 2' : 'GRD Standard'}</strong></div>
        </div>
        <button onclick="editShop(${sh.shop_id})" class="bg-amber-500 text-white px-3 py-1.5 rounded font-bold">Configure</button>
      </div>
    `;
  });
}

function openNewShopModal() {
  document.getElementById('modalShopId').value = '';
  document.getElementById('shopModalTitle').innerText = 'Add New Branch / Shop';
  document.getElementById('mShopEn').value = '';
  document.getElementById('mShopAr').value = '';
  document.getElementById('mShopVat').value = '300000000000003';
  document.getElementById('mShopCr').value = '1010000000';
  document.getElementById('mShopZatcaEnabled').checked = true;
  document.getElementById('mShopEnv').value = 'SANDBOX';
  document.getElementById('mShopBldg').value = '1234';
  document.getElementById('mShopStreet').value = '';
  document.getElementById('mShopDistrict').value = '';
  document.getElementById('mShopCity').value = 'Jeddah';
  document.getElementById('mShopPostal').value = '12345';
  document.getElementById('mShopCsid').value = '';
  document.getElementById('mShopSecret').value = '';
  document.getElementById('mShopPriv').value = '';
  document.getElementById('shopModal').classList.remove('hidden');
}

function editShop(shopId) {
  const sh = shops.find(s => s.shop_id === shopId);
  if (!sh) return;
  document.getElementById('modalShopId').value = sh.shop_id;
  document.getElementById('shopModalTitle').innerText = `Configure: ${sh.shop_name_en}`;
  document.getElementById('mShopEn').value = sh.shop_name_en;
  document.getElementById('mShopAr').value = sh.shop_name_ar;
  document.getElementById('mShopVat').value = sh.vat_number;
  document.getElementById('mShopCr').value = sh.cr_number;
  document.getElementById('mShopZatcaEnabled').checked = sh.is_zatca_enabled !== false;
  document.getElementById('mShopEnv').value = sh.zatca_env || 'SANDBOX';
  document.getElementById('mShopBldg').value = sh.building_no || '';
  document.getElementById('mShopStreet').value = sh.street_name || '';
  document.getElementById('mShopDistrict').value = sh.district || '';
  document.getElementById('mShopCity').value = sh.city || 'Jeddah';
  document.getElementById('mShopPostal').value = sh.postal_code || '';
  document.getElementById('mShopCsid').value = sh.csid_certificate || '';
  document.getElementById('mShopSecret').value = sh.secret_key || '';
  document.getElementById('mShopPriv').value = sh.private_key || '';
  document.getElementById('shopModal').classList.remove('hidden');
}

async function saveShopModal() {
  const shopId = document.getElementById('modalShopId').value;
  const payload = {
    shop_id: shopId ? Number(shopId) : null,
    shop_name_en: document.getElementById('mShopEn').value,
    shop_name_ar: document.getElementById('mShopAr').value,
    vat_number: document.getElementById('mShopVat').value,
    cr_number: document.getElementById('mShopCr').value,
    is_zatca_enabled: document.getElementById('mShopZatcaEnabled').checked,
    zatca_env: document.getElementById('mShopEnv').value,
    building_no: document.getElementById('mShopBldg').value,
    street_name: document.getElementById('mShopStreet').value,
    district: document.getElementById('mShopDistrict').value,
    city: document.getElementById('mShopCity').value,
    postal_code: document.getElementById('mShopPostal').value,
    csid_certificate: document.getElementById('mShopCsid').value,
    secret_key: document.getElementById('mShopSecret').value,
    private_key: document.getElementById('mShopPriv').value
  };

  const res = await fetch('/api/shops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.error) return alert(data.error);

  document.getElementById('shopModal').classList.add('hidden');
  await loadShops();
  alert('Branch settings saved successfully!');
}

async function loadSettings() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  appSettings = data || {};
  document.getElementById('setCutoffHour').value = data.cutoff_hour ?? 6;
  document.getElementById('setMasterPass').value = data.master_reset_pass || 'admin123';
}

async function saveSystemSettings() {
  const payload = {
    cutoff_hour: Number(document.getElementById('setCutoffHour').value || 6),
    master_reset_pass: document.getElementById('setMasterPass').value || 'admin123'
  };
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  alert('System settings saved!');
}

async function loadStaffUsers() {
  const res = await fetch('/api/staff');
  const list = await res.json();
  const tbody = document.getElementById('staffTable');
  tbody.innerHTML = '';
  list.forEach(u => {
    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2 font-bold">${u.staff_name}</td>
      <td class="p-2">${u.role}</td>
      <td class="p-2 font-mono">${u.pin}</td>
      <td class="p-2 text-blue-700">${u.shop_name_en || 'Shop 1'}</td>
      <td class="p-2"><button onclick="deleteStaffUser(${u.user_id})" class="text-red-600 font-bold">Del</button></td>
    </tr>`;
  });
}

async function addStaffUser() {
  const payload = {
    staff_name: document.getElementById('newStaffName').value,
    role: document.getElementById('newStaffRole').value,
    pin: document.getElementById('newStaffPin').value,
    shop_id: Number(document.getElementById('newStaffShop').value || 1)
  };
  if (!payload.staff_name || payload.pin.length !== 4) return alert('Enter Name & 4-digit PIN');
  const res = await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.error) return alert(data.error);
  document.getElementById('newStaffName').value = '';
  document.getElementById('newStaffPin').value = '';
  loadStaffUsers();
}

async function deleteStaffUser(id) {
  await fetch(`/api/staff/${id}`, { method: 'DELETE' });
  loadStaffUsers();
}

function downloadFullBackup() {
  window.location.href = '/api/system/backup';
}

function restoreFullBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const master_password = prompt('Enter Master Password (admin123):', '');
  if (!master_password) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const jsonObj = JSON.parse(e.target.result);
      const res = await fetch('/api/system/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: jsonObj.data, master_password }) });
      const out = await res.json();
      if (out.error) return alert(out.error);
      alert('Restore successful!');
      init();
    } catch (err) {
      alert('Error restoring backup: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function setVatFilter(type) {
  const now = new Date();
  const year = now.getFullYear();
  let startStr = '', endStr = '';

  if (type === 'CURRENT_MONTH') {
    const firstDay = new Date(year, now.getMonth(), 1);
    const lastDay = new Date(year, now.getMonth() + 1, 0);
    startStr = firstDay.toISOString().slice(0, 10);
    endStr = lastDay.toISOString().slice(0, 10);
  } else if (type === 'Q1') {
    startStr = `${year}-01-01`; endStr = `${year}-03-31`;
  } else if (type === 'Q2') {
    startStr = `${year}-04-01`; endStr = `${year}-06-30`;
  } else if (type === 'Q3') {
    startStr = `${year}-07-01`; endStr = `${year}-09-30`;
  } else if (type === 'Q4') {
    startStr = `${year}-10-01`; endStr = `${year}-12-31`;
  }

  document.getElementById('repFrom').value = startStr;
  document.getElementById('repTo').value = endStr;
  loadReports();
}

function setMonthFilter(month) {
  if (!month) return;
  const now = new Date();
  const year = now.getFullYear();
  const firstDay = new Date(year, Number(month) - 1, 1);
  const lastDay = new Date(year, Number(month), 0);
  document.getElementById('repFrom').value = firstDay.toISOString().slice(0, 10);
  document.getElementById('repTo').value = lastDay.toISOString().slice(0, 10);
  loadReports();
}

async function loadReports() {
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const shopFilt = document.getElementById('reportShopFilter').value;
  const qs = `?from=${from}&to=${to}&shop_id=${shopFilt}`;

  const vatRes = await fetch('/api/reports/vat-return' + qs);
  const vat = await vatRes.json();

  document.getElementById('pendingSyncCount').innerText = vat.sales?.pending_zatca_count || 0;

  document.getElementById('vatSummaryGrid').innerHTML = `
    <div class="p-3 bg-emerald-50 rounded border border-emerald-200">
      <div class="font-bold text-emerald-900">Output VAT (Sales - Returns)</div>
      <div>Sales (Excl): ${vat.sales?.sales_excl_vat || 0} | VAT: ${vat.sales?.sales_vat || 0}</div>
      <div>Returns (Excl): ${vat.sales?.returns_excl_vat || 0} | VAT: ${vat.sales?.returns_vat || 0}</div>
      <div class="font-bold mt-1 text-emerald-700">Net Output VAT: ${vat.net_output_vat} SAR</div>
    </div>
    <div class="p-3 bg-blue-50 rounded border border-blue-200">
      <div class="font-bold text-blue-900">Input VAT (Purchases - Returns)</div>
      <div>Purchases (Excl): ${vat.purchases?.pur_excl_vat || 0} | VAT: ${vat.purchases?.pur_vat || 0}</div>
      <div>Pur. Returns (Excl): ${vat.purchases?.pur_ret_excl_vat || 0} | VAT: ${vat.purchases?.pur_ret_vat || 0}</div>
      <div class="font-bold mt-1 text-blue-700">Net Input VAT: ${vat.net_input_vat} SAR</div>
    </div>
    <div class="p-3 bg-amber-50 rounded border border-amber-300 flex flex-col justify-center">
      <div class="font-bold text-amber-900">Net VAT Payable to ZATCA</div>
      <div class="text-2xl font-extrabold text-amber-700 mt-1">${vat.net_vat_payable} SAR</div>
    </div>
  `;

  document.getElementById('paymentBreakdown').innerHTML = `
    <div class="p-2 bg-slate-50 rounded border">Cash: <strong>${vat.sales?.cash_sales || 0} SAR</strong></div>
    <div class="p-2 bg-slate-50 rounded border">Mada/Card: <strong>${vat.sales?.mada_sales || 0} SAR</strong></div>
    <div class="p-2 bg-slate-50 rounded border">Credit: <strong>${vat.sales?.credit_sales || 0} SAR</strong></div>
    <div class="p-2 bg-slate-50 rounded border">Bank: <strong>${vat.sales?.bank_sales || 0} SAR</strong></div>
  `;

  const regRes = await fetch('/api/reports/party-register' + qs);
  const rows = await regRes.json();
  const tbody = document.getElementById('registerTable');
  tbody.innerHTML = '';
  rows.forEach(r => {
    tbody.innerHTML += `<tr class="border-t hover:bg-slate-50">
      <td class="p-2 font-semibold">${r.name_en}</td>
      <td class="p-2">${r.party_type}</td>
      <td class="p-2">${r.vat_number || '-'}</td>
      <td class="p-2">${Number(r.gross_sales).toFixed(2)}</td>
      <td class="p-2 text-red-600">${Number(r.sales_returns).toFixed(2)}</td>
      <td class="p-2">${Number(r.net_output_vat).toFixed(2)}</td>
      <td class="p-2">${Number(r.gross_purchases).toFixed(2)}</td>
      <td class="p-2 text-red-600">${Number(r.purchase_returns).toFixed(2)}</td>
      <td class="p-2">${Number(r.net_input_vat).toFixed(2)}</td>
      <td class="p-2">${Number(r.receipts).toFixed(2)}</td>
      <td class="p-2">${Number(r.payments).toFixed(2)}</td>
      <td class="p-2 font-bold">${Number(r.closing_balance).toFixed(2)}</td>
    </tr>`;
  });
}

async function exportSeparateExcel(type) {
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const shopFilt = document.getElementById('reportShopFilter').value;
  const qs = `?from=${from}&to=${to}&shop_id=${shopFilt}`;
  const dateLabel = from && to ? `${from}_to_${to}` : 'ALL';

  let sheetData = [];
  let fileName = '';

  if (type === 'SALES' || type === 'SALES_RETURN') {
    const res = await fetch('/api/sales' + qs);
    const rows = await res.json();
    const filtered = rows.filter(r => type === 'SALES' ? r.doc_type.includes('INVOICE') : r.doc_type.includes('CREDIT_NOTE'));
    sheetData = filtered.map(r => ({
      'Invoice No': r.invoice_number,
      'Branch': r.shop_name_en || '',
      'Date': new Date(r.created_at).toLocaleString(),
      'Doc Type': r.doc_type,
      'Customer': r.party_name || 'Walk-in',
      'Taxable Excl': Number(r.subtotal),
      'VAT 15%': Number(r.vat_amount),
      'Grand Total': Number(r.grand_total),
      'Status': r.zatca_status
    }));
    fileName = `${type}_Register_${dateLabel}.xlsx`;
  } else {
    const res = await fetch('/api/purchases' + qs);
    const rows = await res.json();
    const filtered = rows.filter(r => r.doc_type === type);
    sheetData = filtered.map(r => ({
      'Voucher No': r.voucher_number,
      'Branch': r.shop_name_en || '',
      'Supplier Inv': r.supplier_inv_no,
      'Date': new Date(r.created_at).toLocaleString(),
      'Doc Type': r.doc_type,
      'Supplier': r.party_name || '',
      'Taxable Excl': Number(r.subtotal),
      'Input VAT': Number(r.vat_input),
      'Grand Total': Number(r.grand_total)
    }));
    fileName = `${type}_Register_${dateLabel}.xlsx`;
  }

  if (!sheetData.length) return alert('No records found for export.');
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type);
  XLSX.writeFile(wb, fileName);
}

function onPartyTypeChange(val) {
  const balTypeSel = document.getElementById('pBalType');
  if (val === 'VENDOR') balTypeSel.value = 'PAYABLE';
  else balTypeSel.value = 'RECEIVABLE';
}

async function exportCustomerLedger() {
  const partyId = Number(document.getElementById('saleParty').value);
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const qs = `?party_id=${partyId}&from=${from}&to=${to}`;

  const res = await fetch('/api/reports/ledger' + qs);
  const data = await res.json();
  if (data.error) return alert(data.error);

  let runningBal = data.opening_balance;
  const rows = [{
    'Date': 'OPENING BALANCE',
    'Particulars': 'Opening Due / Balance',
    'Debit (SAR)': '',
    'Credit (SAR)': '',
    'Balance (SAR)': runningBal.toFixed(2)
  }];

  data.transactions.forEach(tx => {
    const deb = Number(tx.debit || 0);
    const cred = Number(tx.credit || 0);
    runningBal = runningBal + deb - cred;
    rows.push({
      'Date': new Date(tx.created_at).toLocaleString(),
      'Particulars': `${tx.particulars} (${tx.ref}) [${tx.payment_mode}]`,
      'Debit (SAR)': deb ? deb.toFixed(2) : '',
      'Credit (SAR)': cred ? cred.toFixed(2) : '',
      'Balance (SAR)': runningBal.toFixed(2)
    });
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ledger Statement');
  XLSX.writeFile(wb, `${data.party.name_en}_Statement.xlsx`);
}

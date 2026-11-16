let parties = [];
let products = [];
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

const TRANSLATIONS = {
  EN: {
    login_title: 'ZATCA Phase 2 POS',
    login_sub: 'Enter 4-Digit PIN (Auto-Unlocks on 4th Digit)',
    login_btn: 'Unlock POS',
    tab_pos: 'POS / Credit Note',
    tab_purchase: 'Purchase / Return',
    tab_history: 'Bills History',
    tab_parties: 'Customers & Vendors',
    tab_products: 'Products',
    tab_reports: 'VAT & Z-Close',
    tab_settings: 'Settings & Backup',
    btn_lock: 'Lock',
    sales_heading: 'Sales / Credit Note',
    b2c_inv: 'B2C Simplified Tax Invoice',
    b2b_inv: 'B2B Standard Tax Invoice',
    b2c_cn: 'B2C Sales Return (Credit Note)',
    b2b_cn: 'B2B Sales Return (Credit Note)',
    th_item: 'Item (EN / AR)',
    th_qty: 'Qty',
    th_price: 'Price (Incl.)',
    th_total: 'Total',
    bill_summary: 'Bill Summary',
    base_amt: 'Base Amount (Excl. VAT):',
    vat_incl: 'VAT (15% Included):',
    grand_tot: 'Grand Total:',
    cash_rec: 'Cash Received:',
    change_due: 'Balance / Change:',
    btn_checkout: '⚡ Instant Bill & Print',
    purchase_heading: 'Purchase & Purchase Return (Enter Unit Cost Excl. VAT)',
    pur_inv: 'Purchase Invoice',
    pur_ret: 'Purchase Return (Debit Note)',
    history_heading: 'Recent ZATCA Invoices & Credit Notes',
    btn_sync_zatca: '🔄 Sync Pending to ZATCA',
    btn_refresh: 'Refresh',
    th_inv: 'Invoice No',
    th_date: 'Date',
    th_type: 'Type',
    th_customer: 'Customer',
    th_mode: 'Mode',
    th_staff: 'Staff',
    th_zatca: 'ZATCA Status',
    th_actions: 'Actions',
    parties_heading: 'Add Customer / Vendor',
    btn_save_party: 'Save Party',
    btn_cancel: 'Cancel',
    voucher_heading: 'Record Receipt / Payment Voucher',
    btn_save_voucher: 'Save & Print Voucher',
    parties_list: 'Customers & Vendors List (Live Balance)',
    th_name: 'Name (EN / AR)',
    th_phone: 'Phone',
    product_heading: 'Add / Update Product',
    btn_save_prod: 'Save Product',
    inventory_heading: 'Inventory & Price List (Prices Incl. 15% VAT)',
    reports_heading: 'VAT Return & Sales Register Filters',
    settings_heading: 'Shop Info, ZATCA National Address & Bank Details',
    btn_save_settings: 'Save All Settings'
  },
  AR: {
    login_title: 'نقطة البيع الفوترة الإلكترونية',
    login_sub: 'أدخل رمز الـ PIN المكون من 4 أرقام',
    login_btn: 'فتح نقطة البيع',
    tab_pos: 'نقطة البيع / إشعار دائن',
    tab_purchase: 'المشتريات / المرتجعات',
    tab_history: 'سجل الفواتير',
    tab_parties: 'العملاء والموردون',
    tab_products: 'المنتجات',
    tab_reports: 'تقرير الضريبة والإغلاق',
    tab_settings: 'الإعدادات والنسخ الاحتياطي',
    btn_lock: 'قفل',
    sales_heading: 'المبيعات / إشعار دائن',
    b2c_inv: 'فاتورة ضريبية مبسطة B2C',
    b2b_inv: 'فاتورة ضريبية قياسية B2B',
    b2c_cn: 'مرتجع مبيعات B2C (إشعار دائن)',
    b2b_cn: 'مرتجع مبيعات B2B (إشعار دائن)',
    th_item: 'الصنف (إنجليزي / عربي)',
    th_qty: 'الكمية',
    th_price: 'السعر (شامل)',
    th_total: 'الإجمالي',
    bill_summary: 'ملخص الفاتورة',
    base_amt: 'المبلغ الأساسي (بدون ضريبة):',
    vat_incl: 'الضريبة (15% مشمولة):',
    grand_tot: 'الإجمالي الكلي:',
    cash_rec: 'المبلغ المستلم:',
    change_due: 'المتبقي / الباقي:',
    btn_checkout: '⚡ إصدار الفاتورة والطباعة الفورية',
    purchase_heading: 'المشتريات والمرتجعات (أدخل التكلفة بدون ضريبة)',
    pur_inv: 'فاتورة شراء',
    pur_ret: 'مرتجع شراء (إشعار مدين)',
    history_heading: 'سجل الفواتير والإشعارات الضريبية',
    btn_sync_zatca: '🔄 مزامنة الفواتير المعلقة مع هيئة الزكاة',
    btn_refresh: 'تحديث',
    th_inv: 'رقم الفاتورة',
    th_date: 'التاريخ',
    th_type: 'النوع',
    th_customer: 'العميل',
    th_mode: 'الطريقة',
    th_staff: 'الموظف',
    th_zatca: 'حالة هيئة الزكاة',
    th_actions: 'الإجراءات',
    parties_heading: 'إضافة عميل / مورد',
    btn_save_party: 'حفظ الطرف',
    btn_cancel: 'إلغاء',
    voucher_heading: 'سند قبض / صرف',
    btn_save_voucher: 'حفظ وطباعة السند',
    parties_list: 'قائمة العملاء والموردين (الرصيد الحالي)',
    th_name: 'الاسم (إنجليزي / عربي)',
    th_phone: 'الجوال',
    product_heading: 'إضافة / تعديل منتج',
    btn_save_prod: 'حفظ المنتج',
    inventory_heading: 'المخزون وقائمة الأسعار (الأسعار شاملة الضريبة)',
    reports_heading: 'مرشحات إقرار الضريبة وسجل المبيعات',
    settings_heading: 'بيانات المتجر، العنوان الوطني والبيانات البنكية',
    btn_save_settings: 'حفظ جميع الإعدادات'
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

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (TRANSLATIONS[currentLang][key]) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = TRANSLATIONS[currentLang][key];
      } else {
        el.innerText = TRANSLATIONS[currentLang][key];
      }
    }
  });
}

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
  if (savedRole && savedName) {
    currentRole = savedRole;
    currentStaffName = savedName;
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
    localStorage.setItem('zatca_pos_role', currentRole);
    localStorage.setItem('zatca_pos_name', currentStaffName);

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
  const pinInput = document.getElementById('loginPin');
  pinInput.value = '';
  document.getElementById('loginScreen').classList.remove('hidden');
  setTimeout(() => pinInput.focus(), 100);
}

async function init() {
  await loadSettings();
  await loadParties();
  await loadProducts();
  if (currentRole === 'ADMIN' || currentRole === 'SUPERVISOR') {
    setVatFilter('CURRENT_MONTH');
    loadStaffUsers();
  }
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
    if (p.account_mode === 'CASH') {
      paySel.value = 'CASH';
    } else if (p.account_mode === 'CREDIT') {
      paySel.value = 'CREDIT';
    }
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
    alert('Camera access error: ' + err);
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
  if (!payload.name_en || !payload.selling_price) return alert('Enter Name & Selling Price (Incl. VAT)');

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
    btn.innerText = TRANSLATIONS[currentLang].btn_checkout || '⚡ Instant Bill & Print';
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
  const { sale, items, company, party } = data;

  document.getElementById('recCompAr').innerText = company.company_name_ar;
  document.getElementById('recCompEn').innerText = company.company_name_en;
  document.getElementById('recAddrAr').innerText = company.address_ar || '';
  document.getElementById('recPhone').innerText = company.shop_phone ? `Tel: ${company.shop_phone}` : '';
  document.getElementById('recVat').innerText = company.vat_number;
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

  const recBankBox = document.getElementById('recBankBox');
  if (company.bank_name || company.bank_account_no || company.bank_iban) {
    recBankBox.classList.remove('hidden');
    document.getElementById('recBankName').innerText = company.bank_name || '';
    document.getElementById('recBankAcc').innerText = company.bank_account_no ? `A/C: ${company.bank_account_no}` : '';
    document.getElementById('recBankIban').innerText = company.bank_iban ? `IBAN: ${company.bank_iban}` : '';
  } else {
    recBankBox.classList.add('hidden');
  }

  const tbody = document.getElementById('recItems');
  tbody.innerHTML = '';
  items.forEach(i => {
    tbody.innerHTML += `<tr><td>${i.name_en}</td><td>${i.qty}</td><td>${Number(i.line_total).toFixed(2)}</td></tr>`;
  });

  const is58 = (company.paper_size || appSettings.paper_size) === '58mm';
  const qrDiv = document.getElementById('qrcode');
  qrDiv.innerHTML = '';
  new QRCode(qrDiv, { text: sale.qr_code_base64, width: is58 ? 165 : 210, height: is58 ? 165 : 210, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });

  populateA4Template(data);
  document.getElementById('receiptModal').classList.remove('hidden');

  if (isNewSale && (company.auto_print !== false)) {
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

function populateA4Template({ sale, items, company, party }) {
  document.getElementById('a4CompEn').innerText = company.company_name_en;
  document.getElementById('a4CompAr').innerText = company.company_name_ar;
  document.getElementById('a4Vat').innerText = company.vat_number;
  document.getElementById('a4Cr').innerText = company.cr_number || '-';
  document.getElementById('a4Phone').innerText = company.shop_phone || '-';
  document.getElementById('a4Addr').innerText = company.address_ar || '';

  const isCredit = sale.doc_type.includes('CREDIT_NOTE');
  document.getElementById('a4Title').innerText = isCredit ? 'TAX CREDIT NOTE / إشعار دائن ضريبي' : 'TAX INVOICE / فاتورة ضريبية';
  document.getElementById('a4InvNo').innerText = sale.invoice_number;
  document.getElementById('a4Date').innerText = new Date(sale.created_at).toLocaleString();
  document.getElementById('a4Status').innerText = sale.zatca_status;

  document.getElementById('a4CustName').innerText = party ? `${party.name_en} ${party.name_ar ? '/ ' + party.name_ar : ''}` : 'Walk-in Cash Customer';
  document.getElementById('a4CustVat').innerText = (party && party.vat_number) || '-';
  document.getElementById('a4CustPhone').innerText = (party && party.phone) || '-';
  document.getElementById('a4PayMode').innerText = sale.payment_mode;
  document.getElementById('a4PrevBal').innerText = `${Number(sale.prev_balance || 0).toFixed(2)} SAR`;
  document.getElementById('a4NewBal').innerText = `${Number(sale.new_balance || 0).toFixed(2)} SAR`;

  const tbody = document.getElementById('a4ItemsBody');
  tbody.innerHTML = '';
  items.forEach((it, idx) => {
    const unitExcl = Number(it.unit_price_excl ?? (Number(it.unit_price) / (1 + Number(it.vat_rate) / 100)));
    tbody.innerHTML += `<tr>
      <td class="border border-slate-300 p-2">${idx + 1}</td>
      <td class="border border-slate-300 p-2">${it.name_en} <br><span class="text-xs text-slate-500">${it.name_ar || ''}</span></td>
      <td class="border border-slate-300 p-2 text-right">${Number(it.qty).toFixed(2)}</td>
      <td class="border border-slate-300 p-2 text-right">${unitExcl.toFixed(2)}</td>
      <td class="border border-slate-300 p-2 text-right">${Number(it.vat_amount).toFixed(2)}</td>
      <td class="border border-slate-300 p-2 text-right font-bold">${Number(it.line_total).toFixed(2)}</td>
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
  const { sale, company, party } = lastCompletedReceipt;
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
        text: `Invoice ${sale.invoice_number} - Total: ${sale.grand_total} SAR | Net Balance: ${sale.new_balance} SAR`
      });
      return;
    }

    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();

    let phone = (party && party.phone) ? party.phone.replace(/[^0-9]/g, '') : '';
    if (!phone) {
      phone = prompt('Enter Customer WhatsApp Number (e.g. 9665XXXXXXXX):', '966') || '';
    }
    const msg = encodeURIComponent(
      `*${company.company_name_en}*
Invoice: *${sale.invoice_number}*
Total (Incl. 15% VAT): *${sale.grand_total} SAR*
Net Balance Due: *${sale.new_balance} SAR*
(Please find the downloaded A4 PDF attached)`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  } catch (err) {
    wrapper.classList.add('hidden');
    alert('PDF Share error: ' + err.message);
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
  alert('Purchase / Return Transaction Saved!');
}

async function loadSalesHistory() {
  const res = await fetch('/api/sales');
  const rows = await res.json();
  const tbody = document.getElementById('historyTable');
  tbody.innerHTML = '';
  rows.forEach(s => {
    const isSynced = s.zatca_status === 'CLEARED' || s.zatca_status === 'REPORTED';
    const badgeClass = isSynced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800';
    tbody.innerHTML += `<tr class="border-t hover:bg-slate-50">
      <td class="p-2 font-bold">${s.invoice_number}</td>
      <td class="p-2">${new Date(s.created_at).toLocaleString()}</td>
      <td class="p-2">${s.doc_type}</td>
      <td class="p-2">${s.party_name || 'Walk-in'}</td>
      <td class="p-2">${s.payment_mode}</td>
      <td class="p-2 font-bold">${Number(s.grand_total).toFixed(2)}</td>
      <td class="p-2">${s.created_by || 'Admin'}</td>
      <td class="p-2"><span class="px-1.5 py-0.5 rounded font-bold ${badgeClass}">${s.zatca_status}</span></td>
      <td class="p-2 space-x-1">
        <button onclick="reprintInvoice(${s.sale_id})" class="bg-blue-600 text-white px-2 py-1 rounded">Print / PDF</button>
        <button onclick="shareHistoryInvoiceOnWhatsApp(${s.sale_id})" class="bg-green-600 text-white px-2 py-1 rounded">📲 WhatsApp</button>
        <a href="/api/sales/${s.sale_id}/xml" class="bg-slate-700 text-white px-2 py-1 rounded inline-block">XML</a>
      </td>
    </tr>`;
  });
}

async function triggerZatcaBatchSync() {
  const res = await fetch('/api/zatca/sync-batch', { method: 'POST' });
  const data = await res.json();
  if (data.error) return alert('Sync Error: ' + data.error);
  alert(`ZATCA Z-Close Batch Sync Complete!
Checked: ${data.total_checked || 0} | Synced: ${data.synced || 0}`);
  loadSalesHistory();
  if (currentRole === 'ADMIN' || currentRole === 'SUPERVISOR') loadReports();
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
    
    if (p.party_type === 'CUSTOMER' || p.party_type === 'BOTH') {
      saleSel.innerHTML += opt;
    }
    if (p.party_type === 'VENDOR' || p.party_type === 'BOTH') {
      purSel.innerHTML += opt;
    }
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
  if (!confirm('Delete this Customer/Vendor?')) return;
  const res = await fetch(`/api/parties/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) return alert(data.error);
  loadParties();
}

function downloadPartyTemplate() {
  const sample = [
    { Party_Type: 'CUSTOMER', Account_Mode: 'CREDIT', Name_EN: 'AL NOOR TRADING', Name_AR: 'تجارة النور', VAT_Number: '300123456700003', Phone: '966500000001', Opening_Balance: 500 },
    { Party_Type: 'VENDOR', Account_Mode: 'CREDIT', Name_EN: 'JEDDAH WHOLESALE SUPPLIERS', Name_AR: 'موردو جدة بالجملة', VAT_Number: '300987654300003', Phone: '966500000002', Opening_Balance: -1200 }
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Parties');
  XLSX.writeFile(wb, 'Parties_Bulk_Template.xlsx');
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
    const res = await fetch('/api/parties/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list })
    });
    const out = await res.json();
    alert(`Successfully imported ${out.inserted || 0} Customers/Vendors!`);
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
  alert('Voucher Recorded & Balance Updated!');
}

async function loadProducts() {
  const res = await fetch('/api/products');
  products = await res.json();
  renderProductsTable(products);
}

function filterProductsTable(q) {
  const query = (q || '').toLowerCase();
  const filtered = products.filter(p =>
    p.name_en.toLowerCase().includes(query) ||
    (p.barcode && p.barcode.toLowerCase().includes(query))
  );
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
  alert('Product Saved & Stock Updated!');
}

async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) return alert(data.error);
  loadProducts();
}

function downloadProductTemplate() {
  const sample = [
    { Barcode: '6281007001122', Name_EN: 'ALMARAI FRESH MILK 1L', Name_AR: 'حليب المراعي طازج 1 لتر', Cost_Price_Incl_VAT: 5.00, Selling_Price_Incl_VAT: 6.00, VAT_Rate: 15, Stock_Qty: 50 },
    { Barcode: '6281007003344', Name_EN: 'SAUDIA TOMATO PASTE 135G', Name_AR: 'معجون طماطم السعودية 135 جم', Cost_Price_Incl_VAT: 1.50, Selling_Price_Incl_VAT: 2.30, VAT_Rate: 15, Stock_Qty: 100 }
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.writeFile(wb, 'Products_Bulk_Template.xlsx');
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
      cost_price: Number(r.Cost_Price_Incl_VAT || r.Cost || 0),
      selling_price: Number(r.Selling_Price_Incl_VAT || r.Selling_Price || 0),
      vat_rate: Number(r.VAT_Rate ?? 15),
      stock_qty: Number(r.Stock_Qty || 0)
    }));
    const res = await fetch('/api/products/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    const out = await res.json();
    alert(`Successfully uploaded ${out.imported || 0} Products!`);
    loadProducts();
  };
  reader.readAsBinaryString(file);
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
    document.getElementById('setCr').value = data.cr_number || '';
    document.getElementById('setAddr').value = data.address_ar || '';
    document.getElementById('setBuildingNo').value = data.building_no || '';
    document.getElementById('setStreetName').value = data.street_name || '';
    document.getElementById('setDistrict').value = data.district || '';
    document.getElementById('setCity').value = data.city || 'Jeddah';
    document.getElementById('setPostalCode').value = data.postal_code || '';
    document.getElementById('setAdditionalNo').value = data.additional_no || '';
    document.getElementById('setBankName').value = data.bank_name || '';
    document.getElementById('setBankAcc').value = data.bank_account_no || '';
    document.getElementById('setBankIban').value = data.bank_iban || '';
    document.getElementById('setPaperSize').value = data.paper_size || '80mm';
    document.getElementById('setAutoPrint').checked = data.auto_print !== false;
    document.getElementById('setEnv').value = data.zatca_env || 'SANDBOX';
    document.getElementById('setCsid').value = data.csid_certificate || '';
    document.getElementById('setSecret').value = data.secret_key || '';
    document.getElementById('setPrivKey').value = data.private_key || '';
    document.getElementById('setAdminPin').value = data.admin_pin || '1234';
    document.getElementById('setCashierPin').value = data.cashier_pin || '0000';
    document.getElementById('setMasterPass').value = data.master_reset_pass || 'admin123';
    document.getElementById('setCutoffHour').value = data.cutoff_hour ?? 6;
    document.getElementById('envBadge').innerText = data.zatca_env || 'SANDBOX';
  }
}

async function saveSettings() {
  const payload = {
    company_name_en: document.getElementById('setCompEn').value,
    company_name_ar: document.getElementById('setCompAr').value,
    shop_phone: document.getElementById('setShopPhone').value,
    vat_number: document.getElementById('setVat').value,
    cr_number: document.getElementById('setCr').value,
    address_ar: document.getElementById('setAddr').value,
    building_no: document.getElementById('setBuildingNo').value,
    street_name: document.getElementById('setStreetName').value,
    district: document.getElementById('setDistrict').value,
    city: document.getElementById('setCity').value,
    postal_code: document.getElementById('setPostalCode').value,
    additional_no: document.getElementById('setAdditionalNo').value,
    bank_name: document.getElementById('setBankName').value,
    bank_account_no: document.getElementById('setBankAcc').value,
    bank_iban: document.getElementById('setBankIban').value,
    paper_size: document.getElementById('setPaperSize').value,
    auto_print: document.getElementById('setAutoPrint').checked,
    zatca_env: document.getElementById('setEnv').value,
    csid_certificate: document.getElementById('setCsid').value,
    secret_key: document.getElementById('setSecret').value,
    private_key: document.getElementById('setPrivKey').value,
    admin_pin: document.getElementById('setAdminPin').value,
    cashier_pin: document.getElementById('setCashierPin').value,
    master_reset_pass: document.getElementById('setMasterPass').value,
    cutoff_hour: Number(document.getElementById('setCutoffHour').value || 6)
  };
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  alert('All Settings Saved!');
  loadSettings();
}

function downloadFullBackup() {
  window.location.href = '/api/system/backup';
}

function restoreFullBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const master_password = prompt('Enter Master Security Password (default: admin123) to Restore Backup:', '');
  if (!master_password) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const jsonObj = JSON.parse(e.target.result);
      const res = await fetch('/api/system/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: jsonObj.data, master_password })
      });
      const out = await res.json();
      if (out.error) return alert('Restore Failed: ' + out.error);
      alert('Full Backup Restored Successfully!');
      init();
    } catch (err) {
      alert('Invalid JSON backup file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

async function resetTransactions(keepMasterData) {
  const master_password = prompt('Enter Master Security Password (default: admin123) to authorize reset:', '');
  if (!master_password) return;

  const msg = keepMasterData ? 'RESET BILLS ONLY: All test invoices and balances will be cleared to ZERO. Continue?' : 'FULL FACTORY WIPE: ALL data will be wiped to ZERO! Continue?';
  if (!confirm(msg)) return;

  const res = await fetch('/api/system/reset-transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keepMasterData, master_password })
  });
  const out = await res.json();
  if (out.error) return alert('Reset Failed: ' + out.error);
  alert('System Reset Complete! All counters and balances are now ZERO.');
  init();
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
      <td class="p-2">${u.phone || '-'}</td>
      <td class="p-2"><button onclick="deleteStaffUser(${u.user_id})" class="text-red-600 font-bold">Del</button></td>
    </tr>`;
  });
}

async function addStaffUser() {
  const payload = {
    staff_name: document.getElementById('newStaffName').value,
    role: document.getElementById('newStaffRole').value,
    pin: document.getElementById('newStaffPin').value,
    phone: document.getElementById('newStaffPhone').value
  };
  if (!payload.staff_name || payload.pin.length !== 4) return alert('Enter Staff Name & 4-Digit PIN');
  const res = await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.error) return alert(data.error);
  document.getElementById('newStaffName').value = '';
  document.getElementById('newStaffPin').value = '';
  document.getElementById('newStaffPhone').value = '';
  loadStaffUsers();
}

async function deleteStaffUser(id) {
  await fetch(`/api/staff/${id}`, { method: 'DELETE' });
  loadStaffUsers();
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
    startStr = `${year}-01-01`;
    endStr = `${year}-03-31`;
  } else if (type === 'Q2') {
    startStr = `${year}-04-01`;
    endStr = `${year}-06-30`;
  } else if (type === 'Q3') {
    startStr = `${year}-07-01`;
    endStr = `${year}-09-30`;
  } else if (type === 'Q4') {
    startStr = `${year}-10-01`;
    endStr = `${year}-12-31`;
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
  const qs = from && to ? `?from=${from}&to=${to}` : '';

  const vatRes = await fetch('/api/reports/vat-return' + qs);
  const vat = await vatRes.json();

  document.getElementById('pendingSyncCount').innerText = vat.sales?.pending_zatca_count || 0;

  document.getElementById('vatSummaryGrid').innerHTML = `
    <div class="p-3 bg-emerald-50 rounded border border-emerald-200">
      <div class="font-bold text-emerald-900">Output VAT (Sales - Returns)</div>
      <div>Sales (Excl. VAT): ${vat.sales?.sales_excl_vat || 0} | VAT: ${vat.sales?.sales_vat || 0}</div>
      <div>Returns (Excl. VAT): ${vat.sales?.returns_excl_vat || 0} | VAT: ${vat.sales?.returns_vat || 0}</div>
      <div class="font-bold mt-1 text-emerald-700">Net Output VAT: ${vat.net_output_vat} SAR</div>
    </div>
    <div class="p-3 bg-blue-50 rounded border border-blue-200">
      <div class="font-bold text-blue-900">Input VAT (Purchases - Returns)</div>
      <div>Purchases (Excl. VAT): ${vat.purchases?.pur_excl_vat || 0} | VAT: ${vat.purchases?.pur_vat || 0}</div>
      <div>Pur. Returns (Excl. VAT): ${vat.purchases?.pur_ret_excl_vat || 0} | VAT: ${vat.purchases?.pur_ret_vat || 0}</div>
      <div class="font-bold mt-1 text-blue-700">Net Input VAT: ${vat.net_input_vat} SAR</div>
    </div>
    <div class="p-3 bg-amber-50 rounded border border-amber-300 flex flex-col justify-center">
      <div class="font-bold text-amber-900">Net VAT Payable to ZATCA</div>
      <div class="text-2xl font-extrabold text-amber-700 mt-1">${vat.net_vat_payable} SAR</div>
    </div>
  `;

  document.getElementById('paymentBreakdown').innerHTML = `
    <div class="p-2 bg-slate-50 rounded border">Cash Sales: <strong>${vat.sales?.cash_sales || 0} SAR</strong></div>
    <div class="p-2 bg-slate-50 rounded border">Mada/Card Sales: <strong>${vat.sales?.mada_sales || 0} SAR</strong></div>
    <div class="p-2 bg-slate-50 rounded border">Credit Sales: <strong>${vat.sales?.credit_sales || 0} SAR</strong></div>
    <div class="p-2 bg-slate-50 rounded border">Bank Sales: <strong>${vat.sales?.bank_sales || 0} SAR</strong></div>
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
  const qs = from && to ? `?from=${from}&to=${to}` : '';
  const dateLabel = from && to ? `${from}_to_${to}` : 'ALL_DATES';

  let sheetData = [];
  let fileName = '';

  if (type === 'SALES' || type === 'SALES_RETURN') {
    const res = await fetch('/api/sales' + qs);
    const rows = await res.json();
    const filtered = rows.filter(r =>
      type === 'SALES' ? r.doc_type.includes('INVOICE') : r.doc_type.includes('CREDIT_NOTE')
    );

    sheetData = filtered.map(r => ({
      'Invoice No': r.invoice_number,
      'Date': new Date(r.created_at).toLocaleString(),
      'Doc Type': r.doc_type,
      'Original Invoice Ref': r.original_invoice_ref || '',
      'Customer Name': r.party_name || 'Walk-in',
      'Customer VAT No': r.party_vat || '',
      'Payment Mode': r.payment_mode,
      'Taxable Amount (Excl. VAT)': Number(r.subtotal),
      'VAT Amount (15%)': Number(r.vat_amount),
      'Grand Total (Incl. VAT)': Number(r.grand_total),
      'ZATCA Status': r.zatca_status
    }));
    fileName = `${type}_Register_${dateLabel}.xlsx`;
  } else {
    const res = await fetch('/api/purchases' + qs);
    const rows = await res.json();
    const filtered = rows.filter(r => r.doc_type === type);

    sheetData = filtered.map(r => ({
      'Voucher No': r.voucher_number,
      'Supplier Invoice No': r.supplier_inv_no,
      'Date': new Date(r.created_at).toLocaleString(),
      'Doc Type': r.doc_type,
      'Original Ref': r.original_purchase_ref || '',
      'Party Name': r.party_name || '',
      'Party VAT No': r.party_vat || '',
      'Payment Mode': r.payment_mode,
      'Taxable Amount (Excl. VAT)': Number(r.subtotal),
      'Input VAT (15%)': Number(r.vat_input),
      'Grand Total (Incl. VAT)': Number(r.grand_total)
    }));
    fileName = `${type}_Register_${dateLabel}.xlsx`;
  }

  if (!sheetData.length) return alert(`No records found for ${type} in selected dates.`);

  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type);
  XLSX.writeFile(wb, fileName);
}

function onPartyTypeChange(val) {
  const balTypeSel = document.getElementById('pBalType');
  if (val === 'VENDOR') {
    balTypeSel.value = 'PAYABLE';
  } else {
    balTypeSel.value = 'RECEIVABLE';
  }
}

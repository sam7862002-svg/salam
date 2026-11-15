let parties = [];
let products = [];
let cart = [];
let purCart = [];
let currentRole = 'ADMIN';
let html5QrCode = null;
let scanTargetContext = 'POS';
let quickAddTargetContext = 'POS';
let lastReceiptData = null;

// Sound beep on successful barcode scan
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

// Login / Lock
async function doLogin() {
  const pin = document.getElementById('loginPin').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  const data = await res.json();
  if (!data.success) return alert('Invalid PIN!');

  currentRole = data.role;
  document.getElementById('roleBadge').innerText = currentRole;
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('loginPin').value = '';

  document.querySelectorAll('.admin-only').forEach(el => {
    if (currentRole === 'ADMIN') el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
  init();
}

function logout() {
  document.getElementById('loginOverlay').classList.remove('hidden');
}

async function init() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('zReportDate').value = today;
  await loadSettings();
  await loadParties();
  await loadProducts();
  loadSalesHistory();
}

function showTab(tab) {
  document.querySelectorAll('.tab-section').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  if (tab === 'reports') loadReports();
  if (tab === 'history') {
    loadSalesHistory();
    loadZReport();
  }
}

function toggleReturnFields() {
  const docType = document.getElementById('saleDocType').value;
  const box = document.getElementById('creditNoteFields');
  if (docType.includes('CREDIT_NOTE')) box.classList.remove('hidden');
  else box.classList.add('hidden');
}

// Auto English-to-Arabic Translation
async function autoTranslate(sourceId, targetId) {
  const text = document.getElementById(sourceId).value.trim();
  const targetEl = document.getElementById(targetId);
  if (!text || targetEl.value.trim()) return;
  try {
    const res = await fetch(`/api/translate?text=${encodeURIComponent(text)}`);
    const data = await res.json();
    if (data.arabic) targetEl.value = data.arabic;
  } catch (e) {}
}

// Single-Shot Mobile Camera Scanner (Auto-stops after 1 scan)
async function openCameraScanner(context) {
  scanTargetContext = context;
  document.getElementById('cameraModal').classList.remove('hidden');
  html5QrCode = new Html5Qrcode("reader");

  try {
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 15, qrbox: { width: 260, height: 140 } },
      async (decodedText) => {
        playBeep();
        await closeCameraScanner();
        handleBarcodeScan(decodedText, scanTargetContext);
      }
    );
  } catch (err) {
    alert("Camera error: " + err);
    closeCameraScanner();
  }
}

async function closeCameraScanner() {
  document.getElementById('cameraModal').classList.add('hidden');
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch (e) {}
    html5QrCode = null;
  }
}

// Handle Barcode Scan (USB or Camera) -> Group Qty or Trigger Quick-Add Popup
function handleBarcodeScan(rawCode, context) {
  const code = (rawCode || '').trim();
  if (!code) return;

  if (context === 'POS') document.getElementById('posBarcodeInput').value = '';
  if (context === 'PURCHASE') document.getElementById('purBarcodeInput').value = '';

  if (context === 'PRODUCT_FORM') {
    document.getElementById('prodBarcode').value = code;
    return;
  }

  const found = products.find(p => (p.barcode || '').trim() === code);
  if (found) {
    if (context === 'POS') addProductObjToCart(found);
    else if (context === 'PURCHASE') addProductObjToPurCart(found);
  } else {
    // Unknown barcode -> Open Quick-Add Modal
    quickAddTargetContext = context;
    document.getElementById('qaBarcode').value = code;
    document.getElementById('qaNameEn').value = '';
    document.getElementById('qaNameAr').value = '';
    document.getElementById('qaCost').value = '';
    document.getElementById('qaPrice').value = '';
    document.getElementById('quickAddModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('qaNameEn').focus(), 100);
  }
}

async function saveQuickProduct() {
  const payload = {
    barcode: document.getElementById('qaBarcode').value,
    name_en: document.getElementById('qaNameEn').value.trim(),
    name_ar: document.getElementById('qaNameAr').value.trim() || document.getElementById('qaNameEn').value.trim(),
    cost_price: Number(document.getElementById('qaCost').value || 0),
    selling_price: Number(document.getElementById('qaPrice').value || 0),
    vat_rate: 15,
    stock_qty: 0
  };
  if (!payload.name_en || !payload.selling_price) return alert('Enter Product Name and Selling Price!');

  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const savedProd = await res.json();
  await loadProducts();
  document.getElementById('quickAddModal').classList.add('hidden');

  if (quickAddTargetContext === 'POS') addProductObjToCart(savedProd);
  else if (quickAddTargetContext === 'PURCHASE') addProductObjToPurCart(savedProd);
}

// Discreet Staff Cost Code Formatter (e.g. Cost 12.50 -> "REF-01250")
function formatDiscreetCost(costVal) {
  const cents = Math.round(Number(costVal || 0) * 100);
  return `REF-${String(cents).padStart(5, '0')}`;
}

function addProductObjToCart(prod) {
  // Smart Grouping: If item already exists in cart, increment qty on the same row
  const existingIdx = cart.findIndex(c => c.product_id === prod.product_id);
  if (existingIdx > -1) {
    cart[existingIdx].qty += 1;
  } else {
    cart.push({
      product_id: prod.product_id,
      name_en: prod.name_en,
      name_ar: prod.name_ar,
      qty: 1,
      cost_price: Number(prod.cost_price || 0),
      unit_price: Number(prod.selling_price), // Tax-Inclusive Selling Price
      vat_rate: Number(prod.vat_rate ?? 15)
    });
  }
  document.getElementById('discreetCostIndicator').innerText = formatDiscreetCost(prod.cost_price);
  renderCart();
}

function addSelectedProductToCart() {
  const id = Number(document.getElementById('productSelect').value);
  if (!id) return;
  const prod = products.find(p => p.product_id === id);
  if (prod) addProductObjToCart(prod);
  document.getElementById('productSelect').value = '';
}

function renderCart() {
  const tbody = document.getElementById('cartBody');
  tbody.innerHTML = '';
  let subExcl = 0, vatTotal = 0, grandTotalIncl = 0;

  cart.forEach((item, idx) => {
    const divisor = 1 + (item.vat_rate / 100);
    const lineTotal = item.qty * item.unit_price;
    const lineSub = lineTotal / divisor;
    const lineVat = lineTotal - lineSub;

    subExcl += lineSub;
    vatTotal += lineVat;
    grandTotalIncl += lineTotal;

    tbody.innerHTML += `<tr class="border-t hover:bg-slate-50" onclick="document.getElementById('discreetCostIndicator').innerText='${formatDiscreetCost(item.cost_price)}'">
      <td class="p-2">
        <div class="font-semibold">${item.name_en}</div>
        <div class="text-xs text-slate-500">${item.name_ar}</div>
      </td>
      <td class="p-2"><input type="number" step="1" min="1" value="${item.qty}" onchange="cart[${idx}].qty=Number(this.value);renderCart()" class="w-16 border p-1 rounded text-center font-bold" /></td>
      <td class="p-2"><input type="number" step="0.01" value="${item.unit_price}" onchange="cart[${idx}].unit_price=Number(this.value);renderCart()" class="w-24 border p-1 rounded font-semibold" /></td>
      <td class="p-2 font-bold text-emerald-800">${lineTotal.toFixed(2)}</td>
      <td class="p-2"><button onclick="cart.splice(${idx},1);renderCart()" class="text-red-600 font-bold">X</button></td>
    </tr>`;
  });

  document.getElementById('cartSub').innerText = subExcl.toFixed(2) + ' SAR';
  document.getElementById('cartVat').innerText = vatTotal.toFixed(2) + ' SAR';
  document.getElementById('cartTotal').innerText = grandTotalIncl.toFixed(2) + ' SAR';
  updateBalanceDue();
}

function updateBalanceDue() {
  const totalText = document.getElementById('cartTotal').innerText.replace(' SAR', '');
  const total = Number(totalText || 0);
  const tendered = Number(document.getElementById('cashTendered').value || 0);
  const diff = tendered > 0 ? (tendered - total) : 0;
  document.getElementById('cashChangeDue').innerText = diff.toFixed(2) + ' SAR';
}

async function submitSale() {
  if (!cart.length) return alert('Cart is empty!');
  const payload = {
    party_id: Number(document.getElementById('saleParty').value),
    doc_type: document.getElementById('saleDocType').value,
    original_invoice_ref: document.getElementById('origInvRef').value,
    return_reason: document.getElementById('returnReason').value,
    payment_mode: document.getElementById('salePaymentMode').value,
    items: cart
  };
  const res = await fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.error) return alert('Error: ' + data.error);

  cart = [];
  document.getElementById('cashTendered').value = '';
  document.getElementById('discreetCostIndicator').innerText = '';
  renderCart();
  loadProducts();
  loadSalesHistory();
  showReceipt(data);
}

function showReceipt(data) {
  lastReceiptData = data;
  const { sale, items, company, party } = data;
  document.getElementById('recCompAr').innerText = company.company_name_ar;
  document.getElementById('recCompEn').innerText = company.company_name_en;
  document.getElementById('recVat').innerText = company.vat_number;
  document.getElementById('recDocType').innerText = sale.doc_type;
  document.getElementById('recInvNo').innerText = sale.invoice_number;
  document.getElementById('recIcv').innerText = sale.icv;
  document.getElementById('recDate').innerText = new Date(sale.created_at).toLocaleString();
  document.getElementById('recCustomer').innerText = (party && party.name_en) || 'Walk-in Customer';
  document.getElementById('recZatcaStatus').innerText = sale.zatca_status;
  document.getElementById('recSub').innerText = Number(sale.subtotal).toFixed(2);
  document.getElementById('recTax').innerText = Number(sale.vat_amount).toFixed(2);
  document.getElementById('recGrand').innerText = Number(sale.grand_total).toFixed(2);

  const tbody = document.getElementById('recItems');
  tbody.innerHTML = '';
  items.forEach(i => {
    tbody.innerHTML += `<tr><td>${i.name_en}</td><td>${i.qty}</td><td>${Number(i.line_total).toFixed(2)}</td></tr>`;
  });

  const qrDiv = document.getElementById('qrcode');
  qrDiv.innerHTML = '';
  new QRCode(qrDiv, { text: sale.qr_code_base64, width: 140, height: 140 });
  document.getElementById('receiptModal').classList.remove('hidden');
}

// Generate A4 PDF (For Direct Print or WhatsApp Sharing)
async function generateA4PDF(mode) {
  if (!lastReceiptData) return;
  const { sale, items, company, party } = lastReceiptData;

  document.getElementById('a4CompEn').innerText = company.company_name_en;
  document.getElementById('a4CompAr').innerText = company.company_name_ar;
  document.getElementById('a4Vat').innerText = company.vat_number;
  document.getElementById('a4Cr').innerText = company.cr_number || '-';
  document.getElementById('a4Addr').innerText = company.address_ar || '';
  document.getElementById('a4Title').innerText = sale.doc_type.includes('CREDIT_NOTE')
    ? 'CREDIT NOTE / إشعار دائن'
    : 'TAX INVOICE / فاتورة ضريبية';
  document.getElementById('a4InvNo').innerText = sale.invoice_number;
  document.getElementById('a4Date').innerText = new Date(sale.created_at).toLocaleString();
  document.getElementById('a4Icv').innerText = sale.icv;
  document.getElementById('a4Zatca').innerText = sale.zatca_status;
  document.getElementById('a4CustName').innerText = `${party?.name_en || 'Walk-in Customer'} ${party?.name_ar ? '/ ' + party.name_ar : ''}`;
  document.getElementById('a4CustVat').innerText = party?.vat_number || 'N/A';

  const tbody = document.getElementById('a4ItemsBody');
  tbody.innerHTML = '';
  items.forEach((it, i) => {
    tbody.innerHTML += `<tr>
      <td style="padding:6px; border:1px solid #cbd5e1; text-align:center;">${i + 1}</td>
      <td style="padding:6px; border:1px solid #cbd5e1;">${it.name_en} <br/><small style="color:#64748b;">${it.name_ar || ''}</small></td>
      <td style="padding:6px; border:1px solid #cbd5e1; text-align:center;">${it.qty}</td>
      <td style="padding:6px; border:1px solid #cbd5e1; text-align:right;">${Number(it.unit_price).toFixed(2)}</td>
      <td style="padding:6px; border:1px solid #cbd5e1; text-align:right;">${Number(it.vat_amount).toFixed(2)}</td>
      <td style="padding:6px; border:1px solid #cbd5e1; text-align:right; font-weight:bold;">${Number(it.line_total).toFixed(2)}</td>
    </tr>`;
  });

  document.getElementById('a4Sub').innerText = Number(sale.subtotal).toFixed(2) + ' SAR';
  document.getElementById('a4Tax').innerText = Number(sale.vat_amount).toFixed(2) + ' SAR';
  document.getElementById('a4Grand').innerText = Number(sale.grand_total).toFixed(2) + ' SAR';

  const a4Qr = document.getElementById('a4QrCode');
  a4Qr.innerHTML = '';
  new QRCode(a4Qr, { text: sale.qr_code_base64, width: 110, height: 110 });

  const container = document.getElementById('a4InvoiceContainer');
  container.classList.remove('hidden');
  const element = document.getElementById('a4InvoiceTemplate');
  const fileName = `${sale.invoice_number}.pdf`;

  const opt = {
    margin: 5,
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  if (mode === 'PRINT') {
    await html2pdf().set(opt).from(element).save();
    container.classList.add('hidden');
  } else if (mode === 'WHATSAPP') {
    const pdfBlob = await html2pdf().set(opt).from(element).outputPdf('blob');
    container.classList.add('hidden');

    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    const msg = `Invoice: ${sale.invoice_number}%0ATotal: ${Number(sale.grand_total).toFixed(2)} SAR (Incl. 15% VAT)%0AThank you for shopping with ${company.company_name_en}!`;

    // On Mobile: Native Share Sheet sends actual PDF directly to WhatsApp
    if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      try {
        await navigator.share({
          files: [pdfFile],
          title: fileName,
          text: `Invoice ${sale.invoice_number} - ${Number(sale.grand_total).toFixed(2)} SAR`
        });
        return;
      } catch (e) {}
    }

    // Fallback on Desktop: Download PDF + Open WhatsApp Web with Customer Phone
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();

    let phone = (party?.phone || '').replace(/[^0-9]/g, '');
    if (!phone) {
      phone = (prompt('Enter Customer WhatsApp Number (with country code, e.g. 9665XXXXXXXX):') || '').replace(/[^0-9]/g, '');
    }
    const waUrl = phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`;
    window.open(waUrl, '_blank');
  }
}

// Sales History & Z-Report
async function loadSalesHistory() {
  const res = await fetch('/api/sales');
  const rows = await res.json();
  const tbody = document.getElementById('salesHistoryTable');
  tbody.innerHTML = '';
  rows.forEach(s => {
    tbody.innerHTML += `<tr class="border-t hover:bg-slate-50">
      <td class="p-2 font-bold">${s.invoice_number}</td>
      <td class="p-2">${new Date(s.created_at).toLocaleString()}</td>
      <td class="p-2">${s.party_name || 'Walk-in'}</td>
      <td class="p-2">${s.doc_type}</td>
      <td class="p-2">${s.payment_mode}</td>
      <td class="p-2 font-bold">${Number(s.grand_total).toFixed(2)}</td>
      <td class="p-2 text-emerald-700 font-semibold">${s.zatca_status}</td>
      <td class="p-2 flex gap-1">
        <button onclick="reprintInvoice(${s.sale_id})" class="bg-slate-700 text-white px-2 py-1 rounded text-xs">View/Print</button>
        <button onclick="startReturnFromInvoice('${s.invoice_number}', ${s.party_id}, '${s.doc_type}')" class="bg-amber-600 text-white px-2 py-1 rounded text-xs">Return</button>
      </td>
    </tr>`;
  });
}

async function reprintInvoice(saleId) {
  const res = await fetch(`/api/sales/${saleId}`);
  const data = await res.json();
  showReceipt(data);
}

function startReturnFromInvoice(invNo, partyId, origType) {
  showTab('pos');
  document.getElementById('saleDocType').value = origType.startsWith('B2B') ? 'B2B_CREDIT_NOTE' : 'B2C_CREDIT_NOTE';
  toggleReturnFields();
  document.getElementById('origInvRef').value = invNo;
  document.getElementById('saleParty').value = partyId;
}

async function loadZReport() {
  const date = document.getElementById('zReportDate').value;
  const res = await fetch(`/api/reports/z-report?date=${date}`);
  const data = await res.json();
  const grid = document.getElementById('zReportGrid');
  grid.innerHTML = '';
  if (!data.breakdown || !data.breakdown.length) {
    grid.innerHTML = '<div class="text-slate-500 col-span-4">No sales recorded on this date.</div>';
    return;
  }
  data.breakdown.forEach(b => {
    grid.innerHTML += `<div class="p-3 bg-slate-50 rounded-lg border">
      <div class="font-bold text-emerald-800">${b.payment_mode} (${b.invoice_count} Bills)</div>
      <div>Sales: <strong>${Number(b.total_sales).toFixed(2)} SAR</strong></div>
      <div class="text-red-600">Returns: ${Number(b.total_returns).toFixed(2)} SAR</div>
      <div class="text-xs text-slate-500 mt-1">Net VAT: ${Number(b.net_vat).toFixed(2)} SAR</div>
    </div>`;
  });
}

// Settings, Parties, Products, Purchases, Reports
async function loadSettings() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  if (data.company_name_en) {
    document.getElementById('setCompEn').value = data.company_name_en || '';
    document.getElementById('setCompAr').value = data.company_name_ar || '';
    document.getElementById('setVat').value = data.vat_number || '';
    document.getElementById('setCr').value = data.cr_number || '';
    document.getElementById('setAddr').value = data.address_ar || '';
    document.getElementById('setEnv').value = data.zatca_env || 'SANDBOX';
    document.getElementById('setCsid').value = data.csid_certificate || '';
    document.getElementById('setSecret').value = data.secret_key || '';
    document.getElementById('setPrivKey').value = data.private_key || '';
    document.getElementById('setAdminPin').value = data.admin_pin || '1234';
    document.getElementById('setCashierPin').value = data.cashier_pin || '0000';
    document.getElementById('envBadge').innerText = data.zatca_env || 'SANDBOX';
  }
}

async function saveSettings() {
  const payload = {
    company_name_en: document.getElementById('setCompEn').value,
    company_name_ar: document.getElementById('setCompAr').value,
    vat_number: document.getElementById('setVat').value,
    cr_number: document.getElementById('setCr').value,
    address_ar: document.getElementById('setAddr').value,
    zatca_env: document.getElementById('setEnv').value,
    csid_certificate: document.getElementById('setCsid').value,
    secret_key: document.getElementById('setSecret').value,
    private_key: document.getElementById('setPrivKey').value,
    admin_pin: document.getElementById('setAdminPin').value,
    cashier_pin: document.getElementById('setCashierPin').value
  };
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  alert('Settings Saved!');
  loadSettings();
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
    const opt = `<option value="${p.party_id}">${p.name_en} ${p.vat_number ? '(' + p.vat_number + ')' : ''}</option>`;
    saleSel.innerHTML += opt;
    purSel.innerHTML += opt;
    vSel.innerHTML += opt;

    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2 font-semibold">${p.name_en} / ${p.name_ar || ''}</td>
      <td class="p-2">${p.party_type}</td>
      <td class="p-2">${p.vat_number || '-'}</td>
      <td class="p-2">${p.phone || '-'}</td>
    </tr>`;
  });
}

async function saveParty() {
  const payload = {
    party_type: document.getElementById('pType').value,
    name_en: document.getElementById('pNameEn').value,
    name_ar: document.getElementById('pNameAr').value,
    vat_number: document.getElementById('pVat').value,
    phone: document.getElementById('pPhone').value,
    opening_balance: Number(document.getElementById('pOpening').value || 0)
  };
  if (!payload.name_en) return alert('Name required');
  await fetch('/api/parties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  loadParties();
  alert('Party Saved!');
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
  alert('Voucher Recorded!');
}

async function loadProducts() {
  const res = await fetch('/api/products');
  products = await res.json();

  const pSel = document.getElementById('productSelect');
  const purSel = document.getElementById('purProductSelect');
  const tbody = document.getElementById('productsTable');

  pSel.innerHTML = '<option value="">+ Search / Select Item Manually...</option>';
  purSel.innerHTML = '<option value="">+ Select Product Manually...</option>';
  tbody.innerHTML = '';

  products.forEach(pr => {
    const incl = Number(pr.selling_price);
    const rate = Number(pr.vat_rate ?? 15);
    const base = incl / (1 + rate / 100);
    const vat = incl - base;

    pSel.innerHTML += `<option value="${pr.product_id}">${pr.name_en} (${pr.name_ar}) - ${incl.toFixed(2)} SAR</option>`;
    purSel.innerHTML += `<option value="${pr.product_id}">${pr.name_en}</option>`;
    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2 font-mono text-xs">${pr.barcode || '-'}</td>
      <td class="p-2">${pr.name_en} / <span class="text-slate-600">${pr.name_ar}</span></td>
      <td class="p-2 font-bold text-emerald-700">${incl.toFixed(2)} SAR</td>
      <td class="p-2 text-xs text-slate-500">Base: ${base.toFixed(2)} + VAT: ${vat.toFixed(2)}</td>
      <td class="p-2 font-bold">${pr.stock_qty}</td>
    </tr>`;
  });
}

async function saveProduct() {
  const payload = {
    barcode: document.getElementById('prodBarcode').value.trim(),
    name_en: document.getElementById('prodNameEn').value.trim(),
    name_ar: document.getElementById('prodNameAr').value.trim() || document.getElementById('prodNameEn').value.trim(),
    cost_price: Number(document.getElementById('prodCost').value || 0),
    selling_price: Number(document.getElementById('prodPrice').value),
    vat_rate: Number(document.getElementById('prodVat').value || 15),
    stock_qty: Number(document.getElementById('prodStock').value || 0)
  };
  if (!payload.name_en || !payload.selling_price) return alert('Name & Selling Price required');
  await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  loadProducts();
  alert('Product Saved!');
}

function addProductObjToPurCart(prod) {
  const existingIdx = purCart.findIndex(c => c.product_id === prod.product_id);
  if (existingIdx > -1) {
    purCart[existingIdx].qty += 1;
  } else {
    purCart.push({
      product_id: prod.product_id,
      name_en: prod.name_en,
      qty: 1,
      unit_price: Number(prod.cost_price || prod.selling_price),
      vat_rate: Number(prod.vat_rate ?? 15)
    });
  }
  renderPurCart();
}

function addProductToPurCart() {
  const id = Number(document.getElementById('purProductSelect').value);
  if (!id) return;
  const prod = products.find(p => p.product_id === id);
  if (prod) addProductObjToPurCart(prod);
  document.getElementById('purProductSelect').value = '';
}

function renderPurCart() {
  const tbody = document.getElementById('purCartBody');
  tbody.innerHTML = '';
  purCart.forEach((item, idx) => {
    const tot = item.qty * item.unit_price;
    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2">${item.name_en}</td>
      <td class="p-2"><input type="number" value="${item.qty}" onchange="purCart[${idx}].qty=Number(this.value);renderPurCart()" class="w-20 border p-1 rounded" /></td>
      <td class="p-2"><input type="number" step="0.01" value="${item.unit_price}" onchange="purCart[${idx}].unit_price=Number(this.value);renderPurCart()" class="w-28 border p-1 rounded" /></td>
      <td class="p-2 font-semibold">${tot.toFixed(2)}</td>
      <td class="p-2"><button onclick="purCart.splice(${idx},1);renderPurCart()" class="text-red-600 font-bold">X</button></td>
    </tr>`;
  });
}

async function submitPurchase() {
  if (!purCart.length) return alert('Add items first');
  const payload = {
    supplier_inv_no: document.getElementById('supInvNo').value || 'SUP-001',
    party_id: Number(document.getElementById('purParty').value),
    doc_type: document.getElementById('purDocType').value,
    payment_mode: document.getElementById('purPayMode').value,
    items: purCart
  };
  await fetch('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  purCart = [];
  renderPurCart();
  loadProducts();
  alert('Purchase Transaction Saved!');
}

function downloadVatExcel(type) {
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const url = `/api/reports/export-excel?type=${type}&from=${from}&to=${to}`;
  window.open(url, '_blank');
}

async function loadReports() {
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const qs = from && to ? `?from=${from}&to=${to}` : '';

  const vatRes = await fetch('/api/reports/vat-return' + qs);
  const vat = await vatRes.json();
  document.getElementById('vatSummaryGrid').innerHTML = `
    <div class="p-3 bg-emerald-50 rounded border border-emerald-200">
      <div class="font-bold text-emerald-900">Output VAT (Sales - Returns)</div>
      <div>Gross Sales: ${Number(vat.sales?.sales_excl_vat || 0).toFixed(2)} SAR (VAT: ${Number(vat.sales?.sales_vat || 0).toFixed(2)})</div>
      <div>Sales Returns: ${Number(vat.sales?.returns_excl_vat || 0).toFixed(2)} SAR (VAT: ${Number(vat.sales?.returns_vat || 0).toFixed(2)})</div>
      <div class="font-bold mt-1 text-emerald-700">Net Output VAT: ${vat.net_output_vat} SAR</div>
    </div>
    <div class="p-3 bg-blue-50 rounded border border-blue-200">
      <div class="font-bold text-blue-900">Input VAT (Purchases - Returns)</div>
      <div>Purchases: ${Number(vat.purchases?.pur_excl_vat || 0).toFixed(2)} SAR (VAT: ${Number(vat.purchases?.pur_vat || 0).toFixed(2)})</div>
      <div>Purchase Returns: ${Number(vat.purchases?.pur_ret_excl_vat || 0).toFixed(2)} SAR (VAT: ${Number(vat.purchases?.pur_ret_vat || 0).toFixed(2)})</div>
      <div class="font-bold mt-1 text-blue-700">Net Input VAT: ${vat.net_input_vat} SAR</div>
    </div>
    <div class="p-3 bg-amber-50 rounded border border-amber-300 flex flex-col justify-center">
      <div class="font-bold text-amber-900">Net VAT Payable to ZATCA</div>
      <div class="text-2xl font-extrabold text-amber-700 mt-1">${vat.net_vat_payable} SAR</div>
    </div>
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

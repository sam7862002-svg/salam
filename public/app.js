let parties = [];
let products = [];
let cart = [];
let purCart = [];

async function init() {
  await loadSettings();
  await loadParties();
  await loadProducts();
  loadReports();
}

function showTab(tab) {
  document.querySelectorAll('.tab-section').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  if (tab === 'reports') loadReports();
}

function toggleReturnFields() {
  const docType = document.getElementById('saleDocType').value;
  const box = document.getElementById('creditNoteFields');
  if (docType.includes('CREDIT_NOTE')) box.classList.remove('hidden');
  else box.classList.add('hidden');
}

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
    private_key: document.getElementById('setPrivKey').value
  };
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  alert('ZATCA Settings Saved!');
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

  pSel.innerHTML = '<option value="">+ Select Product to Add...</option>';
  purSel.innerHTML = '<option value="">+ Add Product...</option>';
  tbody.innerHTML = '';

  products.forEach(pr => {
    const opt = `<option value="${pr.product_id}">${pr.name_en} - ${pr.selling_price} SAR</option>`;
    pSel.innerHTML += opt;
    purSel.innerHTML += `<option value="${pr.product_id}">${pr.name_en}</option>`;
    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2">${pr.barcode || '-'}</td>
      <td class="p-2">${pr.name_en} / ${pr.name_ar}</td>
      <td class="p-2">${pr.selling_price}</td>
      <td class="p-2">${pr.vat_rate}%</td>
      <td class="p-2 font-bold">${pr.stock_qty}</td>
    </tr>`;
  });
}

async function saveProduct() {
  const payload = {
    barcode: document.getElementById('prodBarcode').value,
    name_en: document.getElementById('prodNameEn').value,
    name_ar: document.getElementById('prodNameAr').value,
    cost_price: Number(document.getElementById('prodCost').value || 0),
    selling_price: Number(document.getElementById('prodPrice').value),
    vat_rate: Number(document.getElementById('prodVat').value || 15),
    stock_qty: Number(document.getElementById('prodStock').value || 0)
  };
  if (!payload.name_en || !payload.selling_price) return alert('Name & Price required');
  await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  loadProducts();
  alert('Product Saved!');
}

function addSelectedProductToCart() {
  const id = Number(document.getElementById('productSelect').value);
  if (!id) return;
  const prod = products.find(p => p.product_id === id);
  cart.push({
    product_id: prod.product_id,
    name_en: prod.name_en,
    name_ar: prod.name_ar,
    qty: 1,
    unit_price: Number(prod.selling_price),
    vat_rate: Number(prod.vat_rate)
  });
  document.getElementById('productSelect').value = '';
  renderCart();
}

function renderCart() {
  const tbody = document.getElementById('cartBody');
  tbody.innerHTML = '';
  let sub = 0, vat = 0;
  cart.forEach((item, idx) => {
    const lineSub = item.qty * item.unit_price;
    const lineVat = lineSub * (item.vat_rate / 100);
    sub += lineSub;
    vat += lineVat;
    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2">${item.name_en}<br><span class="text-xs text-slate-500">${item.name_ar}</span></td>
      <td class="p-2"><input type="number" value="${item.qty}" onchange="cart[${idx}].qty=Number(this.value);renderCart()" class="w-16 border p-1 rounded" /></td>
      <td class="p-2"><input type="number" value="${item.unit_price}" onchange="cart[${idx}].unit_price=Number(this.value);renderCart()" class="w-24 border p-1 rounded" /></td>
      <td class="p-2">${item.vat_rate}%</td>
      <td class="p-2 font-semibold">${(lineSub + lineVat).toFixed(2)}</td>
      <td class="p-2"><button onclick="cart.splice(${idx},1);renderCart()" class="text-red-600 font-bold">X</button></td>
    </tr>`;
  });
  document.getElementById('cartSub').innerText = sub.toFixed(2) + ' SAR';
  document.getElementById('cartVat').innerText = vat.toFixed(2) + ' SAR';
  document.getElementById('cartTotal').innerText = (sub + vat).toFixed(2) + ' SAR';
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
  renderCart();
  loadProducts();
  showReceipt(data);
}

function showReceipt({ sale, items, company }) {
  document.getElementById('recCompAr').innerText = company.company_name_ar;
  document.getElementById('recCompEn').innerText = company.company_name_en;
  document.getElementById('recVat').innerText = company.vat_number;
  document.getElementById('recDocType').innerText = sale.doc_type;
  document.getElementById('recInvNo').innerText = sale.invoice_number;
  document.getElementById('recIcv').innerText = sale.icv;
  document.getElementById('recDate').innerText = new Date(sale.created_at).toLocaleString();
  document.getElementById('recZatcaStatus').innerText = sale.zatca_status;
  document.getElementById('recSub').innerText = sale.subtotal;
  document.getElementById('recTax').innerText = sale.vat_amount;
  document.getElementById('recGrand').innerText = sale.grand_total;

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

function addProductToPurCart() {
  const id = Number(document.getElementById('purProductSelect').value);
  if (!id) return;
  const prod = products.find(p => p.product_id === id);
  purCart.push({
    product_id: prod.product_id,
    name_en: prod.name_en,
    qty: 1,
    unit_price: Number(prod.cost_price || prod.selling_price),
    vat_rate: Number(prod.vat_rate)
  });
  document.getElementById('purProductSelect').value = '';
  renderPurCart();
}

function renderPurCart() {
  const tbody = document.getElementById('purCartBody');
  tbody.innerHTML = '';
  purCart.forEach((item, idx) => {
    const tot = item.qty * item.unit_price * (1 + item.vat_rate / 100);
    tbody.innerHTML += `<tr class="border-t">
      <td class="p-2">${item.name_en}</td>
      <td class="p-2"><input type="number" value="${item.qty}" onchange="purCart[${idx}].qty=Number(this.value);renderPurCart()" class="w-20 border p-1 rounded" /></td>
      <td class="p-2"><input type="number" value="${item.unit_price}" onchange="purCart[${idx}].unit_price=Number(this.value);renderPurCart()" class="w-24 border p-1 rounded" /></td>
      <td class="p-2">${item.vat_rate}%</td>
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

async function loadReports() {
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const qs = from && to ? `?from=${from}&to=${to}` : '';

  const vatRes = await fetch('/api/reports/vat-return' + qs);
  const vat = await vatRes.json();
  document.getElementById('vatSummaryGrid').innerHTML = `
    <div class="p-3 bg-emerald-50 rounded border border-emerald-200">
      <div class="font-bold text-emerald-900">Output VAT (Sales - Returns)</div>
      <div>Gross Sales: ${vat.sales?.sales_excl_vat || 0} SAR (VAT: ${vat.sales?.sales_vat || 0})</div>
      <div>Sales Returns: ${vat.sales?.returns_excl_vat || 0} SAR (VAT: ${vat.sales?.returns_vat || 0})</div>
      <div class="font-bold mt-1 text-emerald-700">Net Output VAT: ${vat.net_output_vat} SAR</div>
    </div>
    <div class="p-3 bg-blue-50 rounded border border-blue-200">
      <div class="font-bold text-blue-900">Input VAT (Purchases - Returns)</div>
      <div>Purchases: ${vat.purchases?.pur_excl_vat || 0} SAR (VAT: ${vat.purchases?.pur_vat || 0})</div>
      <div>Purchase Returns: ${vat.purchases?.pur_ret_excl_vat || 0} SAR (VAT: ${vat.purchases?.pur_ret_vat || 0})</div>
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

init();

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const { generateZatcaXML } = require('./zatca/xmlGenerator');
const { generateInvoiceHash, signInvoiceHash, generatePhase2QR } = require('./zatca/signer');
const { submitToZatca } = require('./zatca/apiClient');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false
});

// Auto-ensure new columns exist if upgrading from v1
async function ensureSchema() {
  try {
    await pool.query(`
      ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS admin_pin VARCHAR(20) DEFAULT '1234';
      ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS cashier_pin VARCHAR(20) DEFAULT '0000';
    `);
  } catch (e) {
    console.log('Schema check note:', e.message);
  }
}
ensureSchema();

// Auto English-to-Arabic Translation Endpoint
app.get('/api/translate', async (req, res) => {
  const text = (req.query.text || '').trim();
  if (!text) return res.json({ arabic: '' });
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(text)}`;
    const response = await axios.get(url, { timeout: 5000 });
    const translated = response.data?.[0]?.map(part => part[0]).join('') || text;
    res.json({ arabic: translated });
  } catch (err) {
    res.json({ arabic: text });
  }
});

// Login Verification
app.post('/api/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const { rows } = await pool.query('SELECT admin_pin, cashier_pin FROM company_settings WHERE id = 1');
    const cfg = rows[0] || { admin_pin: '1234', cashier_pin: '0000' };
    if (pin === (cfg.admin_pin || '1234')) {
      return res.json({ success: true, role: 'ADMIN' });
    }
    if (pin === (cfg.cashier_pin || '0000')) {
      return res.json({ success: true, role: 'CASHIER' });
    }
    res.status(401).json({ success: false, message: 'Invalid PIN' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 1. Company & ZATCA Settings
app.get('/api/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM company_settings WHERE id = 1');
    res.json(rows[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/settings', async (req, res) => {
  const { company_name_en, company_name_ar, vat_number, cr_number, address_ar, zatca_env, csid_certificate, private_key, secret_key, admin_pin, cashier_pin } = req.body;
  try {
    await pool.query(
      `UPDATE company_settings SET 
        company_name_en=$1, company_name_ar=$2, vat_number=$3, cr_number=$4, 
        address_ar=$5, zatca_env=$6, csid_certificate=$7, private_key=$8, secret_key=$9,
        admin_pin=COALESCE($10, admin_pin), cashier_pin=COALESCE($11, cashier_pin)
       WHERE id = 1`,
      [company_name_en, company_name_ar, vat_number, cr_number, address_ar, zatca_env, csid_certificate, private_key, secret_key, admin_pin || '1234', cashier_pin || '0000']
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Parties (Customers & Vendors)
app.get('/api/parties', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM parties ORDER BY party_id ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/parties', async (req, res) => {
  const { party_type, name_en, name_ar, vat_number, cr_number, phone, address, opening_balance } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO parties (party_type, name_en, name_ar, vat_number, cr_number, phone, address, opening_balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [party_type, name_en, name_ar, vat_number || null, cr_number || null, phone || null, address || null, opening_balance || 0]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Products (Tax-Inclusive Selling Price)
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY product_id DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/products', async (req, res) => {
  const { barcode, name_en, name_ar, cost_price, selling_price, vat_rate, stock_qty } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (barcode, name_en, name_ar, cost_price, selling_price, vat_rate, stock_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (barcode) DO UPDATE SET
         name_en = EXCLUDED.name_en,
         name_ar = EXCLUDED.name_ar,
         cost_price = EXCLUDED.cost_price,
         selling_price = EXCLUDED.selling_price,
         vat_rate = EXCLUDED.vat_rate
       RETURNING *`,
      [barcode || null, name_en, name_ar, cost_price || 0, selling_price, vat_rate ?? 15, stock_qty || 0]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Create Sales Invoice or Sales Return (Tax-Inclusive Reverse VAT Calculation)
app.post('/api/sales', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { party_id, doc_type, original_invoice_ref, return_reason, payment_mode, items } = req.body;

    const compRes = await client.query('SELECT * FROM company_settings WHERE id = 1 FOR UPDATE');
    const company = compRes.rows[0];
    const nextIcv = Number(company.last_icv) + 1;
    const pih = company.last_pih;

    const partyRes = await client.query('SELECT * FROM parties WHERE party_id = $1', [party_id || 1]);
    const party = partyRes.rows[0];

    let subtotal = 0;     // Tax Exclusive
    let vat_amount = 0;   // 15% VAT extracted
    let grand_total = 0;  // Tax Inclusive

    const enrichedItems = items.map(it => {
      const qty = Number(it.qty);
      const inclUnitPrice = Number(it.unit_price); // Tax-Inclusive Selling Price
      const vatRate = Number(it.vat_rate ?? 15);
      const divisor = 1 + (vatRate / 100);

      const lineTotalIncl = qty * inclUnitPrice;
      const lineSubExcl = lineTotalIncl / divisor;
      const lineVat = lineTotalIncl - lineSubExcl;
      const baseUnitPrice = inclUnitPrice / divisor;

      subtotal += lineSubExcl;
      vat_amount += lineVat;
      grand_total += lineTotalIncl;

      return {
        ...it,
        base_unit_price: baseUnitPrice,
        base_subtotal: lineSubExcl,
        vat_amount: lineVat,
        line_total: lineTotalIncl
      };
    });

    const isCredit = doc_type.includes('CREDIT_NOTE');
    const prefix = isCredit ? 'CN' : 'INV';
    const invoice_number = `${prefix}-${String(nextIcv).padStart(6, '0')}`;
    const invoiceUuid = uuidv4();
    const createdAt = new Date().toISOString();

    const invoiceMeta = {
      invoice_number,
      icv: nextIcv,
      uuid: invoiceUuid,
      doc_type,
      original_invoice_ref,
      return_reason,
      subtotal,
      vat_amount,
      grand_total,
      pih,
      created_at: createdAt
    };

    const xmlContent = generateZatcaXML({ company, invoice: invoiceMeta, party, items: enrichedItems });
    const invoiceHash = generateInvoiceHash(xmlContent);
    const ecdsaSig = signInvoiceHash(invoiceHash, company.private_key);
    const qrBase64 = generatePhase2QR({
      sellerName: company.company_name_ar,
      vatNumber: company.vat_number,
      timestamp: createdAt,
      totalWithVat: grand_total,
      vatAmount: vat_amount,
      xmlHashBase64: invoiceHash,
      ecdsaSignatureBase64: ecdsaSig
    });

    const zatcaRes = await submitToZatca({
      company,
      uuid: invoiceUuid,
      invoiceHash,
      xmlContent,
      docType: doc_type
    });

    const saleInsert = await client.query(
      `INSERT INTO sales_transactions 
       (invoice_number, icv, uuid, party_id, doc_type, original_invoice_ref, return_reason, payment_mode,
        subtotal, vat_amount, grand_total, pih, invoice_hash, qr_code_base64, xml_content, zatca_status, zatca_response, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [invoice_number, nextIcv, invoiceUuid, party_id || 1, doc_type, original_invoice_ref || null, return_reason || null,
       payment_mode, subtotal.toFixed(2), vat_amount.toFixed(2), grand_total.toFixed(2),
       pih, invoiceHash, qrBase64, xmlContent, zatcaRes.status, JSON.stringify(zatcaRes), createdAt]
    );
    const savedSale = saleInsert.rows[0];

    for (const item of enrichedItems) {
      await client.query(
        `INSERT INTO transaction_items (ref_type, ref_id, product_id, qty, unit_price, vat_rate, vat_amount, line_total)
         VALUES ('SALE', $1, $2, $3, $4, $5, $6, $7)`,
        [savedSale.sale_id, item.product_id || null, item.qty, item.unit_price, item.vat_rate, item.vat_amount.toFixed(2), item.line_total.toFixed(2)]
      );
      if (item.product_id) {
        const stockDelta = isCredit ? Number(item.qty) : -Number(item.qty);
        await client.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE product_id = $2', [stockDelta, item.product_id]);
      }
    }

    await client.query('UPDATE company_settings SET last_icv = $1, last_pih = $2 WHERE id = 1', [nextIcv, invoiceHash]);

    await client.query('COMMIT');
    res.json({ sale: savedSale, items: enrichedItems, company, party });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Get Sales History & Single Invoice Details for Reprint / Return
app.get('/api/sales', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, p.name_en AS party_name, p.name_ar AS party_name_ar, p.vat_number AS party_vat, p.phone AS party_phone
      FROM sales_transactions s 
      LEFT JOIN parties p ON s.party_id = p.party_id 
      ORDER BY s.sale_id DESC LIMIT 150
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sales/:id', async (req, res) => {
  try {
    const saleRes = await pool.query(`
      SELECT s.*, p.name_en AS party_name, p.name_ar AS party_name_ar, p.vat_number AS party_vat, p.phone AS party_phone
      FROM sales_transactions s 
      LEFT JOIN parties p ON s.party_id = p.party_id 
      WHERE s.sale_id = $1
    `, [req.params.id]);
    const itemsRes = await pool.query(`
      SELECT ti.*, pr.name_en, pr.name_ar, pr.barcode
      FROM transaction_items ti
      LEFT JOIN products pr ON ti.product_id = pr.product_id
      WHERE ti.ref_type = 'SALE' AND ti.ref_id = $1
    `, [req.params.id]);
    const compRes = await pool.query('SELECT * FROM company_settings WHERE id = 1');

    const sale = saleRes.rows[0];
    res.json({
      sale,
      items: itemsRes.rows,
      company: compRes.rows[0],
      party: {
        party_id: sale.party_id,
        name_en: sale.party_name,
        name_ar: sale.party_name_ar,
        vat_number: sale.party_vat,
        phone: sale.party_phone
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Create Purchase or Purchase Return (Tax-Inclusive or Exclusive handled cleanly)
app.post('/api/purchases', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { supplier_inv_no, party_id, doc_type, original_purchase_ref, payment_mode, items } = req.body;

    let subtotal = 0;
    let vat_input = 0;
    let grand_total = 0;

    const enrichedItems = items.map(it => {
      const qty = Number(it.qty);
      const unitCostIncl = Number(it.unit_price); // Tax-inclusive cost
      const vatRate = Number(it.vat_rate ?? 15);
      const divisor = 1 + (vatRate / 100);

      const lineTotal = qty * unitCostIncl;
      const lineSub = lineTotal / divisor;
      const lineVat = lineTotal - lineSub;

      subtotal += lineSub;
      vat_input += lineVat;
      grand_total += lineTotal;

      return { ...it, vat_amount: lineVat, line_total: lineTotal };
    });

    const isReturn = doc_type === 'PURCHASE_RETURN';
    const voucher_number = `${isReturn ? 'PR' : 'PUR'}-${Date.now()}`;

    const purRes = await client.query(
      `INSERT INTO purchase_transactions (voucher_number, supplier_inv_no, party_id, doc_type, original_purchase_ref, payment_mode, subtotal, vat_input, grand_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [voucher_number, supplier_inv_no, party_id, doc_type, original_purchase_ref || null, payment_mode, subtotal.toFixed(2), vat_input.toFixed(2), grand_total.toFixed(2)]
    );
    const savedPur = purRes.rows[0];

    for (const item of enrichedItems) {
      await client.query(
        `INSERT INTO transaction_items (ref_type, ref_id, product_id, qty, unit_price, vat_rate, vat_amount, line_total)
         VALUES ('PURCHASE', $1, $2, $3, $4, $5, $6, $7)`,
        [savedPur.purchase_id, item.product_id || null, item.qty, item.unit_price, item.vat_rate, item.vat_amount.toFixed(2), item.line_total.toFixed(2)]
      );
      if (item.product_id) {
        const stockDelta = isReturn ? -Number(item.qty) : Number(item.qty);
        await client.query('UPDATE products SET stock_qty = stock_qty + $1, cost_price = $2 WHERE product_id = $3', [stockDelta, item.unit_price, item.product_id]);
      }
    }

    await client.query('COMMIT');
    res.json(savedPur);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// 6. Party Receipts & Payments
app.post('/api/vouchers', async (req, res) => {
  const { party_id, voucher_type, amount, payment_mode, notes } = req.body;
  try {
    const voucher_no = `${voucher_type === 'RECEIPT' ? 'RV' : 'PV'}-${Date.now()}`;
    const { rows } = await pool.query(
      `INSERT INTO party_vouchers (voucher_no, party_id, voucher_type, amount, payment_mode, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [voucher_no, party_id, voucher_type, amount, payment_mode, notes || null]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 7. Daily Closing / Z-Report
app.get('/api/reports/z-report', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const start = `${date} 00:00:00`;
  const end = `${date} 23:59:59`;
  try {
    const { rows } = await pool.query(`
      SELECT 
        payment_mode,
        COUNT(*) FILTER (WHERE doc_type IN ('B2B_INVOICE','B2C_INVOICE')) AS invoice_count,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN grand_total ELSE 0 END), 0) AS total_sales,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') THEN grand_total ELSE 0 END), 0) AS total_returns,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN vat_amount ELSE -vat_amount END), 0) AS net_vat
      FROM sales_transactions
      WHERE created_at BETWEEN $1 AND $2
      GROUP BY payment_mode
    `, [start, end]);
    res.json({ date, breakdown: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. Customer & Vendor Ledger / Register Report
app.get('/api/reports/party-register', async (req, res) => {
  const { from, to } = req.query;
  const startDate = from ? `${from} 00:00:00` : '2000-01-01 00:00:00';
  const endDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';

  try {
    const { rows } = await pool.query(`
      WITH sales_agg AS (
        SELECT party_id,
          SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN grand_total ELSE 0 END) AS gross_sales,
          SUM(CASE WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') THEN grand_total ELSE 0 END) AS sales_returns,
          SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN vat_amount ELSE -vat_amount END) AS net_output_vat,
          SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN grand_total ELSE -grand_total END) AS net_sales
        FROM sales_transactions
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY party_id
      ),
      pur_agg AS (
        SELECT party_id,
          SUM(CASE WHEN doc_type = 'PURCHASE' THEN grand_total ELSE 0 END) AS gross_purchases,
          SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN grand_total ELSE 0 END) AS purchase_returns,
          SUM(CASE WHEN doc_type = 'PURCHASE' THEN vat_input ELSE -vat_input END) AS net_input_vat,
          SUM(CASE WHEN doc_type = 'PURCHASE' THEN grand_total ELSE -grand_total END) AS net_purchases
        FROM purchase_transactions
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY party_id
      ),
      vouch_agg AS (
        SELECT party_id,
          SUM(CASE WHEN voucher_type = 'RECEIPT' THEN amount ELSE 0 END) AS receipts,
          SUM(CASE WHEN voucher_type = 'PAYMENT' THEN amount ELSE 0 END) AS payments
        FROM party_vouchers
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY party_id
      )
      SELECT 
        p.party_id, p.party_type, p.name_en, p.name_ar, p.vat_number, p.opening_balance,
        COALESCE(s.gross_sales, 0) AS gross_sales,
        COALESCE(s.sales_returns, 0) AS sales_returns,
        COALESCE(s.net_output_vat, 0) AS net_output_vat,
        COALESCE(s.net_sales, 0) AS net_sales,
        COALESCE(pur.gross_purchases, 0) AS gross_purchases,
        COALESCE(pur.purchase_returns, 0) AS purchase_returns,
        COALESCE(pur.net_input_vat, 0) AS net_input_vat,
        COALESCE(pur.net_purchases, 0) AS net_purchases,
        COALESCE(v.receipts, 0) AS receipts,
        COALESCE(v.payments, 0) AS payments,
        (p.opening_balance + COALESCE(s.net_sales, 0) - COALESCE(pur.net_purchases, 0) - COALESCE(v.receipts, 0) + COALESCE(v.payments, 0)) AS closing_balance
      FROM parties p
      LEFT JOIN sales_agg s ON p.party_id = s.party_id
      LEFT JOIN pur_agg pur ON p.party_id = pur.party_id
      LEFT JOIN vouch_agg v ON p.party_id = v.party_id
      ORDER BY p.party_id ASC
    `, [startDate, endDate]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 9. ZATCA VAT Return Filing Summary Report
app.get('/api/reports/vat-return', async (req, res) => {
  const { from, to } = req.query;
  const startDate = from ? `${from} 00:00:00` : '2000-01-01 00:00:00';
  const endDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';

  try {
    const salesVat = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN subtotal ELSE 0 END), 0) AS sales_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN vat_amount ELSE 0 END), 0) AS sales_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') THEN subtotal ELSE 0 END), 0) AS returns_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') THEN vat_amount ELSE 0 END), 0) AS returns_vat
      FROM sales_transactions
      WHERE created_at BETWEEN $1 AND $2
    `, [startDate, endDate]);

    const purVat = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN subtotal ELSE 0 END), 0) AS pur_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN vat_input ELSE 0 END), 0) AS pur_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN subtotal ELSE 0 END), 0) AS pur_ret_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN vat_input ELSE 0 END), 0) AS pur_ret_vat
      FROM purchase_transactions
      WHERE created_at BETWEEN $1 AND $2
    `, [startDate, endDate]);

    const s = salesVat.rows[0];
    const p = purVat.rows[0];
    const netOutputVat = Number(s.sales_vat) - Number(s.returns_vat);
    const netInputVat = Number(p.pur_vat) - Number(p.pur_ret_vat);

    res.json({
      sales: s,
      purchases: p,
      net_output_vat: netOutputVat.toFixed(2),
      net_input_vat: netInputVat.toFixed(2),
      net_vat_payable: (netOutputVat - netInputVat).toFixed(2)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 10. Separate Excel (.xlsx) Exports for VAT Filing (Sales, Sales Return, Purchase, Purchase Return)
app.get('/api/reports/export-excel', async (req, res) => {
  const { type, from, to } = req.query;
  const startDate = from ? `${from} 00:00:00` : '2000-01-01 00:00:00';
  const endDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';

  try {
    let rows = [];
    let sheetName = 'Report';
    let fileName = `ZATCA_${type}_${from || 'ALL'}_to_${to || 'ALL'}.xlsx`;

    if (type === 'SALES') {
      const q = await pool.query(`
        SELECT s.invoice_number AS "Invoice No", s.icv AS "ICV", TO_CHAR(s.created_at, 'YYYY-MM-DD HH24:MI') AS "Date",
               s.doc_type AS "Type", p.name_en AS "Customer", p.vat_number AS "Customer VAT",
               s.payment_mode AS "Payment", s.subtotal AS "Taxable Amount (SAR)", s.vat_amount AS "VAT 15% (SAR)",
               s.grand_total AS "Total Incl VAT (SAR)", s.zatca_status AS "ZATCA Status", s.uuid AS "UUID"
        FROM sales_transactions s LEFT JOIN parties p ON s.party_id = p.party_id
        WHERE s.doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND s.created_at BETWEEN $1 AND $2
        ORDER BY s.sale_id ASC
      `, [startDate, endDate]);
      rows = q.rows;
      sheetName = 'Sales_Register';
    } else if (type === 'SALES_RETURN') {
      const q = await pool.query(`
        SELECT s.invoice_number AS "Credit Note No", s.original_invoice_ref AS "Original Invoice",
               TO_CHAR(s.created_at, 'YYYY-MM-DD HH24:MI') AS "Date", s.doc_type AS "Type",
               p.name_en AS "Customer", p.vat_number AS "Customer VAT", s.return_reason AS "Reason",
               s.subtotal AS "Taxable Amount (SAR)", s.vat_amount AS "VAT 15% (SAR)",
               s.grand_total AS "Total Return (SAR)", s.zatca_status AS "ZATCA Status"
        FROM sales_transactions s LEFT JOIN parties p ON s.party_id = p.party_id
        WHERE s.doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') AND s.created_at BETWEEN $1 AND $2
        ORDER BY s.sale_id ASC
      `, [startDate, endDate]);
      rows = q.rows;
      sheetName = 'Sales_Returns';
    } else if (type === 'PURCHASE') {
      const q = await pool.query(`
        SELECT pur.voucher_number AS "Voucher No", pur.supplier_inv_no AS "Supplier Invoice No",
               TO_CHAR(pur.created_at, 'YYYY-MM-DD HH24:MI') AS "Date",
               p.name_en AS "Vendor", p.vat_number AS "Vendor VAT", pur.payment_mode AS "Payment",
               pur.subtotal AS "Taxable Amount (SAR)", pur.vat_input AS "Input VAT 15% (SAR)",
               pur.grand_total AS "Total Incl VAT (SAR)"
        FROM purchase_transactions pur LEFT JOIN parties p ON pur.party_id = p.party_id
        WHERE pur.doc_type = 'PURCHASE' AND pur.created_at BETWEEN $1 AND $2
        ORDER BY pur.purchase_id ASC
      `, [startDate, endDate]);
      rows = q.rows;
      sheetName = 'Purchase_Register';
    } else if (type === 'PURCHASE_RETURN') {
      const q = await pool.query(`
        SELECT pur.voucher_number AS "Debit Note No", pur.supplier_inv_no AS "Supplier Ref No",
               TO_CHAR(pur.created_at, 'YYYY-MM-DD HH24:MI') AS "Date",
               p.name_en AS "Vendor", p.vat_number AS "Vendor VAT", pur.payment_mode AS "Payment",
               pur.subtotal AS "Taxable Amount (SAR)", pur.vat_input AS "Input VAT 15% (SAR)",
               pur.grand_total AS "Total Return (SAR)"
        FROM purchase_transactions pur LEFT JOIN parties p ON pur.party_id = p.party_id
        WHERE pur.doc_type = 'PURCHASE_RETURN' AND pur.created_at BETWEEN $1 AND $2
        ORDER BY pur.purchase_id ASC
      `, [startDate, endDate]);
      rows = q.rows;
      sheetName = 'Purchase_Returns';
    }

    if (!rows.length) {
      rows = [{ Message: 'No records found for selected date range' }];
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Saudi ZATCA Phase 2 POS v2.0 running on port ${PORT}`));

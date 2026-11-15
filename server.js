require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
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
  const { company_name_en, company_name_ar, vat_number, cr_number, address_ar, zatca_env, csid_certificate, private_key, secret_key } = req.body;
  try {
    await pool.query(
      `UPDATE company_settings SET 
        company_name_en=$1, company_name_ar=$2, vat_number=$3, cr_number=$4, 
        address_ar=$5, zatca_env=$6, csid_certificate=$7, private_key=$8, secret_key=$9
       WHERE id = 1`,
      [company_name_en, company_name_ar, vat_number, cr_number, address_ar, zatca_env, csid_certificate, private_key, secret_key]
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

// 3. Products
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
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [barcode || null, name_en, name_ar, cost_price || 0, selling_price, vat_rate ?? 15, stock_qty || 0]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Create Sales Invoice or Sales Return (Credit Note) with ZATCA Phase 2
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

    let subtotal = 0;
    let vat_amount = 0;
    const enrichedItems = items.map(it => {
      const lineSub = Number(it.qty) * Number(it.unit_price);
      const lineVat = lineSub * (Number(it.vat_rate) / 100);
      subtotal += lineSub;
      vat_amount += lineVat;
      return {
        ...it,
        vat_amount: lineVat,
        line_total: lineSub + lineVat
      };
    });
    const grand_total = subtotal + vat_amount;

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

    // Generate Phase 2 XML, Hash, Signature & 9-Tag QR
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

    // Submit to ZATCA Phase 2 API
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

    // Update ICV & PIH chain
    await client.query('UPDATE company_settings SET last_icv = $1, last_pih = $2 WHERE id = 1', [nextIcv, invoiceHash]);

    await client.query('COMMIT');
    res.json({ sale: savedSale, items: enrichedItems, company });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/sales', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, p.name_en AS party_name, p.vat_number AS party_vat 
      FROM sales_transactions s 
      LEFT JOIN parties p ON s.party_id = p.party_id 
      ORDER BY s.sale_id DESC LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Create Purchase or Purchase Return (Debit Note)
app.post('/api/purchases', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { supplier_inv_no, party_id, doc_type, original_purchase_ref, payment_mode, items } = req.body;

    let subtotal = 0;
    let vat_input = 0;
    const enrichedItems = items.map(it => {
      const lineSub = Number(it.qty) * Number(it.unit_price);
      const lineVat = lineSub * (Number(it.vat_rate) / 100);
      subtotal += lineSub;
      vat_input += lineVat;
      return { ...it, vat_amount: lineVat, line_total: lineSub + lineVat };
    });
    const grand_total = subtotal + vat_input;

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

app.get('/api/purchases', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pur.*, p.name_en AS party_name, p.vat_number AS party_vat 
      FROM purchase_transactions pur 
      LEFT JOIN parties p ON pur.party_id = p.party_id 
      ORDER BY pur.purchase_id DESC LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
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

// 7. Customer & Vendor Ledger / Register Report
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

// 8. ZATCA VAT Return Filing Summary Report
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Saudi ZATCA Phase 2 POS running on port ${PORT}`));

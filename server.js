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
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false
});

// Auto-Heal & Migrate Database Tables on Boot (Prevents 'last_icv' undefined error permanently)
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name_en VARCHAR(150) NOT NULL DEFAULT 'My Retail Store',
        company_name_ar VARCHAR(150) NOT NULL DEFAULT 'متجر التجزئة',
        vat_number VARCHAR(15) NOT NULL DEFAULT '300000000000003',
        cr_number VARCHAR(20) DEFAULT '1010000000',
        address_ar TEXT DEFAULT 'جدة، المملكة العربية السعودية',
        zatca_env VARCHAR(20) DEFAULT 'SANDBOX',
        csid_certificate TEXT,
        private_key TEXT,
        secret_key TEXT,
        admin_pin VARCHAR(20) DEFAULT '1234',
        cashier_pin VARCHAR(20) DEFAULT '0000',
        last_icv INTEGER DEFAULT 0,
        last_pih TEXT DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='
      );
      ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS admin_pin VARCHAR(20) DEFAULT '1234';
      ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS cashier_pin VARCHAR(20) DEFAULT '0000';
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS prev_balance NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS new_balance NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS created_by VARCHAR(100) DEFAULT 'Admin';
      ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS return_reason TEXT;

      CREATE TABLE IF NOT EXISTS staff_users (
        user_id SERIAL PRIMARY KEY,
        staff_name VARCHAR(100) NOT NULL,
        role VARCHAR(15) CHECK (role IN ('ADMIN', 'CASHIER')) NOT NULL,
        pin VARCHAR(20) UNIQUE NOT NULL,
        active BOOLEAN DEFAULT TRUE
      );

      INSERT INTO company_settings (id, company_name_en, company_name_ar, vat_number, last_icv)
      VALUES (1, 'Saudi Retail Store', 'متجر التجزئة السعودي', '300000000000003', 0)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO parties (party_id, party_type, name_en, name_ar, opening_balance)
      VALUES (1, 'CUSTOMER', 'WALK-IN CASH CUSTOMER', 'عميل نقدي', 0.00)
      ON CONFLICT (party_id) DO NOTHING;

      INSERT INTO staff_users (staff_name, role, pin) VALUES ('Owner / Admin', 'ADMIN', '1234') ON CONFLICT (pin) DO NOTHING;
      INSERT INTO staff_users (staff_name, role, pin) VALUES ('Counter Cashier 1', 'CASHIER', '0000') ON CONFLICT (pin) DO NOTHING;
    `);
    console.log('Database verified & auto-healed.');
  } catch (e) {
    console.error('DB Init Notice:', e.message);
  }
}
initializeDatabase();

// Helper: Calculate live net balance of a party (+ = Receivable from customer, - = Payable to vendor)
async function getPartyLiveBalance(clientOrPool, partyId) {
  const { rows } = await clientOrPool.query(`
    SELECT 
      p.opening_balance
      + COALESCE((SELECT SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='CREDIT' THEN grand_total
                                  WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') AND payment_mode='CREDIT' THEN -grand_total
                                  ELSE 0 END) FROM sales_transactions WHERE party_id = p.party_id), 0)
      - COALESCE((SELECT SUM(CASE WHEN doc_type = 'PURCHASE' AND payment_mode='CREDIT' THEN grand_total
                                  WHEN doc_type = 'PURCHASE_RETURN' AND payment_mode='CREDIT' THEN -grand_total
                                  ELSE 0 END) FROM purchase_transactions WHERE party_id = p.party_id), 0)
      - COALESCE((SELECT SUM(CASE WHEN voucher_type = 'RECEIPT' THEN amount ELSE 0 END) FROM party_vouchers WHERE party_id = p.party_id), 0)
      + COALESCE((SELECT SUM(CASE WHEN voucher_type = 'PAYMENT' THEN amount ELSE 0 END) FROM party_vouchers WHERE party_id = p.party_id), 0)
      AS current_balance
    FROM parties p WHERE p.party_id = $1
  `, [partyId]);
  return rows.length ? Number(rows[0].current_balance) : 0;
}

// 0. Login Verification (Supports Multi-Staff Table + Master Settings PIN)
app.post('/api/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const staffRes = await pool.query('SELECT * FROM staff_users WHERE pin = $1 AND active = TRUE', [pin]);
    if (staffRes.rows.length) {
      return res.json({ role: staffRes.rows[0].role, staff_name: staffRes.rows[0].staff_name });
    }
    const { rows } = await pool.query('SELECT admin_pin, cashier_pin FROM company_settings WHERE id = 1');
    const cfg = rows[0] || { admin_pin: '1234', cashier_pin: '0000' };
    if (pin === (cfg.admin_pin || '1234')) return res.json({ role: 'ADMIN', staff_name: 'Admin' });
    if (pin === (cfg.cashier_pin || '0000')) return res.json({ role: 'CASHIER', staff_name: 'Cashier' });
    return res.status(401).json({ error: 'Invalid PIN' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Staff Users Management
app.get('/api/staff', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM staff_users ORDER BY user_id ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/staff', async (req, res) => {
  const { staff_name, role, pin } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO staff_users (staff_name, role, pin) VALUES ($1, $2, $3) RETURNING *',
      [staff_name.toUpperCase(), role, pin]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/staff/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM staff_users WHERE user_id = $1', [req.params.id]);
    res.json({ success: true });
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
        admin_pin=$10, cashier_pin=$11
       WHERE id = 1`,
      [company_name_en, company_name_ar, vat_number, cr_number, address_ar, zatca_env, csid_certificate, private_key, secret_key, admin_pin || '1234', cashier_pin || '0000']
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Parties (Customers & Vendors with Live Balance, Edit, Delete & Bulk Import)
app.get('/api/parties', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        p.*,
        (p.opening_balance
         + COALESCE((SELECT SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='CREDIT' THEN grand_total
                                     WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') AND payment_mode='CREDIT' THEN -grand_total
                                     ELSE 0 END) FROM sales_transactions WHERE party_id = p.party_id), 0)
         - COALESCE((SELECT SUM(CASE WHEN doc_type = 'PURCHASE' AND payment_mode='CREDIT' THEN grand_total
                                     WHEN doc_type = 'PURCHASE_RETURN' AND payment_mode='CREDIT' THEN -grand_total
                                     ELSE 0 END) FROM purchase_transactions WHERE party_id = p.party_id), 0)
         - COALESCE((SELECT SUM(CASE WHEN voucher_type = 'RECEIPT' THEN amount ELSE 0 END) FROM party_vouchers WHERE party_id = p.party_id), 0)
         + COALESCE((SELECT SUM(CASE WHEN voucher_type = 'PAYMENT' THEN amount ELSE 0 END) FROM party_vouchers WHERE party_id = p.party_id), 0)
        ) AS current_balance
      FROM parties p
      ORDER BY p.party_id ASC
    `);
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
      [party_type, (name_en || '').toUpperCase(), name_ar, vat_number || null, cr_number || null, phone || null, address || null, opening_balance || 0]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/parties/:id', async (req, res) => {
  const { party_type, name_en, name_ar, vat_number, phone, opening_balance } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE parties SET party_type=$1, name_en=$2, name_ar=$3, vat_number=$4, phone=$5, opening_balance=$6
       WHERE party_id=$7 RETURNING *`,
      [party_type, (name_en || '').toUpperCase(), name_ar, vat_number || null, phone || null, opening_balance || 0, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/parties/:id', async (req, res) => {
  if (Number(req.params.id) === 1) return res.status(400).json({ error: 'Cannot delete default Walk-in Customer' });
  try {
    await pool.query('DELETE FROM parties WHERE party_id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Cannot delete party with existing invoices/purchases. Edit instead.' });
  }
});

app.post('/api/parties/bulk', async (req, res) => {
  const { list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Invalid list' });
  let count = 0;
  for (const p of list) {
    if (!p.name_en) continue;
    await pool.query(
      `INSERT INTO parties (party_type, name_en, name_ar, vat_number, phone, opening_balance)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [p.party_type || 'CUSTOMER', String(p.name_en).toUpperCase(), p.name_ar || '', p.vat_number || null, p.phone || null, Number(p.opening_balance || 0)]
    );
    count++;
  }
  res.json({ inserted: count });
});

// 3. Products (ALL CAPS, Edit, Delete, Bulk Excel Upload)
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
  const upperName = (name_en || '').toUpperCase().trim();
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
      [barcode ? barcode.trim() : null, upperName, name_ar || upperName, cost_price || 0, selling_price, vat_rate ?? 15, stock_qty || 0]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const { barcode, name_en, name_ar, cost_price, selling_price, vat_rate, stock_qty } = req.body;
  const upperName = (name_en || '').toUpperCase().trim();
  try {
    const { rows } = await pool.query(
      `UPDATE products SET barcode=$1, name_en=$2, name_ar=$3, cost_price=$4, selling_price=$5, vat_rate=$6, stock_qty=$7
       WHERE product_id=$8 RETURNING *`,
      [barcode ? barcode.trim() : null, upperName, name_ar || upperName, cost_price || 0, selling_price, vat_rate ?? 15, stock_qty || 0, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE product_id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Cannot delete product used in existing invoices.' });
  }
});

app.post('/api/products/bulk', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Invalid items' });
  let count = 0;
  for (const it of items) {
    if (!it.name_en || !it.selling_price) continue;
    const upperName = String(it.name_en).toUpperCase().trim();
    const barcode = it.barcode ? String(it.barcode).trim() : null;
    await pool.query(
      `INSERT INTO products (barcode, name_en, name_ar, cost_price, selling_price, vat_rate, stock_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (barcode) DO UPDATE SET
         name_en = EXCLUDED.name_en,
         name_ar = EXCLUDED.name_ar,
         cost_price = EXCLUDED.cost_price,
         selling_price = EXCLUDED.selling_price,
         stock_qty = products.stock_qty + EXCLUDED.stock_qty`,
      [barcode, upperName, it.name_ar || upperName, Number(it.cost_price || 0), Number(it.selling_price), Number(it.vat_rate ?? 15), Number(it.stock_qty || 0)]
    );
    count++;
  }
  res.json({ imported: count });
});

// 4. Create Sales Invoice or Sales Return (Credit Note) with Balance Tracking & ZATCA Phase 2
app.post('/api/sales', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { party_id, doc_type, original_invoice_ref, return_reason, payment_mode, items, created_by } = req.body;

    // Ensure company_settings row 1 exists
    await client.query(`
      INSERT INTO company_settings (id, company_name_en, company_name_ar, vat_number, last_icv)
      VALUES (1, 'Saudi Retail Store', 'متجر التجزئة السعودي', '300000000000003', 0)
      ON CONFLICT (id) DO NOTHING;
    `);

    const compRes = await client.query('SELECT * FROM company_settings WHERE id = 1 FOR UPDATE');
    const company = compRes.rows[0];
    const nextIcv = Number(company.last_icv || 0) + 1;
    const pih = company.last_pih;

    const targetPartyId = party_id || 1;
    const partyRes = await client.query('SELECT * FROM parties WHERE party_id = $1', [targetPartyId]);
    const party = partyRes.rows[0];

    const prevBalance = await getPartyLiveBalance(client, targetPartyId);

    let subtotalExcl = 0;
    let totalVat = 0;
    let grandTotalIncl = 0;

    const enrichedItems = items.map(it => {
      const qty = Number(it.qty);
      const unitPriceIncl = Number(it.unit_price);
      const vatRate = Number(it.vat_rate ?? 15);
      const lineTotalIncl = qty * unitPriceIncl;
      const lineSubExcl = lineTotalIncl / (1 + vatRate / 100);
      const lineVat = lineTotalIncl - lineSubExcl;
      const unitPriceExcl = unitPriceIncl / (1 + vatRate / 100);

      subtotalExcl += lineSubExcl;
      totalVat += lineVat;
      grandTotalIncl += lineTotalIncl;

      return {
        ...it,
        qty,
        unit_price_incl: unitPriceIncl,
        unit_price_excl: unitPriceExcl,
        line_sub_excl: lineSubExcl,
        vat_rate: vatRate,
        vat_amount: lineVat,
        line_total: lineTotalIncl
      };
    });

    const isCreditNote = doc_type.includes('CREDIT_NOTE');
    const prefix = isCreditNote ? 'CN' : 'INV';
    const invoice_number = `${prefix}-${String(nextIcv).padStart(6, '0')}`;
    const invoiceUuid = uuidv4();
    const createdAt = new Date().toISOString();

    let newBalance = prevBalance;
    if (payment_mode === 'CREDIT') {
      newBalance = isCreditNote ? (prevBalance - grandTotalIncl) : (prevBalance + grandTotalIncl);
    }

    const invoiceMeta = {
      invoice_number,
      icv: nextIcv,
      uuid: invoiceUuid,
      doc_type,
      original_invoice_ref,
      return_reason,
      subtotal: subtotalExcl,
      vat_amount: totalVat,
      grand_total: grandTotalIncl,
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
      totalWithVat: grandTotalIncl,
      vatAmount: totalVat,
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
        subtotal, vat_amount, grand_total, prev_balance, new_balance, created_by, pih, invoice_hash, qr_code_base64, xml_content, zatca_status, zatca_response, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [invoice_number, nextIcv, invoiceUuid, targetPartyId, doc_type, original_invoice_ref || null, return_reason || null,
       payment_mode, subtotalExcl.toFixed(2), totalVat.toFixed(2), grandTotalIncl.toFixed(2),
       prevBalance.toFixed(2), newBalance.toFixed(2), created_by || 'Admin',
       pih, invoiceHash, qrBase64, xmlContent, zatcaRes.status, JSON.stringify(zatcaRes), createdAt]
    );
    const savedSale = saleInsert.rows[0];

    for (const item of enrichedItems) {
      await client.query(
        `INSERT INTO transaction_items (ref_type, ref_id, product_id, qty, unit_price, vat_rate, vat_amount, line_total)
         VALUES ('SALE', $1, $2, $3, $4, $5, $6, $7)`,
        [savedSale.sale_id, item.product_id || null, item.qty, item.unit_price_incl.toFixed(2), item.vat_rate, item.vat_amount.toFixed(2), item.line_total.toFixed(2)]
      );
      if (item.product_id) {
        const stockDelta = isCreditNote ? Number(item.qty) : -Number(item.qty);
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

app.get('/api/sales', async (req, res) => {
  const { from, to } = req.query;
  try {
    let query = `
      SELECT s.*, p.name_en AS party_name, p.name_ar AS party_name_ar, p.vat_number AS party_vat, p.phone AS party_phone
      FROM sales_transactions s 
      LEFT JOIN parties p ON s.party_id = p.party_id 
    `;
    const params = [];
    if (from && to) {
      query += ` WHERE s.created_at BETWEEN $1 AND $2 `;
      params.push(`${from} 00:00:00`, `${to} 23:59:59`);
    }
    query += ` ORDER BY s.sale_id DESC LIMIT 200`;
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sales/:id', async (req, res) => {
  try {
    const saleRes = await pool.query('SELECT * FROM sales_transactions WHERE sale_id = $1', [req.params.id]);
    if (!saleRes.rows.length) return res.status(404).json({ error: 'Invoice not found' });
    const sale = saleRes.rows[0];

    const compRes = await pool.query('SELECT * FROM company_settings WHERE id = 1');
    const partyRes = await pool.query('SELECT * FROM parties WHERE party_id = $1', [sale.party_id]);
    const itemsRes = await pool.query(`
      SELECT ti.*, pr.name_en, pr.name_ar, pr.barcode
      FROM transaction_items ti
      LEFT JOIN products pr ON ti.product_id = pr.product_id
      WHERE ti.ref_type = 'SALE' AND ti.ref_id = $1
    `, [sale.sale_id]);

    const items = itemsRes.rows.map(it => {
      const unitPriceIncl = Number(it.unit_price);
      const vatRate = Number(it.vat_rate);
      const unitPriceExcl = unitPriceIncl / (1 + vatRate / 100);
      return { ...it, unit_price_incl: unitPriceIncl, unit_price_excl: unitPriceExcl };
    });

    res.json({ sale, items, company: compRes.rows[0], party: partyRes.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Create Purchase or Purchase Return (Debit Note)
app.post('/api/purchases', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { supplier_inv_no, party_id, doc_type, original_purchase_ref, return_reason, payment_mode, items } = req.body;

    let subtotalExcl = 0;
    let vatInputTotal = 0;
    let grandTotalIncl = 0;

    const enrichedItems = items.map(it => {
      const qty = Number(it.qty);
      const unitPriceIncl = Number(it.unit_price);
      const vatRate = Number(it.vat_rate ?? 15);
      const lineTotalIncl = qty * unitPriceIncl;
      const lineSubExcl = lineTotalIncl / (1 + vatRate / 100);
      const lineVat = lineTotalIncl - lineSubExcl;

      subtotalExcl += lineSubExcl;
      vatInputTotal += lineVat;
      grandTotalIncl += lineTotalIncl;

      return { ...it, qty, unit_price_incl: unitPriceIncl, vat_rate: vatRate, vat_amount: lineVat, line_total: lineTotalIncl };
    });

    const isReturn = doc_type === 'PURCHASE_RETURN';
    const voucher_number = `${isReturn ? 'PR' : 'PUR'}-${Date.now()}`;

    const purRes = await client.query(
      `INSERT INTO purchase_transactions (voucher_number, supplier_inv_no, party_id, doc_type, original_purchase_ref, return_reason, payment_mode, subtotal, vat_input, grand_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [voucher_number, supplier_inv_no, party_id, doc_type, original_purchase_ref || null, return_reason || null, payment_mode, subtotalExcl.toFixed(2), vatInputTotal.toFixed(2), grandTotalIncl.toFixed(2)]
    );
    const savedPur = purRes.rows[0];

    for (const item of enrichedItems) {
      await client.query(
        `INSERT INTO transaction_items (ref_type, ref_id, product_id, qty, unit_price, vat_rate, vat_amount, line_total)
         VALUES ('PURCHASE', $1, $2, $3, $4, $5, $6, $7)`,
        [savedPur.purchase_id, item.product_id || null, item.qty, item.unit_price_incl.toFixed(2), item.vat_rate, item.vat_amount.toFixed(2), item.line_total.toFixed(2)]
      );
      if (item.product_id) {
        const stockDelta = isReturn ? -Number(item.qty) : Number(item.qty);
        await client.query('UPDATE products SET stock_qty = stock_qty + $1, cost_price = $2 WHERE product_id = $3', [stockDelta, item.unit_price_incl.toFixed(2), item.product_id]);
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
  const { from, to } = req.query;
  try {
    let query = `
      SELECT pur.*, p.name_en AS party_name, p.vat_number AS party_vat 
      FROM purchase_transactions pur 
      LEFT JOIN parties p ON pur.party_id = p.party_id 
    `;
    const params = [];
    if (from && to) {
      query += ` WHERE pur.created_at BETWEEN $1 AND $2 `;
      params.push(`${from} 00:00:00`, `${to} 23:59:59`);
    }
    query += ` ORDER BY pur.purchase_id DESC LIMIT 200`;
    const { rows } = await pool.query(query, params);
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

// 7. Customer & Vendor Register Report
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
          SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='CREDIT' THEN grand_total
                   WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') AND payment_mode='CREDIT' THEN -grand_total ELSE 0 END) AS credit_sales_net
        FROM sales_transactions
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY party_id
      ),
      pur_agg AS (
        SELECT party_id,
          SUM(CASE WHEN doc_type = 'PURCHASE' THEN grand_total ELSE 0 END) AS gross_purchases,
          SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN grand_total ELSE 0 END) AS purchase_returns,
          SUM(CASE WHEN doc_type = 'PURCHASE' THEN vat_input ELSE -vat_input END) AS net_input_vat,
          SUM(CASE WHEN doc_type = 'PURCHASE' AND payment_mode='CREDIT' THEN grand_total
                   WHEN doc_type = 'PURCHASE_RETURN' AND payment_mode='CREDIT' THEN -grand_total ELSE 0 END) AS credit_pur_net
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
        COALESCE(pur.gross_purchases, 0) AS gross_purchases,
        COALESCE(pur.purchase_returns, 0) AS purchase_returns,
        COALESCE(pur.net_input_vat, 0) AS net_input_vat,
        COALESCE(v.receipts, 0) AS receipts,
        COALESCE(v.payments, 0) AS payments,
        (p.opening_balance + COALESCE(s.credit_sales_net, 0) - COALESCE(pur.credit_pur_net, 0) - COALESCE(v.receipts, 0) + COALESCE(v.payments, 0)) AS closing_balance
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

// 8. ZATCA VAT Return Filing Summary Report & Daily Z-Report
app.get('/api/reports/vat-return', async (req, res) => {
  const { from, to } = req.query;
  const startDate = from ? `${from} 00:00:00` : '2000-01-01 00:00:00';
  const endDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';

  try {
    const salesVat = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN subtotal ELSE 0 END), 0) AS sales_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN vat_amount ELSE 0 END), 0) AS sales_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN grand_total ELSE 0 END), 0) AS sales_incl_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') THEN subtotal ELSE 0 END), 0) AS returns_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') THEN vat_amount ELSE 0 END), 0) AS returns_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') THEN grand_total ELSE 0 END), 0) AS returns_incl_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='CASH' THEN grand_total ELSE 0 END), 0) AS cash_sales,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='MADA' THEN grand_total ELSE 0 END), 0) AS mada_sales,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='CREDIT' THEN grand_total ELSE 0 END), 0) AS credit_sales,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='BANK' THEN grand_total ELSE 0 END), 0) AS bank_sales
      FROM sales_transactions
      WHERE created_at BETWEEN $1 AND $2
    `, [startDate, endDate]);

    const purVat = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN subtotal ELSE 0 END), 0) AS pur_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN vat_input ELSE 0 END), 0) AS pur_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN grand_total ELSE 0 END), 0) AS pur_incl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN subtotal ELSE 0 END), 0) AS pur_ret_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN vat_input ELSE 0 END), 0) AS pur_ret_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN grand_total ELSE 0 END), 0) AS pur_ret_incl_vat
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
app.listen(PORT, () => console.log(`Saudi ZATCA Phase 2 POS v3 running on port ${PORT}`));

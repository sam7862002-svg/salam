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
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false
});

const INITIAL_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name_en VARCHAR(150) NOT NULL DEFAULT 'My Retail Store',
        company_name_ar VARCHAR(150) NOT NULL DEFAULT 'متجر التجزئة',
        shop_phone VARCHAR(30) DEFAULT '',
        vat_number VARCHAR(15) NOT NULL DEFAULT '300000000000003',
        cr_number VARCHAR(20) DEFAULT '1010000000',
        address_ar TEXT DEFAULT 'جدة، المملكة العربية السعودية',
        building_no VARCHAR(10) DEFAULT '',
        street_name VARCHAR(100) DEFAULT '',
        district VARCHAR(100) DEFAULT '',
        city VARCHAR(100) DEFAULT 'Jeddah',
        postal_code VARCHAR(10) DEFAULT '',
        additional_no VARCHAR(10) DEFAULT '',
        bank_name VARCHAR(100) DEFAULT '',
        bank_account_no VARCHAR(60) DEFAULT '',
        bank_iban VARCHAR(60) DEFAULT '',
        paper_size VARCHAR(10) DEFAULT '80mm',
        auto_print BOOLEAN DEFAULT TRUE,
        zatca_env VARCHAR(20) DEFAULT 'SANDBOX',
        csid_certificate TEXT,
        private_key TEXT,
        secret_key TEXT,
        admin_pin VARCHAR(20) DEFAULT '1234',
        cashier_pin VARCHAR(20) DEFAULT '0000',
        master_reset_pass VARCHAR(30) DEFAULT 'admin123',
        last_icv INTEGER DEFAULT 0,
        last_pih TEXT DEFAULT '${INITIAL_PIH}'
      );

      ALTER TABLE parties ADD COLUMN IF NOT EXISTS account_mode VARCHAR(15) CHECK (account_mode IN ('CASH', 'CREDIT')) DEFAULT 'CREDIT';
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS prev_balance NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS new_balance NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS created_by VARCHAR(100) DEFAULT 'Admin';

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

      INSERT INTO parties (party_id, party_type, account_mode, name_en, name_ar, opening_balance)
      VALUES (1, 'CUSTOMER', 'CASH', 'WALK-IN CASH CUSTOMER', 'عميل نقدي', 0.00)
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

// --- LOGIN API (Fixed & Robust) ---
app.post('/api/login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  try {
    const staffRes = await pool.query('SELECT * FROM staff_users WHERE pin = $1 AND active = TRUE', [pin]);
    if (staffRes.rows.length > 0) {
      return res.json({ role: staffRes.rows[0].role, staff_name: staffRes.rows[0].staff_name });
    }
    const { rows } = await pool.query('SELECT admin_pin, cashier_pin FROM company_settings WHERE id = 1');
    const cfg = rows[0] || { admin_pin: '1234', cashier_pin: '0000' };
    
    if (pin === (cfg.admin_pin || '1234')) {
      return res.json({ role: 'ADMIN', staff_name: 'Admin' });
    }
    if (pin === (cfg.cashier_pin || '0000')) {
      return res.json({ role: 'CASHIER', staff_name: 'Cashier' });
    }
    return res.status(401).json({ error: 'Invalid PIN' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.get('/api/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM company_settings WHERE id = 1');
    res.json(rows[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/settings', async (req, res) => {
  const {
    company_name_en, company_name_ar, shop_phone, vat_number, cr_number, address_ar,
    building_no, street_name, district, city, postal_code, additional_no,
    bank_name, bank_account_no, bank_iban, paper_size, auto_print,
    zatca_env, csid_certificate, private_key, secret_key, admin_pin, cashier_pin, master_reset_pass, cutoff_hour
  } = req.body;
  try {
    await pool.query(
      `UPDATE company_settings SET 
        company_name_en=$1, company_name_ar=$2, shop_phone=$3, vat_number=$4, cr_number=$5, 
        address_ar=$6, building_no=$7, street_name=$8, district=$9, city=$10, postal_code=$11, additional_no=$12,
        bank_name=$13, bank_account_no=$14, bank_iban=$15, paper_size=$16, auto_print=$17,
        zatca_env=$18, csid_certificate=$19, private_key=$20, secret_key=$21,
        admin_pin=$22, cashier_pin=$23, master_reset_pass=$24, cutoff_hour=$25
       WHERE id = 1`,
      [
        company_name_en, company_name_ar, shop_phone || '', vat_number, cr_number,
        address_ar, building_no || '', street_name || '', district || '', city || 'Jeddah', postal_code || '', additional_no || '',
        bank_name || '', bank_account_no || '', bank_iban || '',
        paper_size || '80mm', auto_print !== false,
        zatca_env, csid_certificate, private_key, secret_key,
        admin_pin || '1234', cashier_pin || '0000', master_reset_pass || 'admin123', cutoff_hour ?? 6
      ]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
  const { party_type, account_mode, name_en, name_ar, vat_number, cr_number, phone, address, opening_balance } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO parties (party_type, account_mode, name_en, name_ar, vat_number, cr_number, phone, address, opening_balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [party_type, account_mode || 'CREDIT', (name_en || '').toUpperCase(), name_ar, vat_number || null, cr_number || null, phone || null, address || null, opening_balance || 0]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/parties/:id', async (req, res) => {
  const { party_type, account_mode, name_en, name_ar, vat_number, phone, opening_balance } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE parties SET party_type=$1, account_mode=$2, name_en=$3, name_ar=$4, vat_number=$5, phone=$6, opening_balance=$7
       WHERE party_id=$8 RETURNING *`,
      [party_type, account_mode || 'CREDIT', (name_en || '').toUpperCase(), name_ar, vat_number || null, phone || null, opening_balance || 0, req.params.id]
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
    res.status(400).json({ error: 'Cannot delete party with existing invoices/purchases.' });
  }
});

app.post('/api/parties/bulk', async (req, res) => {
  const { list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Invalid list' });
  let count = 0;
  for (const p of list) {
    if (!p.name_en) continue;
    await pool.query(
      `INSERT INTO parties (party_type, account_mode, name_en, name_ar, vat_number, phone, opening_balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [p.party_type || 'CUSTOMER', p.account_mode || 'CREDIT', String(p.name_en).toUpperCase(), p.name_ar || '', p.vat_number || null, p.phone || null, Number(p.opening_balance || 0)]
    );
    count++;
  }
  res.json({ inserted: count });
});

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
         vat_rate = EXCLUDED.vat_rate,
         stock_qty = products.stock_qty + EXCLUDED.stock_qty
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

app.post('/api/sales', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { party_id, doc_type, original_invoice_ref, return_reason, payment_mode, items, created_by } = req.body;

    const compRes = await client.query('SELECT * FROM company_settings WHERE id = 1 FOR UPDATE');
    const company = compRes.rows[0];
    const nextIcv = Number(company.last_icv || 0) + 1;
    const pih = company.last_pih || INITIAL_PIH;

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
    const isB2B = doc_type.startsWith('B2B');
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

    let zatcaRes = { status: 'PENDING_REPORT', mode: 'INSTANT_QUEUE' };
    if (company.zatca_env) {
      zatcaRes = await submitToZatca({
        company,
        uuid: invoiceUuid,
        invoiceHash,
        xmlContent,
        docType: doc_type
      });
    }

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

app.post('/api/zatca/sync-batch', async (req, res) => {
  const compRes = await pool.query('SELECT * FROM company_settings WHERE id = 1');
  const company = compRes.rows[0];
  const pending = await pool.query("SELECT * FROM sales_transactions WHERE zatca_status IN ('PENDING_REPORT', 'PENDING', 'FAILED') LIMIT 100");
  let synced = 0;
  for (const inv of pending.rows) {
    const zRes = await submitToZatca({ company, uuid: inv.uuid, invoiceHash: inv.invoice_hash, xmlContent: inv.xml_content, docType: inv.doc_type });
    await pool.query('UPDATE sales_transactions SET zatca_status = $1, zatca_response = $2 WHERE sale_id = $3', [zRes.status, JSON.stringify(zRes), inv.sale_id]);
    if (zRes.status === 'REPORTED' || zRes.status === 'CLEARED') synced++;
  }
  res.json({ total_checked: pending.rows.length, synced });
});

app.get('/api/sales', async (req, res) => {
  const { from, to } = req.query;
  try {
    let query = `SELECT s.*, p.name_en AS party_name, p.vat_number AS party_vat, p.phone AS party_phone FROM sales_transactions s LEFT JOIN parties p ON s.party_id = p.party_id`;
    const params = [];
    if (from && to) {
      query += ` WHERE s.created_at BETWEEN $1 AND $2`;
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
    if (!saleRes.rows.length) return res.status(404).json({ error: 'Not found' });
    const sale = saleRes.rows[0];
    const compRes = await pool.query('SELECT * FROM company_settings WHERE id = 1');
    const partyRes = await pool.query('SELECT * FROM parties WHERE party_id = $1', [sale.party_id]);
    const itemsRes = await pool.query(`SELECT ti.*, pr.name_en, pr.name_ar FROM transaction_items ti LEFT JOIN products pr ON ti.product_id = pr.product_id WHERE ti.ref_type = 'SALE' AND ti.ref_id = $1`, [sale.sale_id]);
    res.json({ sale, items: itemsRes.rows, company: compRes.rows[0], party: partyRes.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sales/:id/xml', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT invoice_number, xml_content FROM sales_transactions WHERE sale_id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${rows[0].invoice_number}_ZATCA.xml"`);
    res.send(rows[0].xml_content);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post('/api/purchases', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { supplier_inv_no, party_id, doc_type, original_purchase_ref, return_reason, payment_mode, items } = req.body;
    let subtotalExcl = 0, vatInputTotal = 0, grandTotalIncl = 0;
    const enrichedItems = items.map(it => {
      const qty = Number(it.qty);
      const unitExcl = Number(it.unit_price);
      const vatRate = Number(it.vat_rate ?? 15);
      const lineBase = qty * unitExcl;
      const lineVat = lineBase * (vatRate / 100);
      const lineIncl = lineBase + lineVat;
      subtotalExcl += lineBase;
      vatInputTotal += lineVat;
      grandTotalIncl += lineIncl;
      return { ...it, qty, unit_price: unitExcl * (1 + vatRate/100), unit_price_excl: unitExcl, vat_rate: vatRate, vat_amount: lineVat, line_total: lineIncl };
    });
    const voucher_number = `${doc_type === 'PURCHASE_RETURN' ? 'PR' : 'PUR'}-${Date.now()}`;
    const purRes = await client.query(
      `INSERT INTO purchase_transactions (voucher_number, supplier_inv_no, party_id, doc_type, original_purchase_ref, return_reason, payment_mode, subtotal, vat_input, grand_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [voucher_number, supplier_inv_no, party_id, doc_type, original_purchase_ref || null, return_reason || null, payment_mode, subtotalExcl.toFixed(2), vatInputTotal.toFixed(2), grandTotalIncl.toFixed(2)]
    );
    const savedPur = purRes.rows[0];
    for (const item of enrichedItems) {
      await client.query(`INSERT INTO transaction_items (ref_type, ref_id, product_id, qty, unit_price, vat_rate, vat_amount, line_total) VALUES ('PURCHASE', $1, $2, $3, $4, $5, $6, $7)`,
        [savedPur.purchase_id, item.product_id || null, item.qty, item.unit_price.toFixed(2), item.vat_rate, item.vat_amount.toFixed(2), item.line_total.toFixed(2)]);
      if (item.product_id) {
        const delta = doc_type === 'PURCHASE_RETURN' ? -Number(item.qty) : Number(item.qty);
        await client.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE product_id = $2', [delta, item.product_id]);
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
    let query = `SELECT pur.*, p.name_en AS party_name, p.vat_number AS party_vat FROM purchase_transactions pur LEFT JOIN parties p ON pur.party_id = p.party_id`;
    const params = [];
    if (from && to) { query += ` WHERE pur.created_at BETWEEN $1 AND $2`; params.push(`${from} 00:00:00`, `${to} 23:59:59`); }
    query += ` ORDER BY pur.purchase_id DESC LIMIT 200`;
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vouchers', async (req, res) => {
  const { party_id, voucher_type, amount, payment_mode, notes } = req.body;
  try {
    const voucher_no = `${voucher_type === 'RECEIPT' ? 'RV' : 'PV'}-${Date.now()}`;
    const { rows } = await pool.query(
      `INSERT INTO party_vouchers (voucher_no, party_id, voucher_type, amount, payment_mode, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [voucher_no, party_id, voucher_type, amount, payment_mode, notes || null]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reports/party-register', async (req, res) => {
  const { from, to } = req.query;
  const compSettingRes = await pool.query('SELECT cutoff_hour FROM company_settings WHERE id = 1');
  const cutoffH = compSettingRes.rows[0]?.cutoff_hour ?? 6;
  const startDate = from ? `${from} ${String(cutoffH).padStart(2, '0')}:00:00` : '2000-01-01 00:00:00';
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
        FROM sales_transactions WHERE created_at BETWEEN $1 AND $2 GROUP BY party_id
      ),
      pur_agg AS (
        SELECT party_id,
          SUM(CASE WHEN doc_type = 'PURCHASE' THEN grand_total ELSE 0 END) AS gross_purchases,
          SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN grand_total ELSE 0 END) AS purchase_returns,
          SUM(CASE WHEN doc_type = 'PURCHASE' THEN vat_input ELSE -vat_input END) AS net_input_vat,
          SUM(CASE WHEN doc_type = 'PURCHASE' AND payment_mode='CREDIT' THEN grand_total
                   WHEN doc_type = 'PURCHASE_RETURN' AND payment_mode='CREDIT' THEN -grand_total ELSE 0 END) AS credit_pur_net
        FROM purchase_transactions WHERE created_at BETWEEN $1 AND $2 GROUP BY party_id
      ),
      vouch_agg AS (
        SELECT party_id,
          SUM(CASE WHEN voucher_type = 'RECEIPT' THEN amount ELSE 0 END) AS receipts,
          SUM(CASE WHEN voucher_type = 'PAYMENT' THEN amount ELSE 0 END) AS payments
        FROM party_vouchers WHERE created_at BETWEEN $1 AND $2 GROUP BY party_id
      )
      SELECT 
        p.party_id, p.party_type, p.name_en, p.name_ar, p.vat_number, p.opening_balance,
        COALESCE(s.gross_sales, 0) AS gross_sales, COALESCE(s.sales_returns, 0) AS sales_returns, COALESCE(s.net_output_vat, 0) AS net_output_vat,
        COALESCE(pur.gross_purchases, 0) AS gross_purchases, COALESCE(pur.purchase_returns, 0) AS purchase_returns, COALESCE(pur.net_input_vat, 0) AS net_input_vat,
        COALESCE(v.receipts, 0) AS receipts, COALESCE(v.payments, 0) AS payments,
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

app.get('/api/reports/vat-return', async (req, res) => {
  const { from, to } = req.query;
  const compSettingRes = await pool.query('SELECT cutoff_hour FROM company_settings WHERE id = 1');
  const cutoffH = compSettingRes.rows[0]?.cutoff_hour ?? 6;
  const startDate = from ? `${from} ${String(cutoffH).padStart(2, '0')}:00:00` : '2000-01-01 00:00:00';
  const endDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';
  try {
    const salesVat = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN subtotal ELSE 0 END), 0) AS sales_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') THEN vat_amount ELSE 0 END), 0) AS sales_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') THEN subtotal ELSE 0 END), 0) AS returns_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') THEN vat_amount ELSE 0 END), 0) AS returns_vat,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='CASH' THEN grand_total ELSE 0 END), 0) AS cash_sales,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='MADA' THEN grand_total ELSE 0 END), 0) AS mada_sales,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='CREDIT' THEN grand_total ELSE 0 END), 0) AS credit_sales,
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='BANK' THEN grand_total ELSE 0 END), 0) AS bank_sales,
        COALESCE(COUNT(*) FILTER (WHERE zatca_status IN ('PENDING_REPORT','PENDING','FAILED')), 0) AS pending_zatca_count
      FROM sales_transactions WHERE created_at BETWEEN $1 AND $2
    `, [startDate, endDate]);

    const purVat = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN subtotal ELSE 0 END), 0) AS pur_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN vat_input ELSE 0 END), 0) AS pur_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN subtotal ELSE 0 END), 0) AS pur_ret_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN vat_input ELSE 0 END), 0) AS pur_ret_vat
      FROM purchase_transactions WHERE created_at BETWEEN $1 AND $2
    `, [startDate, endDate]);

    const s = salesVat.rows[0];
    const p = purVat.rows[0];
    const netOutputVat = Number(s.sales_vat) - Number(s.returns_vat);
    const netInputVat = Number(p.pur_vat) - Number(p.pur_ret_vat);
    res.json({ sales: s, purchases: p, net_output_vat: netOutputVat.toFixed(2), net_input_vat: netInputVat.toFixed(2), net_vat_payable: (netOutputVat - netInputVat).toFixed(2) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/system/backup', async (req, res) => {
  try {
    const settings = await pool.query('SELECT * FROM company_settings');
    const staff = await pool.query('SELECT * FROM staff_users');
    const parties = await pool.query('SELECT * FROM parties');
    const products = await pool.query('SELECT * FROM products');
    const sales = await pool.query('SELECT * FROM sales_transactions');
    const purchases = await pool.query('SELECT * FROM purchase_transactions');
    const items = await pool.query('SELECT * FROM transaction_items');
    const vouchers = await pool.query('SELECT * FROM party_vouchers');

    const backupObj = {
      version: '15.0.0',
      exported_at: new Date().toISOString(),
      data: { company_settings: settings.rows, staff_users: staff.rows, parties: parties.rows, products: products.rows, sales_transactions: sales.rows, purchase_transactions: purchases.rows, transaction_items: items.rows, party_vouchers: vouchers.rows }
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="ZATCA_POS_Backup_${new Date().toISOString().slice(0,10)}.json"`);
    res.send(JSON.stringify(backupObj, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/system/restore', async (req, res) => {
  const { data, master_password } = req.body;
  const settingsRes = await pool.query('SELECT master_reset_pass FROM company_settings WHERE id = 1');
  const correctPass = settingsRes.rows[0]?.master_reset_pass || 'admin123';
  if (master_password !== correctPass) return res.status(401).json({ error: 'Incorrect Master Password' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE transaction_items, party_vouchers, sales_transactions, purchase_transactions, products, parties, staff_users RESTART IDENTITY CASCADE');
    for (const s of (data.staff_users || [])) {
      await client.query('INSERT INTO staff_users (staff_name, role, pin, active) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [s.staff_name, s.role, s.pin, s.active !== false]);
    }
    for (const p of (data.parties || [])) {
      await client.query('INSERT INTO parties (party_id, party_type, account_mode, name_en, name_ar, vat_number, cr_number, phone, address, opening_balance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [p.party_id, p.party_type, p.account_mode || 'CREDIT', p.name_en, p.name_ar, p.vat_number, p.cr_number, p.phone, p.address, p.opening_balance || 0]);
    }
    await client.query("SELECT setval('parties_party_id_seq', COALESCE((SELECT MAX(party_id) FROM parties), 1))");
    for (const pr of (data.products || [])) {
      await client.query('INSERT INTO products (product_id, barcode, name_en, name_ar, cost_price, selling_price, vat_rate, stock_qty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [pr.product_id, pr.barcode, pr.name_en, pr.name_ar, pr.cost_price || 0, pr.selling_price, pr.vat_rate ?? 15, pr.stock_qty || 0]);
    }
    await client.query("SELECT setval('products_product_id_seq', COALESCE((SELECT MAX(product_id) FROM products), 1))");
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/system/reset-transactions', async (req, res) => {
  const { keepMasterData, master_password } = req.body;
  const settingsRes = await pool.query('SELECT master_reset_pass FROM company_settings WHERE id = 1');
  const correctPass = settingsRes.rows[0]?.master_reset_pass || 'admin123';
  if (master_password !== correctPass) return res.status(401).json({ error: 'Incorrect Master Password' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE transaction_items, party_vouchers, sales_transactions, purchase_transactions RESTART IDENTITY CASCADE');
    if (!keepMasterData) {
      await client.query('TRUNCATE TABLE products, parties RESTART IDENTITY CASCADE');
      await client.query("INSERT INTO parties (party_id, party_type, account_mode, name_en, name_ar, opening_balance) VALUES (1, 'CUSTOMER', 'CASH', 'WALK-IN CASH CUSTOMER', 'عميل نقدي', 0.00) ON CONFLICT DO NOTHING");
    } else {
      await client.query('UPDATE parties SET opening_balance = 0.00');
    }
    await client.query('UPDATE company_settings SET last_icv = 0, last_pih = $1 WHERE id = 1', [INITIAL_PIH]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Saudi ZATCA POS v15 running on port ${PORT}`));

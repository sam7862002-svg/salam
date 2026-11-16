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

const INITIAL_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shops (
        shop_id SERIAL PRIMARY KEY,
        shop_name_en VARCHAR(150) NOT NULL DEFAULT 'Main Branch',
        shop_name_ar VARCHAR(150) NOT NULL DEFAULT 'الفرع الرئيسي',
        vat_number VARCHAR(15) NOT NULL DEFAULT '300000000000003',
        cr_number VARCHAR(20) DEFAULT '1010000000',
        address_ar TEXT DEFAULT 'جدة، المملكة العربية السعودية',
        building_no VARCHAR(10) DEFAULT '1234',
        street_name VARCHAR(100) DEFAULT 'شارع الملك فهد',
        district VARCHAR(100) DEFAULT 'العليا',
        city VARCHAR(100) DEFAULT 'Jeddah',
        postal_code VARCHAR(10) DEFAULT '12345',
        additional_no VARCHAR(10) DEFAULT '1234',
        bank_name VARCHAR(100) DEFAULT 'مصرف الراجحي',
        bank_account_no VARCHAR(60) DEFAULT 'SA0380000000123456789012',
        bank_iban VARCHAR(60) DEFAULT 'SA0380000000123456789012',
        is_zatca_enabled BOOLEAN DEFAULT TRUE,
        zatca_env VARCHAR(20) DEFAULT 'SANDBOX',
        csid_certificate TEXT,
        private_key TEXT,
        secret_key TEXT,
        last_icv INTEGER DEFAULT 0,
        last_pih TEXT DEFAULT '${INITIAL_PIH}'
      );

      INSERT INTO shops (shop_id, shop_name_en, shop_name_ar, vat_number)
      VALUES 
        (1, 'Main Branch (ZATCA Phase 2)', 'الفرع الرئيسي (مفعل ضريبي)', '300000000000003'),
        (2, 'Branch 2 (GRD / Standard)', 'الفرع الثاني (عادي / غير مدرج)', '300000000000003')
      ON CONFLICT (shop_id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        master_reset_pass VARCHAR(30) DEFAULT 'admin123',
        cutoff_hour INTEGER DEFAULT 6,
        paper_size VARCHAR(10) DEFAULT '80mm',
        auto_print BOOLEAN DEFAULT TRUE
      );

      INSERT INTO company_settings (id, master_reset_pass, cutoff_hour)
      VALUES (1, 'admin123', 6)
      ON CONFLICT (id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS staff_users (
        user_id SERIAL PRIMARY KEY,
        staff_name VARCHAR(100) NOT NULL,
        role VARCHAR(15) CHECK (role IN ('ADMIN', 'CASHIER')) NOT NULL,
        pin VARCHAR(20) UNIQUE NOT NULL,
        shop_id INTEGER REFERENCES shops(shop_id) DEFAULT 1,
        active BOOLEAN DEFAULT TRUE
      );

      ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(shop_id) DEFAULT 1;

      INSERT INTO staff_users (staff_name, role, pin, shop_id) VALUES ('Owner / Admin', 'ADMIN', '1234', 1) ON CONFLICT (pin) DO NOTHING;
      INSERT INTO staff_users (staff_name, role, pin, shop_id) VALUES ('Counter Cashier Shop 1', 'CASHIER', '0000', 1) ON CONFLICT (pin) DO NOTHING;
      INSERT INTO staff_users (staff_name, role, pin, shop_id) VALUES ('Cashier Shop 2 (GRD)', 'CASHIER', '1111', 2) ON CONFLICT (pin) DO NOTHING;

      ALTER TABLE parties ADD COLUMN IF NOT EXISTS account_mode VARCHAR(15) CHECK (account_mode IN ('CASH', 'CREDIT')) DEFAULT 'CREDIT';

      
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_icv INTEGER DEFAULT 0;
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_pih TEXT DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_zatca_enabled BOOLEAN DEFAULT TRUE;

      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(shop_id) DEFAULT 1;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS prev_balance NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS new_balance NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS created_by VARCHAR(100) DEFAULT 'Admin';

      ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(shop_id) DEFAULT 1;
      ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS return_reason TEXT;
    `);
    console.log('Multi-Shop Database verified & auto-healed.');
  } catch (e) {
    console.error('DB Init Notice:', e.message);
  }
}
initializeDatabase();

// API Endpoints for Shops Management
app.get('/api/shops', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shops ORDER BY shop_id ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/shops', async (req, res) => {
  const {
    shop_name_en, shop_name_ar, vat_number, cr_number, address_ar,
    building_no, street_name, district, city, postal_code, additional_no,
    bank_name, bank_account_no, bank_iban, is_zatca_enabled, zatca_env, csid_certificate, private_key, secret_key, shop_id
  } = req.body;
  try {
    if (shop_id) {
      await pool.query(
        `UPDATE shops SET 
          shop_name_en=$1, shop_name_ar=$2, vat_number=$3, cr_number=$4, address_ar=$5,
          building_no=$6, street_name=$7, district=$8, city=$9, postal_code=$10, additional_no=$11,
          bank_name=$12, bank_account_no=$13, bank_iban=$14, is_zatca_enabled=$15, zatca_env=$16,
          csid_certificate=$17, private_key=$18, secret_key=$19
         WHERE shop_id=$20`,
        [
          shop_name_en, shop_name_ar, vat_number, cr_number, address_ar,
          building_no, street_name, district, city, postal_code, additional_no,
          bank_name, bank_account_no, bank_iban, is_zatca_enabled !== false, zatca_env,
          csid_certificate, private_key, secret_key, shop_id
        ]
      );
      res.json({ success: true, shop_id });
    } else {
      const { rows } = await pool.query(
        `INSERT INTO shops (shop_name_en, shop_name_ar, vat_number, cr_number, address_ar, is_zatca_enabled)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [shop_name_en, shop_name_ar, vat_number, cr_number, address_ar, is_zatca_enabled !== false]
      );
      res.json(rows[0]);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const staffRes = await pool.query('SELECT s.*, sh.shop_name_en, sh.shop_name_ar FROM staff_users s LEFT JOIN shops sh ON s.shop_id = sh.shop_id WHERE s.pin = $1 AND s.active = TRUE', [pin]);
    if (staffRes.rows.length) {
      const u = staffRes.rows[0];
      return res.json({ role: u.role, staff_name: u.staff_name, shop_id: u.shop_id || 1, shop_name: u.shop_name_en });
    }
    const { rows } = await pool.query('SELECT admin_pin, cashier_pin FROM company_settings WHERE id = 1');
    const cfg = rows[0] || { admin_pin: '1234', cashier_pin: '0000' };
    if (pin === (cfg.admin_pin || '1234')) return res.json({ role: 'ADMIN', staff_name: 'Admin', shop_id: 1, shop_name: 'Main Branch' });
    if (pin === (cfg.cashier_pin || '0000')) return res.json({ role: 'CASHIER', staff_name: 'Cashier', shop_id: 1, shop_name: 'Main Branch' });
    return res.status(401).json({ error: 'Invalid PIN' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/staff', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT s.*, sh.shop_name_en FROM staff_users s LEFT JOIN shops sh ON s.shop_id = sh.shop_id ORDER BY s.user_id ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/staff', async (req, res) => {
  const { staff_name, role, pin, shop_id } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO staff_users (staff_name, role, pin, shop_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [staff_name.toUpperCase(), role, pin, shop_id || 1]
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
  const { cutoff_hour, master_reset_pass, paper_size, auto_print } = req.body;
  try {
    await pool.query(
      `UPDATE company_settings SET cutoff_hour=$1, master_reset_pass=$2, paper_size=$3, auto_print=$4 WHERE id = 1`,
      [cutoff_hour ?? 6, master_reset_pass || 'admin123', paper_size || '80mm', auto_print !== false]
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
    const { shop_id, party_id, doc_type, original_invoice_ref, return_reason, payment_mode, items, created_by } = req.body;
    const targetShopId = Number(shop_id || 1);

    const shopRes = await client.query('SELECT * FROM shops WHERE shop_id = $1 FOR UPDATE', [targetShopId]);
    const shop = shopRes.rows[0];
    if (!shop) throw new Error('Shop not found');

    const nextIcv = Number(shop.last_icv || 0) + 1;
    const pih = shop.last_pih || INITIAL_PIH;

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
    const invoice_number = `${prefix}-${targetShopId}-${String(nextIcv).padStart(6, '0')}`;
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

    const xmlContent = generateZatcaXML({ shop, invoice: invoiceMeta, party, items: enrichedItems });
    const invoiceHash = generateInvoiceHash(xmlContent);
    const ecdsaSig = signInvoiceHash(invoiceHash, shop.private_key);
    const qrBase64 = generatePhase2QR({
      sellerName: shop.shop_name_ar,
      vatNumber: shop.vat_number,
      timestamp: createdAt,
      totalWithVat: grandTotalIncl,
      vatAmount: totalVat,
      xmlHashBase64: invoiceHash,
      ecdsaSignatureBase64: ecdsaSig
    });

    let zatcaRes = { status: 'PENDING_REPORT', mode: 'INSTANT_QUEUE' };
    if (shop.is_zatca_enabled) {
      zatcaRes = await submitToZatca({
        shop,
        uuid: invoiceUuid,
        invoiceHash,
        xmlContent,
        docType: doc_type
      });
    } else {
      zatcaRes = { status: 'GRD_CLEARED', mode: 'NON_ZATCA_BRANCH' };
    }

    const saleInsert = await client.query(
      `INSERT INTO sales_transactions 
       (invoice_number, icv, uuid, shop_id, party_id, doc_type, original_invoice_ref, return_reason, payment_mode,
        subtotal, vat_amount, grand_total, prev_balance, new_balance, created_by, pih, invoice_hash, qr_code_base64, xml_content, zatca_status, zatca_response, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [invoice_number, nextIcv, invoiceUuid, targetShopId, targetPartyId, doc_type, original_invoice_ref || null, return_reason || null,
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

    await client.query('UPDATE shops SET last_icv = $1, last_pih = $2 WHERE shop_id = $3', [nextIcv, invoiceHash, targetShopId]);
    await client.query('COMMIT');

    res.json({ sale: savedSale, items: enrichedItems, shop, party });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/sales', async (req, res) => {
  const { from, to, shop_id } = req.query;
  try {
    let query = `
      SELECT s.*, p.name_en AS party_name, p.name_ar AS party_name_ar, p.vat_number AS party_vat, p.phone AS party_phone, sh.shop_name_en
      FROM sales_transactions s 
      LEFT JOIN parties p ON s.party_id = p.party_id 
      LEFT JOIN shops sh ON s.shop_id = sh.shop_id
    `;
    const params = [];
    const conditions = [];
    if (from && to) {
      conditions.push(`s.created_at BETWEEN $${params.length + 1} AND $${params.length + 2}`);
      params.push(`${from} 00:00:00`, `${to} 23:59:59`);
    }
    if (shop_id && shop_id !== 'ALL') {
      conditions.push(`s.shop_id = $${params.length + 1}`);
      params.push(Number(shop_id));
    }
    if (conditions.length) {
      query += ` WHERE ` + conditions.join(' AND ');
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
    const saleRes = await pool.query('SELECT s.*, sh.* FROM sales_transactions s LEFT JOIN shops sh ON s.shop_id = sh.shop_id WHERE s.sale_id = $1', [req.params.id]);
    if (!saleRes.rows.length) return res.status(404).json({ error: 'Invoice not found' });
    const sale = saleRes.rows[0];

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

    res.json({ sale, items, shop: sale, party: partyRes.rows[0] });
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
    const { shop_id, supplier_inv_no, party_id, doc_type, original_purchase_ref, return_reason, payment_mode, items } = req.body;
    const targetShopId = Number(shop_id || 1);

    let subtotalExcl = 0;
    let vatInputTotal = 0;
    let grandTotalIncl = 0;

    const enrichedItems = items.map(it => {
      const qty = Number(it.qty);
      const unitPriceExcl = Number(it.unit_price);
      const vatRate = Number(it.vat_rate ?? 15);
      const lineSubExcl = qty * unitPriceExcl;
      const lineVat = lineSubExcl * (vatRate / 100);
      const lineTotalIncl = lineSubExcl + lineVat;
      const unitPriceIncl = unitPriceExcl * (1 + vatRate / 100);

      subtotalExcl += lineSubExcl;
      vatInputTotal += lineVat;
      grandTotalIncl += lineTotalIncl;

      return { ...it, qty, unit_price: unitPriceIncl, unit_price_excl: unitPriceExcl, vat_rate: vatRate, vat_amount: lineVat, line_total: lineTotalIncl };
    });

    const isReturn = doc_type === 'PURCHASE_RETURN';
    const voucher_number = `${isReturn ? 'PR' : 'PUR'}-${targetShopId}-${Date.now()}`;

    const purRes = await client.query(
      `INSERT INTO purchase_transactions (shop_id, voucher_number, supplier_inv_no, party_id, doc_type, original_purchase_ref, return_reason, payment_mode, subtotal, vat_input, grand_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [targetShopId, voucher_number, supplier_inv_no, party_id, doc_type, original_purchase_ref || null, return_reason || null, payment_mode, subtotalExcl.toFixed(2), vatInputTotal.toFixed(2), grandTotalIncl.toFixed(2)]
    );
    const savedPur = purRes.rows[0];

    for (const item of enrichedItems) {
      await client.query(
        `INSERT INTO transaction_items (ref_type, ref_id, product_id, qty, unit_price, vat_rate, vat_amount, line_total)
         VALUES ('PURCHASE', $1, $2, $3, $4, $5, $6, $7)`,
        [savedPur.purchase_id, item.product_id || null, item.qty, item.unit_price.toFixed(2), item.vat_rate, item.vat_amount.toFixed(2), item.line_total.toFixed(2)]
      );
      if (item.product_id) {
        const stockDelta = isReturn ? -Number(item.qty) : Number(item.qty);
        await client.query('UPDATE products SET stock_qty = stock_qty + $1, cost_price = $2 WHERE product_id = $3', [stockDelta, item.unit_price.toFixed(2), item.product_id]);
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
  const { from, to, shop_id } = req.query;
  try {
    let query = `
      SELECT pur.*, p.name_en AS party_name, p.vat_number AS party_vat, sh.shop_name_en 
      FROM purchase_transactions pur 
      LEFT JOIN parties p ON pur.party_id = p.party_id 
      LEFT JOIN shops sh ON pur.shop_id = sh.shop_id
    `;
    const params = [];
    const conditions = [];
    if (from && to) {
      conditions.push(`pur.created_at BETWEEN $${params.length + 1} AND $${params.length + 2}`);
      params.push(`${from} 00:00:00`, `${to} 23:59:59`);
    }
    if (shop_id && shop_id !== 'ALL') {
      conditions.push(`pur.shop_id = $${params.length + 1}`);
      params.push(Number(shop_id));
    }
    if (conditions.length) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
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
      `INSERT INTO party_vouchers (voucher_no, party_id, voucher_type, amount, payment_mode, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [voucher_no, party_id, voucher_type, amount, payment_mode, notes || null]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reports/party-register', async (req, res) => {
  const { from, to, shop_id } = req.query;
  const compSettingRes = await pool.query('SELECT cutoff_hour FROM company_settings WHERE id = 1');
  const cutoffH = compSettingRes.rows[0]?.cutoff_hour ?? 6;
  const startDate = from ? `${from} ${String(cutoffH).padStart(2, '0')}:00:00` : '2000-01-01 00:00:00';
  const endDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';

  let shopFilterSales = '';
  let shopFilterPur = '';
  const params = [startDate, endDate];

  if (shop_id && shop_id !== 'ALL') {
    params.push(Number(shop_id));
    shopFilterSales = ` AND shop_id = $3 `;
    shopFilterPur = ` AND shop_id = $3 `;
  }

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
        WHERE created_at BETWEEN $1 AND $2 ${shopFilterSales}
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
        WHERE created_at BETWEEN $1 AND $2 ${shopFilterPur}
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
    `, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reports/vat-return', async (req, res) => {
  const { from, to, shop_id } = req.query;
  const compSettingRes = await pool.query('SELECT cutoff_hour FROM company_settings WHERE id = 1');
  const cutoffH = compSettingRes.rows[0]?.cutoff_hour ?? 6;
  const startDate = from ? `${from} ${String(cutoffH).padStart(2, '0')}:00:00` : '2000-01-01 00:00:00';
  const endDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';

  let shopFilterSales = '';
  let shopFilterPur = '';
  const params = [startDate, endDate];

  if (shop_id && shop_id !== 'ALL') {
    params.push(Number(shop_id));
    shopFilterSales = ` AND shop_id = $3 `;
    shopFilterPur = ` AND shop_id = $3 `;
  }

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
        COALESCE(SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='BANK' THEN grand_total ELSE 0 END), 0) AS bank_sales,
        COALESCE(COUNT(*) FILTER (WHERE zatca_status IN ('PENDING_REPORT','PENDING','FAILED')), 0) AS pending_zatca_count
      FROM sales_transactions
      WHERE created_at BETWEEN $1 AND $2 ${shopFilterSales}
    `, params);

    const purVat = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN subtotal ELSE 0 END), 0) AS pur_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN vat_input ELSE 0 END), 0) AS pur_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE' THEN grand_total ELSE 0 END), 0) AS pur_incl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN subtotal ELSE 0 END), 0) AS pur_ret_excl_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN vat_input ELSE 0 END), 0) AS pur_ret_vat,
        COALESCE(SUM(CASE WHEN doc_type = 'PURCHASE_RETURN' THEN grand_total ELSE 0 END), 0) AS pur_ret_incl_vat
      FROM purchase_transactions
      WHERE created_at BETWEEN $1 AND $2 ${shopFilterPur}
    `, params);

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


app.get('/api/reports/ledger', async (req, res) => {
  const { party_id, from, to } = req.query;
  if (!party_id) return res.status(400).json({ error: 'Party ID required' });
  try {
    const partyRes = await pool.query('SELECT * FROM parties WHERE party_id = $1', [party_id]);
    if (!partyRes.rows.length) return res.status(404).json({ error: 'Party not found' });
    const party = partyRes.rows[0];

    const startDate = from ? `${from} 00:00:00` : '2000-01-01 00:00:00';
    const endDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';

    // Transactions before 'from' to compute opening balance for the period
    const priorSales = await pool.query(`
      SELECT SUM(CASE WHEN doc_type IN ('B2B_INVOICE','B2C_INVOICE') AND payment_mode='CREDIT' THEN grand_total
                      WHEN doc_type IN ('B2B_CREDIT_NOTE','B2C_CREDIT_NOTE') AND payment_mode='CREDIT' THEN -grand_total ELSE 0 END) AS val
      FROM sales_transactions WHERE party_id = $1 AND created_at < $2
    `, [party_id, startDate]);

    const priorPurch = await pool.query(`
      SELECT SUM(CASE WHEN doc_type = 'PURCHASE' AND payment_mode='CREDIT' THEN grand_total
                      WHEN doc_type = 'PURCHASE_RETURN' AND payment_mode='CREDIT' THEN -grand_total ELSE 0 END) AS val
      FROM purchase_transactions WHERE party_id = $1 AND created_at < $2
    `, [party_id, startDate]);

    const priorVouch = await pool.query(`
      SELECT SUM(CASE WHEN voucher_type = 'RECEIPT' THEN amount ELSE 0 END) AS rec,
             SUM(CASE WHEN voucher_type = 'PAYMENT' THEN amount ELSE 0 END) AS pay
      FROM party_vouchers WHERE party_id = $1 AND created_at < $2
    `, [party_id, startDate]);

    const openingForPeriod = Number(party.opening_balance || 0)
      + Number(priorSales.rows[0]?.val || 0)
      - Number(priorPurch.rows[0]?.val || 0)
      - Number(priorVouch.rows[0]?.rec || 0)
      + Number(priorVouch.rows[0]?.pay || 0);

    // Period transactions
    const salesTx = await pool.query(`
      SELECT created_at, invoice_number AS ref, doc_type AS particulars, grand_total AS debit, 0 AS credit, payment_mode
      FROM sales_transactions WHERE party_id = $1 AND payment_mode='CREDIT' AND created_at BETWEEN $2 AND $3
    `, [party_id, startDate, endDate]);

    const purchTx = await pool.query(`
      SELECT created_at, voucher_number AS ref, doc_type AS particulars, 0 AS debit, grand_total AS credit, payment_mode
      FROM purchase_transactions WHERE party_id = $1 AND payment_mode='CREDIT' AND created_at BETWEEN $2 AND $3
    `, [party_id, startDate, endDate]);

    const vouchTx = await pool.query(`
      SELECT created_at, voucher_no AS ref, voucher_type AS particulars,
             CASE WHEN voucher_type='PAYMENT' THEN amount ELSE 0 END AS debit,
             CASE WHEN voucher_type='RECEIPT' THEN amount ELSE 0 END AS credit,
             payment_mode
      FROM party_vouchers WHERE party_id = $1 AND created_at BETWEEN $2 AND $3
    `, [party_id, startDate, endDate]);

    const combined = [...salesTx.rows, ...purchTx.rows, ...vouchTx.rows].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

    res.json({ party, opening_balance: openingForPeriod, transactions: combined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Saudi ZATCA Multi-Shop POS v11 running on port ${PORT}`));

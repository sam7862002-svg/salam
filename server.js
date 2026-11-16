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
      CREATE TABLE IF NOT EXISTS shops (
        shop_id SERIAL PRIMARY KEY,
        shop_name_en VARCHAR(100) NOT NULL,
        shop_name_ar VARCHAR(100) NOT NULL,
        prefix VARCHAR(10) NOT NULL UNIQUE
      );

      INSERT INTO shops (shop_id, shop_name_en, shop_name_ar, prefix) VALUES (1, 'Shop 1 - Main Branch', 'الفرع الرئيسي', 'S1') ON CONFLICT (shop_id) DO NOTHING;
      INSERT INTO shops (shop_id, shop_name_en, shop_name_ar, prefix) VALUES (2, 'Shop 2 - Counter Branch', 'فرع الكاونتر', 'S2') ON CONFLICT (shop_id) DO NOTHING;

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
        cutoff_hour INTEGER DEFAULT 6,
        last_icv INTEGER DEFAULT 0,
        last_pih TEXT DEFAULT '${INITIAL_PIH}'
      );

      ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(shop_id) DEFAULT 1;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(shop_id) DEFAULT 1;
    `);
    console.log('Database Multi-Shop verified & auto-healed.');
  } catch (e) {
    console.error('DB Init Notice:', e.message);
  }
}
initializeDatabase();

app.get('/api/shops', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shops ORDER BY shop_id ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const staffRes = await pool.query(`
      SELECT s.*, sh.shop_name_en, sh.prefix 
      FROM staff_users s 
      LEFT JOIN shops sh ON s.shop_id = sh.shop_id 
      WHERE s.pin = $1 AND s.active = TRUE
    `, [pin]);
    
    if (staffRes.rows.length) {
      const u = staffRes.rows[0];
      return res.json({ role: u.role, staff_name: u.staff_name, shop_id: u.shop_id, shop_name: u.shop_name_en, shop_prefix: u.prefix });
    }
    const { rows } = await pool.query('SELECT admin_pin, cashier_pin FROM company_settings WHERE id = 1');
    const cfg = rows[0] || { admin_pin: '1234', cashier_pin: '0000' };
    if (pin === (cfg.admin_pin || '1234')) return res.json({ role: 'ADMIN', staff_name: 'Admin', shop_id: 1, shop_name: 'Shop 1 - Main Branch', shop_prefix: 'S1' });
    if (pin === (cfg.cashier_pin || '0000')) return res.json({ role: 'CASHIER', staff_name: 'Cashier', shop_id: 1, shop_name: 'Shop 1 - Main Branch', shop_prefix: 'S1' });
    return res.status(401).json({ error: 'Invalid PIN' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/staff', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, sh.shop_name_en FROM staff_users s 
      LEFT JOIN shops sh ON s.shop_id = sh.shop_id 
      ORDER BY s.user_id ASC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/staff', async (req, res) => {
  const { staff_name, role, pin, shop_id, phone } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO staff_users (staff_name, role, pin, shop_id, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [staff_name.toUpperCase(), role, pin, shop_id || 1, phone || '']
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
        admin_pin || '1234', cashier_pin || '0000', master_reset_pass || 'admin123',
        Number(cutoff_hour ?? 6)
      ]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

app.post('/api/sales', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { party_id, doc_type, original_invoice_ref, return_reason, payment_mode, items, created_by, shop_id } = req.body;

    const targetShopId = Number(shop_id || 1);
    const shopRes = await client.query('SELECT * FROM shops WHERE shop_id = $1', [targetShopId]);
    const shop = shopRes.rows[0] || { prefix: 'S1' };

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
    const prefix = isCreditNote ? `${shop.prefix}-CN` : `${shop.prefix}-INV`;
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

    let zatcaRes = { status: 'PENDING_REPORT', mode: 'INSTANT_B2C_QUEUE' };
    if (doc_type.startsWith('B2B')) {
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
    if (shop_id) {
      conditions.push(`s.shop_id = $${params.length + 1}`);
      params.push(shop_id);
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
  const { from, to } = req.query;
  const compSettingRes = await pool.query('SELECT cutoff_hour FROM company_settings WHERE id = 1');
  const cutoffH = compSettingRes.rows[0]?.cutoff_hour ?? 6;
  const pad = n => String(n).padStart(2, '0');
  
  let startDate = from ? `${from} ${pad(cutoffH)}:00:00` : '2000-01-01 06:00:00';
  let endDate = '2099-12-31 05:59:59';
  if (to) {
    const d = new Date(to);
    d.setDate(d.getDate() + 1);
    endDate = `${d.toISOString().slice(0, 10)} ${pad(cutoffH)}:00:00`;
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

app.get('/api/reports/vat-return', async (req, res) => {
  const { from, to } = req.query;
  const compSettingRes = await pool.query('SELECT cutoff_hour FROM company_settings WHERE id = 1');
  const cutoffH = compSettingRes.rows[0]?.cutoff_hour ?? 6;
  const pad = n => String(n).padStart(2, '0');

  let startDate = from ? `${from} ${pad(cutoffH)}:00:00` : '2000-01-01 06:00:00';
  let endDate = '2099-12-31 05:59:59';
  if (to) {
    const d = new Date(to);
    d.setDate(d.getDate() + 1);
    endDate = `${d.toISOString().slice(0, 10)} ${pad(cutoffH)}:00:00`;
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
app.listen(PORT, () => console.log(`Saudi ZATCA Phase 2 POS running on port ${PORT}`));

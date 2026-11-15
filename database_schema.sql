-- 1. Organization & ZATCA Phase 2 Settings
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

INSERT INTO company_settings (id, company_name_en, company_name_ar, vat_number, last_icv)
VALUES (1, 'Saudi Retail Store', 'متجر التجزئة السعودي', '300000000000003', 0)
ON CONFLICT (id) DO NOTHING;

-- 2. Staff Users Table (Multi-Staff PIN & Role)
CREATE TABLE IF NOT EXISTS staff_users (
    user_id SERIAL PRIMARY KEY,
    staff_name VARCHAR(100) NOT NULL,
    role VARCHAR(15) CHECK (role IN ('ADMIN', 'CASHIER')) NOT NULL,
    pin VARCHAR(20) UNIQUE NOT NULL,
    active BOOLEAN DEFAULT TRUE
);

INSERT INTO staff_users (staff_name, role, pin) VALUES ('Owner / Admin', 'ADMIN', '1234') ON CONFLICT (pin) DO NOTHING;
INSERT INTO staff_users (staff_name, role, pin) VALUES ('Counter Cashier 1', 'CASHIER', '0000') ON CONFLICT (pin) DO NOTHING;

-- 3. Customers & Vendors Master
CREATE TABLE IF NOT EXISTS parties (
    party_id SERIAL PRIMARY KEY,
    party_type VARCHAR(15) CHECK (party_type IN ('CUSTOMER', 'VENDOR', 'BOTH')) NOT NULL,
    name_en VARCHAR(150) NOT NULL,
    name_ar VARCHAR(150),
    vat_number VARCHAR(15),
    cr_number VARCHAR(20),
    phone VARCHAR(20),
    address TEXT,
    opening_balance NUMERIC(12, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO parties (party_id, party_type, name_en, name_ar, opening_balance)
VALUES (1, 'CUSTOMER', 'WALK-IN CASH CUSTOMER', 'عميل نقدي', 0.00)
ON CONFLICT (party_id) DO NOTHING;

-- 4. Products & Inventory Master (selling_price & cost_price WITH 15% VAT included)
CREATE TABLE IF NOT EXISTS products (
    product_id SERIAL PRIMARY KEY,
    barcode VARCHAR(50) UNIQUE,
    name_en VARCHAR(150) NOT NULL,
    name_ar VARCHAR(150) NOT NULL,
    cost_price NUMERIC(12, 2) DEFAULT 0.00,
    selling_price NUMERIC(12, 2) NOT NULL,
    vat_rate NUMERIC(5, 2) DEFAULT 15.00,
    stock_qty NUMERIC(12, 3) DEFAULT 0.000
);

-- 5. Sales & Sales Return (Credit Note)
CREATE TABLE IF NOT EXISTS sales_transactions (
    sale_id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    icv INTEGER UNIQUE NOT NULL,
    uuid UUID UNIQUE NOT NULL,
    party_id INTEGER REFERENCES parties(party_id),
    doc_type VARCHAR(20) CHECK (doc_type IN ('B2B_INVOICE', 'B2C_INVOICE', 'B2B_CREDIT_NOTE', 'B2C_CREDIT_NOTE')) NOT NULL,
    original_invoice_ref VARCHAR(50),
    return_reason TEXT,
    payment_mode VARCHAR(20) CHECK (payment_mode IN ('CASH', 'MADA', 'CREDIT', 'BANK')) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    vat_amount NUMERIC(12, 2) NOT NULL,
    grand_total NUMERIC(12, 2) NOT NULL,
    prev_balance NUMERIC(12, 2) DEFAULT 0.00,
    new_balance NUMERIC(12, 2) DEFAULT 0.00,
    created_by VARCHAR(100) DEFAULT 'Admin',
    pih TEXT NOT NULL,
    invoice_hash TEXT NOT NULL,
    qr_code_base64 TEXT NOT NULL,
    xml_content TEXT NOT NULL,
    zatca_status VARCHAR(20) DEFAULT 'PENDING',
    zatca_response JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS prev_balance NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS new_balance NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS created_by VARCHAR(100) DEFAULT 'Admin';

-- 6. Purchase & Purchase Return (Debit Note)
CREATE TABLE IF NOT EXISTS purchase_transactions (
    purchase_id SERIAL PRIMARY KEY,
    voucher_number VARCHAR(50) UNIQUE NOT NULL,
    supplier_inv_no VARCHAR(50) NOT NULL,
    party_id INTEGER REFERENCES parties(party_id) NOT NULL,
    doc_type VARCHAR(20) CHECK (doc_type IN ('PURCHASE', 'PURCHASE_RETURN')) NOT NULL,
    original_purchase_ref VARCHAR(50),
    return_reason TEXT,
    payment_mode VARCHAR(20) CHECK (payment_mode IN ('CASH', 'MADA', 'CREDIT', 'BANK')) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    vat_input NUMERIC(12, 2) NOT NULL,
    grand_total NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS return_reason TEXT;

-- 7. Transaction Line Items
CREATE TABLE IF NOT EXISTS transaction_items (
    item_id SERIAL PRIMARY KEY,
    ref_type VARCHAR(15) CHECK (ref_type IN ('SALE', 'PURCHASE')) NOT NULL,
    ref_id INTEGER NOT NULL,
    product_id INTEGER REFERENCES products(product_id),
    qty NUMERIC(12, 3) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    vat_rate NUMERIC(5, 2) NOT NULL,
    vat_amount NUMERIC(12, 2) NOT NULL,
    line_total NUMERIC(12, 2) NOT NULL
);

-- 8. Receipts & Payments
CREATE TABLE IF NOT EXISTS party_vouchers (
    voucher_id SERIAL PRIMARY KEY,
    voucher_no VARCHAR(50) UNIQUE NOT NULL,
    party_id INTEGER REFERENCES parties(party_id) NOT NULL,
    voucher_type VARCHAR(15) CHECK (voucher_type IN ('RECEIPT', 'PAYMENT')) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    payment_mode VARCHAR(20) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

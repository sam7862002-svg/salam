# Saudi ZATCA Phase 2 POS v12.0 (Ultimate Bilingual Enterprise Edition)

## 🌟 Complete Setup & Deployment Guide

### 1. Supabase Database Setup
1. Create a new project on [Supabase](https://supabase.com).
2. Go to the **SQL Editor** in your Supabase dashboard.
3. Paste and run the entire contents of `database_schema.sql` to set up all tables (`company_settings`, `staff_users`, `parties`, `products`, `sales_transactions`, `purchase_transactions`, `transaction_items`, `party_vouchers`).
4. Copy your Supabase PostgreSQL connection string from **Database Settings** (Connection Pooling URI).

### 2. Render.com Deployment
1. Create a new Web Service on [Render](https://render.com) and link your GitHub repository containing this project.
2. Set the **Build Command** to: `npm install`
3. Set the **Start Command** to: `npm start`
4. In Environment Variables, add:
   - `DATABASE_URL`: `postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres`
   - `ZATCA_ENV`: `SANDBOX` (or `SIMULATION` / `PRODUCTION`)

### 3. ZATCA Phase 2 Fatoora Onboarding & Keys
1. Generate your CSID / Compliance CSID or Production CSID via ZATCA Fatoora Portal or SDK.
2. In the POS app, log in with Admin PIN (`1234`), go to **Settings & Backup**, and paste:
   - Base64 CSID Certificate
   - Secret Key
   - ECDSA Private Key (PEM format)
   - Saudi National Address (Building No, Street, District, City, Postal Code, Additional No)
   - Shop Bank Name, Account No, and IBAN

### 4. Key Features & Workflows in v12
- **Bilingual Arabic / English UI:** Click the top-left `العربية / EN` toggle to switch the interface language instantly with full RTL/LTR support.
- **Monthly & Quarterly VAT Reports:** Filter VAT returns by Current Month, any specific month (Jan-Dec), Quarters (Q1-Q4), or custom date ranges.
- **Custom Business Day Cut-off (e.g. 06:00 AM):** 24-hour retail shops can set a cut-off hour in Settings so transactions up to 6 AM belong to the previous business date.
- **Strict Party Separation:** POS Sales shows only Customers and Both; Purchases shows only Vendors and Both. Account modes (Receivable/Payable) auto-configure based on party type.
- **4 Excel Export Buttons:** Export Sales, Sales Return, Purchase, and Purchase Return registers directly to Excel.
- **WhatsApp PDF Sharing & History:** Instant WhatsApp PDF sharing from checkout and Bills History via html2pdf.js.
- **Master Security Password (`admin123`):** Protects factory resets, transaction wipes, and restores.

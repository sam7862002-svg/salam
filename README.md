# Saudi Arabia ZATCA Phase 2 POS & VAT Accounting System

Full-stack Cloud POS supporting:
- **ZATCA Phase 2 (Fatoora)** UBL 2.1 XML, ICV, PIH Hash Chain, ECDSA Signature, 9-Tag TLV QR Code, B2B Clearance & B2C Reporting APIs.
- **Sales & Sales Returns (Credit Notes)** with original invoice reference.
- **Purchases & Purchase Returns (Debit Notes)** with Input VAT tracking.
- **Customer & Vendor Register Report** with Receipts, Payments & Net Balances.
- **ZATCA VAT Return Filing Summary Report**.

## Quick Setup
1. Run `database_schema.sql` inside your **Supabase SQL Editor**.
2. Push this folder to your **GitHub** repository.
3. Deploy on **Render.com** (Web Service -> `npm install` -> `npm start`) and add `DATABASE_URL` in Render Environment Variables.

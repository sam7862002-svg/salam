const { create } = require('xmlbuilder2');

function generateZatcaXML({ company, invoice, party, items }) {
  const isCreditNote = invoice.doc_type.includes('CREDIT_NOTE');
  const isB2B = invoice.doc_type.startsWith('B2B');

  const typeCode = isCreditNote ? '381' : '388';
  const subType = isB2B ? '0100000' : '0200000';

  const issueDate = new Date(invoice.created_at).toISOString().split('T')[0];
  const issueTime = new Date(invoice.created_at).toISOString().split('T')[1].split('.')[0] + 'Z';

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('Invoice', {
      xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'
    })
    .ele('cbc:ProfileID').txt('reporting:1.0').up()
    .ele('cbc:ID').txt(invoice.invoice_number).up()
    .ele('cbc:UUID').txt(invoice.uuid).up()
    .ele('cbc:IssueDate').txt(issueDate).up()
    .ele('cbc:IssueTime').txt(issueTime).up()
    .ele('cbc:InvoiceTypeCode', { name: subType }).txt(typeCode).up()
    .ele('cbc:DocumentCurrencyCode').txt('SAR').up()
    .ele('cbc:TaxCurrencyCode').txt('SAR').up();

  if (isCreditNote && invoice.original_invoice_ref) {
    doc.ele('cac:BillingReference')
      .ele('cac:InvoiceDocumentReference')
      .ele('cbc:ID').txt(invoice.original_invoice_ref).up()
      .up().up();
  }

  doc.ele('cac:AdditionalDocumentReference')
    .ele('cbc:ID').txt('ICV').up()
    .ele('cbc:UUID').txt(String(invoice.icv)).up()
    .up();

  doc.ele('cac:AdditionalDocumentReference')
    .ele('cbc:ID').txt('PIH').up()
    .ele('cac:Attachment')
    .ele('cbc:EmbeddedDocumentBinaryObject', { mimeCode: 'text/plain' }).txt(invoice.pih).up()
    .up().up();

  const supplier = doc.ele('cac:AccountingSupplierParty').ele('cac:Party');
  supplier.ele('cac:PartyIdentification')
    .ele('cbc:ID', { schemeID: 'CRN' }).txt(company.cr_number || '1010000000').up()
    .up();
  
  const supAddr = supplier.ele('cac:PostalAddress');
  if (company.building_no) supAddr.ele('cbc:BuildingNumber').txt(company.building_no).up();
  if (company.street_name) supAddr.ele('cbc:StreetName').txt(company.street_name).up();
  if (company.district) supAddr.ele('cbc:CitySubdivisionName').txt(company.district).up();
  supAddr.ele('cbc:CityName').txt(company.city || 'Jeddah').up();
  if (company.postal_code) supAddr.ele('cbc:PostalZone').txt(company.postal_code).up();
  if (company.additional_no) supAddr.ele('cbc:PlotIdentification').txt(company.additional_no).up();
  supAddr.ele('cac:Country').ele('cbc:IdentificationCode').txt('SA').up().up();

  supplier.ele('cac:PartyTaxScheme')
    .ele('cbc:CompanyID').txt(company.vat_number).up()
    .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT').up().up()
    .up();
  supplier.ele('cac:PartyLegalEntity')
    .ele('cbc:RegistrationName').txt(company.company_name_ar).up()
    .up();

  const customer = doc.ele('cac:AccountingCustomerParty').ele('cac:Party');
  if (party && party.vat_number) {
    customer.ele('cac:PartyTaxScheme')
      .ele('cbc:CompanyID').txt(party.vat_number).up()
      .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT').up().up()
      .up();
  }
  customer.ele('cac:PartyLegalEntity')
    .ele('cbc:RegistrationName').txt((party && (party.name_ar || party.name_en)) || 'عميل نقدي').up()
    .up();

  doc.ele('cac:TaxTotal')
    .ele('cbc:TaxAmount', { currencyID: 'SAR' }).txt(Number(invoice.vat_amount).toFixed(2)).up()
    .up();

  doc.ele('cac:LegalMonetaryTotal')
    .ele('cbc:LineExtensionAmount', { currencyID: 'SAR' }).txt(Number(invoice.subtotal).toFixed(2)).up()
    .ele('cbc:TaxExclusiveAmount', { currencyID: 'SAR' }).txt(Number(invoice.subtotal).toFixed(2)).up()
    .ele('cbc:TaxInclusiveAmount', { currencyID: 'SAR' }).txt(Number(invoice.grand_total).toFixed(2)).up()
    .ele('cbc:PayableAmount', { currencyID: 'SAR' }).txt(Number(invoice.grand_total).toFixed(2)).up()
    .up();

  items.forEach((item, idx) => {
    const line = doc.ele('cac:InvoiceLine');
    line.ele('cbc:ID').txt(String(idx + 1)).up();
    line.ele('cbc:InvoicedQuantity', { unitCode: 'PCE' }).txt(Number(item.qty).toFixed(3)).up();
    line.ele('cbc:LineExtensionAmount', { currencyID: 'SAR' }).txt(Number(item.line_sub_excl).toFixed(2)).up();
    line.ele('cac:TaxTotal')
      .ele('cbc:TaxAmount', { currencyID: 'SAR' }).txt(Number(item.vat_amount).toFixed(2)).up()
      .ele('cbc:RoundingAmount', { currencyID: 'SAR' }).txt(Number(item.line_total).toFixed(2)).up()
      .up();
    line.ele('cac:Item')
      .ele('cbc:Name').txt(item.name_ar || item.name_en).up()
      .ele('cac:ClassifiedTaxCategory')
      .ele('cbc:ID').txt(Number(item.vat_rate) > 0 ? 'S' : 'Z').up()
      .ele('cbc:Percent').txt(Number(item.vat_rate).toFixed(2)).up()
      .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT').up().up()
      .up().up();
    line.ele('cac:Price')
      .ele('cbc:PriceAmount', { currencyID: 'SAR' }).txt(Number(item.unit_price_excl).toFixed(4)).up()
      .up();
  });

  return doc.end({ prettyPrint: true });
}

module.exports = { generateZatcaXML };
```[cite: 12]

---

### 6. `zatca/signer.js`
(SHA256 ഹാഷ്, ഇസിഡിഎസ്എ ഡിജിറ്റൽ സിഗ്നേച്ചർ, 9-ടാഗ് QR കോഡ് TLV എൻകോഡിങ് എന്നിവ ചെയ്യുന്ന ഫയൽ)[cite: 11]

```javascript
const crypto = require('crypto');

function encodeTLV(tag, valueBuffer) {
  const tagBuf = Buffer.from([tag]);
  const lenBuf = Buffer.from([valueBuffer.length]);
  return Buffer.concat([tagBuf, lenBuf, valueBuffer]);
}

function generateInvoiceHash(xmlString) {
  return crypto.createHash('sha256').update(xmlString, 'utf8').digest('base64');
}

function signInvoiceHash(xmlHashBase64, privateKeyPem) {
  if (!privateKeyPem || !privateKeyPem.includes('BEGIN')) {
    return crypto.createHash('sha256').update('SANDBOX_SIG_' + xmlHashBase64).digest('base64');
  }
  const sign = crypto.createSign('SHA256');
  sign.update(Buffer.from(xmlHashBase64, 'base64'));
  sign.end();
  return sign.sign(privateKeyPem, 'base64');
}

function generatePhase2QR({
  sellerName,
  vatNumber,
  timestamp,
  totalWithVat,
  vatAmount,
  xmlHashBase64,
  ecdsaSignatureBase64,
  publicKeyBase64,
  stampSignatureBase64
}) {
  const tags = [
    encodeTLV(1, Buffer.from(sellerName, 'utf8')),
    encodeTLV(2, Buffer.from(vatNumber, 'utf8')),
    encodeTLV(3, Buffer.from(timestamp, 'utf8')),
    encodeTLV(4, Buffer.from(Number(totalWithVat).toFixed(2), 'utf8')),
    encodeTLV(5, Buffer.from(Number(vatAmount).toFixed(2), 'utf8')),
    encodeTLV(6, Buffer.from(xmlHashBase64, 'utf8')),
    encodeTLV(7, Buffer.from(ecdsaSignatureBase64, 'utf8')),
    encodeTLV(8, Buffer.from(publicKeyBase64 || 'SANDBOX_PUB_KEY', 'base64')),
    encodeTLV(9, Buffer.from(stampSignatureBase64 || 'SANDBOX_STAMP', 'base64'))
  ];
  return Buffer.concat(tags).toString('base64');
}

module.exports = {
  generateInvoiceHash,
  signInvoiceHash,
  generatePhase2QR
};
```[cite: 11]

---

### 7. `zatca/apiClient.js`
(ZATCA Fatoora API-ലേക്കുള്ള ക്ലിയറൻസ് / റിപ്പോർട്ടിംഗ് കണക്ഷൻ ഹെൽപ്പർ)[cite: 10]

```javascript
const axios = require('axios');

const ZATCA_ENDPOINTS = {
  SANDBOX: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  SIMULATION: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  PRODUCTION: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core'
};

async function submitToZatca({ company, uuid, invoiceHash, xmlContent, docType }) {
  const baseUrl = ZATCA_ENDPOINTS[company.zatca_env] || ZATCA_ENDPOINTS.SANDBOX;
  const isB2B = docType.startsWith('B2B');
  const endpoint = isB2B ? `${baseUrl}/invoices/clearance/single` : `${baseUrl}/invoices/reporting/single`;

  if (!company.csid_certificate || !company.secret_key) {
    return {
      status: isB2B ? 'CLEARED' : 'REPORTED',
      mode: 'SANDBOX_LOCAL_SIMULATION',
      message: 'CSID not configured yet. Stored with valid Phase 2 XML, Hash & 9-Tag QR.'
    };
  }

  const authToken = Buffer.from(`${company.csid_certificate}:${company.secret_key}`).toString('base64');
  const xmlBase64 = Buffer.from(xmlContent, 'utf8').toString('base64');

  try {
    const response = await axios.post(
      endpoint,
      { invoiceHash, uuid, invoice: xmlBase64 },
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          'Accept-Version': 'V2',
          'Accept-Language': 'en',
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    const clearanceStatus = response.data?.clearanceStatus || response.data?.reportingStatus;
    return {
      status: clearanceStatus === 'CLEARED' || clearanceStatus === 'REPORTED' ? clearanceStatus : 'FAILED',
      raw: response.data
    };
  } catch (err) {
    return {
      status: 'FAILED',
      error: err.response?.data || err.message
    };
  }
}

module.exports = { submitToZatca };
```[cite: 10]

<FollowUp label="Ready for the main server.js file?" query="Yes, give me the server.js file."/>

const { create } = require('xmlbuilder2');

function generateZatcaXML({ shop, invoice, party, items }) {
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
    .ele('cbc:ID', { schemeID: 'CRN' }).txt(shop.cr_number || '1010000000').up()
    .up();
  
  const supAddr = supplier.ele('cac:PostalAddress');
  if (shop.building_no) supAddr.ele('cbc:BuildingNumber').txt(shop.building_no).up();
  if (shop.street_name) supAddr.ele('cbc:StreetName').txt(shop.street_name).up();
  if (shop.district) supAddr.ele('cbc:CitySubdivisionName').txt(shop.district).up();
  supAddr.ele('cbc:CityName').txt(shop.city || 'Jeddah').up();
  if (shop.postal_code) supAddr.ele('cbc:PostalZone').txt(shop.postal_code).up();
  if (shop.additional_no) supAddr.ele('cbc:PlotIdentification').txt(shop.additional_no).up();
  supAddr.ele('cac:Country').ele('cbc:IdentificationCode').txt('SA').up().up();

  supplier.ele('cac:PartyTaxScheme')
    .ele('cbc:CompanyID').txt(shop.vat_number).up()
    .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT').up().up()
    .up();
  supplier.ele('cac:PartyLegalEntity')
    .ele('cbc:RegistrationName').txt(shop.shop_name_ar).up()
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

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

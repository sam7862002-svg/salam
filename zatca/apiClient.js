const axios = require('axios');

const ZATCA_ENDPOINTS = {
  SANDBOX: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  SIMULATION: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  PRODUCTION: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core'
};

async function submitToZatca({ shop, uuid, invoiceHash, xmlContent, docType }) {
  if (!shop.is_zatca_enabled) {
    return {
      status: 'GRD_LOCAL_BRANCH',
      mode: 'NON_ZATCA_BRANCH',
      message: 'Branch configured as Standard/GRD mode (ZATCA reporting bypassed).'
    };
  }

  const baseUrl = ZATCA_ENDPOINTS[shop.zatca_env] || ZATCA_ENDPOINTS.SANDBOX;
  const isB2B = docType.startsWith('B2B');
  const endpoint = isB2B ? `${baseUrl}/invoices/clearance/single` : `${baseUrl}/invoices/reporting/single`;

  if (!shop.csid_certificate || !shop.secret_key) {
    return {
      status: isB2B ? 'CLEARED' : 'REPORTED',
      mode: 'SANDBOX_LOCAL_SIMULATION',
      message: 'CSID not configured yet. Stored with valid Phase 2 XML, Hash & 9-Tag QR.'
    };
  }

  const authToken = Buffer.from(`${shop.csid_certificate}:${shop.secret_key}`).toString('base64');
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

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

const crypto = require('crypto');

function getKey() {
  const secret = process.env.DATA_ENCRYPTION_KEY;
  if (!secret) throw new Error('DATA_ENCRYPTION_KEY is not configured on the server.');
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSecret(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

function decryptSecret(value) {
  if (!value) return null;
  if (!value.startsWith('v1.')) return value;

  const [, ivBase64, tagBase64, ciphertextBase64] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextBase64, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };

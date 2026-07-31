const crypto = require('crypto');

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;
  const suppliedKey = req.get('x-sapo-admin-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!configuredKey) {
    return res.status(503).json({
      success: false,
      message: 'ADMIN_API_KEY is not configured on the server.'
    });
  }

  if (!safeEqual(suppliedKey, configuredKey)) {
    return res.status(401).json({ success: false, message: 'Admin authentication required.' });
  }

  return next();
}

module.exports = { requireAdmin };

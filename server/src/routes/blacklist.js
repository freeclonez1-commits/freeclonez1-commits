const express = require('express');
const router = express.Router();
const db = require('../db');
const net = require('net');
const { requireAdmin } = require('../middleware/adminAuth');

/**
 * GET /api/v1/blacklist/check
 * Quick check endpoint for Sapo site script
 */
router.get('/check', (req, res) => {
  try {
    const clientIp = req.query.ip ||
      (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.socket.remoteAddress);
    const webrtcIp = req.query.webrtc_ip || null;

    if (!clientIp && !webrtcIp) {
      return res.status(400).json({ success: false, is_blacklisted: false, message: 'IP required' });
    }

    const row = db.prepare(`
      SELECT * FROM blacklist 
      WHERE ip = ? OR (ip = ? AND ip IS NOT NULL AND ip != '')
    `).get(clientIp || '', webrtcIp || '');

    console.log(`[GET /blacklist/check] ip=${clientIp || 'N/A'} webrtc_ip=${webrtcIp || 'N/A'} blocked=${!!row}`);

    res.json({
      success: true,
      ip: clientIp,
      webrtc_ip: webrtcIp,
      is_blacklisted: !!row,
      reason: row ? row.reason : null,
      created_at: row ? row.created_at : null
    });
  } catch (error) {
    res.status(500).json({ success: false, is_blacklisted: false, error: error.message });
  }
});

router.use(requireAdmin);

/**
 * GET /api/v1/blacklist
 * List all blacklisted IPs for Admin Dashboard
 */
router.get('/', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/blacklist
 * Add an IP to the Blacklist
 */
router.post('/', (req, res) => {
  try {
    const { ip, reason, source } = req.body;

    if (!ip || !net.isIP(ip.trim())) {
      return res.status(400).json({ success: false, message: 'IP address is required' });
    }

    const stmt = db.prepare(`
      INSERT INTO blacklist (ip, reason, source)
      VALUES (?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        reason = excluded.reason,
        source = excluded.source,
        created_at = CURRENT_TIMESTAMP
    `);

    stmt.run(ip, reason || 'Bị chặn bởi quản trị viên', source || 'MANUAL');

    // Also update any existing logs for this IP to HIGH_RISK
    db.prepare("UPDATE logs SET risk_level = 'HIGH_RISK' WHERE client_ip = ?").run(ip);

    res.status(201).json({ success: true, message: `IP ${ip} đã được thêm vào danh sách đen` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/v1/blacklist/:ip
 * Remove an IP from the Blacklist
 */
router.delete('/:ip', (req, res) => {
  try {
    const { ip } = req.params;
    const stmt = db.prepare('DELETE FROM blacklist WHERE ip = ?');
    const result = stmt.run(ip);

    if (result.changes > 0) {
      res.json({ success: true, message: `Đã xóa IP ${ip} khỏi danh sách đen` });
    } else {
      res.status(404).json({ success: false, message: 'IP không tồn tại trong danh sách đen' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');
const { syncSapoOrders } = require('../services/sapoSyncService');
const { requireAdmin } = require('../middleware/adminAuth');
const { encryptSecret } = require('../services/secretService');

function publicStore(store) {
  const { api_secret, api_secret_encrypted, ...safeStore } = store;
  return { ...safeStore, has_api_secret: Boolean(api_secret || api_secret_encrypted) };
}

router.use(requireAdmin);

/**
 * GET /api/v1/stores
 * Get list of connected Sapo stores
 */
router.get('/', (req, res) => {
  try {
    const stores = db.prepare('SELECT * FROM stores').all();
    res.json({ success: true, data: stores.map(publicStore) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/stores
 * Connect a new Sapo store with user-entered API Key & API Secret from Sapo Admin
 */
router.post('/', (req, res) => {
  try {
    const { store_name, mysapo_domain, api_key, api_secret } = req.body;

    if (!store_name || !mysapo_domain || !api_key || !api_secret) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng điền đầy đủ Tên cửa hàng, Mysapo Domain, API key và API secret từ Sapo Admin'
      });
    }

    const cleanDomain = mysapo_domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const alreadyConnected = db.prepare('SELECT * FROM stores').all().some(store =>
      store.mysapo_domain.toLowerCase() === cleanDomain.toLowerCase()
    );

    if (alreadyConnected) {
      return res.status(409).json({
        success: false,
        message: 'Cửa hàng với Mysapo Domain này đã được liên kết.'
      });
    }

    const stmt = db.prepare('INSERT INTO stores (store_name, mysapo_domain, api_key, api_secret_encrypted) VALUES (?, ?, ?, ?)');
    const result = stmt.run(store_name.trim(), cleanDomain, api_key.trim(), encryptSecret(api_secret.trim()));

    // Auto-sync orders for newly added store
    syncSapoOrders(result.lastInsertRowid).catch(err => console.error('Auto sync error:', err));

    res.status(201).json({
      success: true,
      message: `Đã liên kết thành công cửa hàng ${store_name}`,
      data: {
        id: result.lastInsertRowid,
        store_name: store_name.trim(),
        mysapo_domain: cleanDomain,
        api_key: api_key.trim(),
        has_api_secret: true
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/stores/:id/sync
 * Sync orders from Sapo for a specific store
 */
router.post('/:id/sync', async (req, res) => {
  try {
    const { datePreset } = req.body;
    const result = await syncSapoOrders(req.params.id, datePreset || 'TODAY');
    res.json(result);
  } catch (error) {
    console.error('Error syncing Sapo orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/v1/stores/:id
 */
router.put('/:id', (req, res) => {
  try {
    const { store_name, mysapo_domain, api_key, api_secret } = req.body;

    if (!store_name || !mysapo_domain || !api_key) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ thông tin' });
    }

    const cleanDomain = mysapo_domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    const existing = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    const domainTaken = db.prepare('SELECT * FROM stores').all().some(store =>
      store.id !== existing.id && store.mysapo_domain.toLowerCase() === cleanDomain.toLowerCase()
    );
    if (domainTaken) {
      return res.status(409).json({ success: false, message: 'Mysapo Domain này đã thuộc một cửa hàng khác.' });
    }
    const encryptedSecret = api_secret ? encryptSecret(api_secret.trim()) : existing.api_secret_encrypted;
    const stmt = db.prepare('UPDATE stores SET store_name = ?, mysapo_domain = ?, api_key = ?, api_secret_encrypted = ? WHERE id = ?');
    const result = stmt.run(store_name.trim(), cleanDomain, api_key.trim(), encryptedSecret, req.params.id);

    if (result.changes > 0) {
      res.json({ success: true, message: 'Đã cập nhật thông tin cửa hàng thành công' });
    } else {
      res.status(404).json({ success: false, message: 'Không tìm thấy cửa hàng' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/v1/stores/:id
 */
router.delete('/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM stores WHERE id = ?');
    const result = stmt.run(req.params.id);

    if (result.changes > 0) {
      res.json({ success: true, message: 'Đã xóa liên kết cửa hàng' });
    } else {
      res.status(404).json({ success: false, message: 'Không tìm thấy cửa hàng' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

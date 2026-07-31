const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const { businessDate } = require('../services/dateService');

router.use(requireAdmin);

/**
 * GET /api/v1/stats/overview
 * Returns KPI metrics filtered by store_id if provided
 */
router.get('/overview', (req, res) => {
  try {
    const { store_id } = req.query;
    const storeId = store_id && store_id !== 'ALL' ? parseInt(store_id) : null;

    let logs = db.prepare('SELECT * FROM logs').all();
    if (storeId) {
      logs = logs.filter(l => l.store_id === storeId);
    }

    const totalLogs = logs.length;
    const highRiskCount = logs.filter(l => l.risk_level === 'HIGH_RISK').length;
    const cleanCount = totalLogs - highRiskCount;
    const vpnRate = totalLogs > 0 ? ((highRiskCount / totalLogs) * 100).toFixed(1) : 0;

    const totalBlacklisted = db.prepare('SELECT COUNT(*) as count FROM blacklist').get().count;

    const todayStr = businessDate();
    const suspiciousOrdersToday = logs.filter(l =>
      l.risk_level === 'HIGH_RISK' &&
      l.order_info !== null &&
      l.order_info !== '' &&
      l.order_info !== 'null' &&
      l.created_at &&
      businessDate(l.created_at) === todayStr
    ).length;

    // Top ISPs
    const ispMap = {};
    logs.filter(l => l.risk_level === 'HIGH_RISK' && l.isp && l.isp !== 'Unknown').forEach(l => {
      ispMap[l.isp] = (ispMap[l.isp] || 0) + 1;
    });
    const topIsps = Object.keys(ispMap)
      .map(isp => ({ isp, count: ispMap[isp] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json({
      success: true,
      data: {
        totalLogs,
        highRiskCount,
        cleanCount,
        vpnRate: parseFloat(vpnRate),
        totalBlacklisted,
        suspiciousOrdersToday,
        topIsps
      }
    });

  } catch (error) {
    console.error('Error getting stats overview:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/stats/chart
 */
router.get('/chart', (req, res) => {
  try {
    const { store_id } = req.query;
    const storeId = store_id && store_id !== 'ALL' ? parseInt(store_id) : null;

    let sql = `SELECT * FROM logs`;
    if (storeId) {
      sql += ` WHERE store_id = ${storeId}`;
    }

    const rows = db.prepare(sql).all();
    const now = Date.now();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: process.env.BUSINESS_TIME_ZONE || 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      hourCycle: 'h23'
    });
    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      time_label: `${String(hour).padStart(2, '0')}:00`,
      clean: 0,
      high_risk: 0
    }));

    rows.forEach(row => {
      const timestamp = new Date(row.created_at).getTime();
      if (!Number.isFinite(timestamp) || now - timestamp > 24 * 60 * 60 * 1000 || timestamp > now) return;
      const hour = Number(formatter.format(new Date(timestamp)));
      if (!Number.isInteger(hour) || !buckets[hour]) return;
      if (row.risk_level === 'HIGH_RISK') buckets[hour].high_risk += 1;
      else buckets[hour].clean += 1;
    });

    res.json({
      success: true,
      data: buckets
    });

  } catch (error) {
    console.error('Error getting stats chart:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

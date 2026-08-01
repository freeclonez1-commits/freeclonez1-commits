const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const db = require('./db');
const logsRoutes = require('./routes/logs');
const blacklistRoutes = require('./routes/blacklist');
const statsRoutes = require('./routes/stats');
const storesRoutes = require('./routes/stores');

const app = express();
const PORT = process.env.PORT || 5000;

const configuredDashboardOrigins = (process.env.DASHBOARD_ORIGINS || process.env.DASHBOARD_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (origin === 'http://localhost:3000') return true;
  if (configuredDashboardOrigins.includes(origin)) return true;
  return /^https:\/\/[^/]+\.mysapo\.net$/i.test(origin) || /^https:\/\/[^/]+\.netlify\.app$/i.test(origin);
};

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed by Sapo IP Guard.'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Sapo-Admin-Key', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve tracker dynamically so each page load gets the latest blacklist snapshot.
app.get('/client-tracker.js', (req, res) => {
  try {
    const trackerPath = path.join(__dirname, '../public/client-tracker.js');
    const trackerSource = fs.readFileSync(trackerPath, 'utf8');
    const blacklist = db.prepare('SELECT * FROM blacklist').all().map(item => item.ip).filter(Boolean);
    const bootstrap = `window.__SAPO_IP_GUARD_BLACKLIST = ${JSON.stringify(blacklist)};\n`;

    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.type('application/javascript').send(bootstrap + trackerSource);
  } catch (error) {
    console.error('Error serving dynamic tracker:', error);
    res.status(500).type('application/javascript').send('console.error("Sapo IP Guard tracker failed to load");');
  }
});

// Serve client-tracker.js statically with CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
}, express.static(path.join(__dirname, '../public')));

// Register Routes
app.use('/api/v1/logs', logsRoutes);
app.use('/api/v1/blacklist', blacklistRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1/stores', storesRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', system: 'Sapo Multi-Store Anti-Fake IP Detection API', timestamp: new Date() });
});

// Start Server
app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`🚀 Sapo IP Guard Production Backend running on port ${PORT}`);
  console.log(`📡 Tracker Script: http://localhost:${PORT}/client-tracker.js`);
  console.log(`================================================`);
});

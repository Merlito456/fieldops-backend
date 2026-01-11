const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const app = express();

/**
 * FIELDOPS PRO: UNIFIED BACKEND & FRONTEND
 * Remote DB Host: sql205.hstn.me
 */

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Database Configuration
const dbConfig = {
  host: 'sql205.hstn.me',
  user: 'mseet_40088375',
  password: 'kAPvVet3QwK6',
  database: 'mseet_40088375_fieldops',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: false,
  connectTimeout: 10000 // 10 seconds timeout
};

let pool;

try {
  pool = mysql.createPool(dbConfig);
  console.log('📡 Database Pool Created.');
} catch (err) {
  console.error('❌ Critical Error: Failed to create Database Pool:', err.message);
}

// Helper: Handle JSON parsing for DB columns
const safeParse = (data) => {
  if (!data) return null;
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch (e) { return null; }
};

/**
 * INITIALIZE DATABASE TABLES
 */
async function initDatabase() {
  if (!pool) return;
  console.log('🔍 Checking database schema integrity...');
  try {
    const connection = await pool.getConnection();
    
    // 1. Vendors Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        company VARCHAR(255),
        contact_number VARCHAR(50),
        photo_url TEXT,
        id_number VARCHAR(100),
        specialization VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Sites Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) DEFAULT 'Macro Cell',
        address TEXT,
        gps_coordinates VARCHAR(100),
        priority VARCHAR(20) DEFAULT 'Medium',
        last_maintenance_date DATE,
        next_maintenance_date DATE,
        asset_photo_url TEXT,
        caretaker VARCHAR(255),
        caretaker_contact VARCHAR(50),
        key_status VARCHAR(20) DEFAULT 'Available',
        tower_height INT,
        tower_type VARCHAR(50),
        equipment_brand VARCHAR(50),
        signal_integrity INT,
        sectors INT,
        pending_visitor LONGTEXT,
        current_visitor LONGTEXT,
        visitor_history LONGTEXT,
        pending_key_log LONGTEXT,
        current_key_log LONGTEXT,
        key_history LONGTEXT,
        access_authorized TINYINT(1) DEFAULT 0,
        key_access_authorized TINYINT(1) DEFAULT 0
      )
    `);

    // 3. Tasks Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        site_id VARCHAR(50),
        assigned_to VARCHAR(50),
        status VARCHAR(50) DEFAULT 'Pending',
        priority VARCHAR(20),
        type VARCHAR(50),
        scheduled_date DATE,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
      )
    `);

    connection.release();
    console.log('✅ Database schema verified and ready.');
  } catch (err) {
    console.error('❌ Database Initialization Failed:', err.message);
  }
}

initDatabase();

// ---------------------------------------------------------
// DIAGNOSTIC ROUTES
// ---------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ 
    status: "ONLINE", 
    db_connected: !!pool, 
    service: "FieldOps Bridge", 
    timestamp: new Date().toISOString() 
  });
});

// ---------------------------------------------------------
// AUTHENTICATION & VENDORS
// ---------------------------------------------------------

app.post('/api/auth/vendor/register', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
  try {
    const v = req.body;
    await pool.query(
      `INSERT INTO vendors (id, username, password, full_name, company, contact_number, photo_url, id_number, specialization) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.id, v.username, v.password, v.fullName, v.company, v.contactNumber, v.photo, v.idNumber, v.specialization]
    );
    res.json(v);
  } catch (err) {
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

app.post('/api/auth/vendor/login', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query('SELECT * FROM vendors WHERE username = ? AND password = ?', [username, password]);
    if (rows.length > 0) {
      const v = rows[0];
      res.json({
        id: v.id, username: v.username, fullName: v.full_name, company: v.company,
        contactNumber: v.contact_number, photo: v.photo_url, idNumber: v.id_number,
        specialization: v.specialization
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// SITE MANAGEMENT
// ---------------------------------------------------------

app.get('/api/sites', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
  try {
    const [rows] = await pool.query('SELECT * FROM sites ORDER BY name ASC');
    const mapped = rows.map(s => ({
      id: s.id, name: s.name, type: s.type, address: s.address, gpsCoordinates: s.gps_coordinates,
      priority: s.priority, lastMaintenanceDate: s.last_maintenance_date, nextMaintenanceDate: s.next_maintenance_date,
      assetPhoto: s.asset_photo_url, towerHeight: s.tower_height, equipmentBrand: s.equipment_brand,
      keyStatus: s.key_status, caretaker: s.caretaker, caretakerContact: s.caretaker_contact,
      pendingVisitor: safeParse(s.pending_visitor),
      currentVisitor: safeParse(s.current_visitor),
      visitorHistory: safeParse(s.visitor_history) || [],
      pendingKeyLog: safeParse(s.pending_key_log),
      currentKeyLog: safeParse(s.current_key_log),
      keyHistory: safeParse(s.key_history) || [],
      accessAuthorized: !!s.access_authorized,
      keyAccessAuthorized: !!s.key_access_authorized
    }));
    res.json(mapped);
  } catch (err) {
    console.error('❌ API Error /api/sites:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sites', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
  const s = req.body;
  try {
    await pool.query(
      `INSERT INTO sites (id, name, type, address, gps_coordinates, priority, last_maintenance_date, next_maintenance_date, asset_photo_url, caretaker, caretaker_contact, tower_height, tower_type, equipment_brand, sectors) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.name, s.type, s.address, s.gpsCoordinates, s.priority, s.lastMaintenanceDate, s.nextMaintenanceDate, s.assetPhoto, s.caretaker, s.caretakerContact, s.towerHeight, s.towerType, s.equipmentBrand, s.sectors]
    );
    res.json(s);
  } catch (err) {
    console.error('❌ API Error POST /api/sites:', err.message);
    res.status(500).json({ error: 'Database save failed: ' + err.message });
  }
});

app.put('/api/sites/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
  const s = req.body;
  try {
    await pool.query(
      `UPDATE sites SET name=?, type=?, address=?, gps_coordinates=?, priority=?, asset_photo_url=?, caretaker=?, caretaker_contact=?, tower_height=?, tower_type=?, equipment_brand=?, sectors=? WHERE id=?`,
      [s.name, s.type, s.address, s.gpsCoordinates, s.priority, s.assetPhoto, s.caretaker, s.caretakerContact, s.towerHeight, s.towerType, s.equipmentBrand, s.sectors, req.params.id]
    );
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// ACCESS PROTOCOL
// ---------------------------------------------------------

app.post('/api/access/request', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { siteId, ...visitorData } = req.body;
    const visitor = { ...visitorData, id: `REQ-${Date.now()}`, checkInTime: new Date().toISOString() };
    await pool.query('UPDATE sites SET pending_visitor = ?, access_authorized = 0 WHERE id = ?', [JSON.stringify(visitor), siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/authorize/:siteId', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    await pool.query('UPDATE sites SET access_authorized = 1 WHERE id = ?', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/cancel/:siteId', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    await pool.query('UPDATE sites SET pending_visitor = NULL, access_authorized = 0 WHERE id = ?', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/checkin/:siteId', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const [rows] = await pool.query('SELECT pending_visitor FROM sites WHERE id = ?', [req.params.siteId]);
    if (rows.length > 0 && rows[0].pending_visitor) {
      const visitor = safeParse(rows[0].pending_visitor);
      visitor.id = `VIS-${Date.now()}`;
      await pool.query(
        'UPDATE sites SET current_visitor = ?, pending_visitor = NULL, access_authorized = 0 WHERE id = ?', 
        [JSON.stringify(visitor), req.params.siteId]
      );
      res.json(visitor);
    } else res.status(404).json({ error: 'No pending access request found for this site.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/checkout/:siteId', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { exitPhoto, rocLogoutName, rocLogoutTime } = req.body;
    const [rows] = await pool.query('SELECT current_visitor, visitor_history FROM sites WHERE id = ?', [req.params.siteId]);
    if (rows.length > 0 && rows[0].current_visitor) {
      const current = safeParse(rows[0].current_visitor);
      const history = safeParse(rows[0].visitor_history) || [];
      const finished = { ...current, exitPhoto, rocLogoutName, rocLogoutTime, checkOutTime: new Date().toISOString() };
      const updatedHistory = [finished, ...history].slice(0, 20);
      await pool.query(
        'UPDATE sites SET current_visitor = NULL, visitor_history = ? WHERE id = ?',
        [JSON.stringify(updatedHistory), req.params.siteId]
      );
      res.json({ success: true });
    } else res.status(404).json({ error: 'No active session found to terminate.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------
// KEY MANAGEMENT
// ---------------------------------------------------------

app.post('/api/keys/request', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { siteId, ...logData } = req.body;
    const keyLog = { ...logData, id: `KREQ-${Date.now()}`, borrowTime: new Date().toISOString() };
    await pool.query('UPDATE sites SET pending_key_log = ?, key_access_authorized = 0 WHERE id = ?', [JSON.stringify(keyLog), siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/authorize/:siteId', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    await pool.query('UPDATE sites SET key_access_authorized = 1 WHERE id = ?', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/cancel/:siteId', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    await pool.query('UPDATE sites SET pending_key_log = NULL, key_access_authorized = 0 WHERE id = ?', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/confirm/:siteId', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const [rows] = await pool.query('SELECT pending_key_log FROM sites WHERE id = ?', [req.params.siteId]);
    if (rows.length > 0 && rows[0].pending_key_log) {
      const keyLog = safeParse(rows[0].pending_key_log);
      keyLog.id = `KEY-${Date.now()}`;
      await pool.query(
        'UPDATE sites SET current_key_log = ?, pending_key_log = NULL, key_access_authorized = 0, key_status = "Borrowed" WHERE id = ?', 
        [JSON.stringify(keyLog), req.params.siteId]
      );
      res.json(keyLog);
    } else res.status(404).json({ error: 'No pending key borrow request found.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/return/:siteId', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { returnPhoto } = req.body;
    const [rows] = await pool.query('SELECT current_key_log, key_history FROM sites WHERE id = ?', [req.params.siteId]);
    if (rows.length > 0 && rows[0].current_key_log) {
      const current = safeParse(rows[0].current_key_log);
      const history = safeParse(rows[0].key_history) || [];
      const finished = { ...current, returnPhoto, returnTime: new Date().toISOString() };
      const updatedHistory = [finished, ...history].slice(0, 20);
      await pool.query(
        'UPDATE sites SET current_key_log = NULL, key_history = ?, key_status = "Available" WHERE id = ?',
        [JSON.stringify(updatedHistory), req.params.siteId]
      );
      res.json({ success: true });
    } else res.status(404).json({ error: 'No active key custody record found.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------
// TASKS, INVENTORY & OFFICERS
// ---------------------------------------------------------

app.get('/api/tasks', async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const [rows] = await pool.query('SELECT * FROM tasks');
    res.json(rows.map(t => ({
      id: t.id, title: t.title, description: t.description, siteId: t.site_id,
      assignedTo: t.assigned_to, status: t.status, priority: t.priority,
      type: t.type, scheduledDate: t.scheduled_date
    })));
  } catch (err) { res.json([]); }
});

app.post('/api/tasks', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const t = req.body;
    await pool.query(
      `INSERT INTO tasks (id, title, description, site_id, assigned_to, status, priority, type, scheduled_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, t.title, t.description, t.siteId, t.assignedTo, t.status, t.priority, t.type, t.scheduledDate]
    );
    res.json(t);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/inventory', async (req, res) => {
  res.json([
    { id: 'MAT-001', name: 'Cat6 Shielded Cable', code: 'STP-CAT6', category: 'Cable', quantity: 20, unit: 'Rolls', minStockLevel: 5, currentStock: 18 },
    { id: 'MAT-002', name: 'SFP+ Transceiver', code: 'SFP-10G-LR', category: 'Hardware', quantity: 12, unit: 'Units', minStockLevel: 4, currentStock: 3 },
    { id: 'MAT-003', name: 'Fiber Splice Kit', code: 'FS-KIT', category: 'Tool', quantity: 1, unit: 'Kit', minStockLevel: 1, currentStock: 1 },
  ]);
});

app.get('/api/officers', async (req, res) => {
  res.json([
    { 
      id: 'FO-JCR', 
      name: 'Engr. John Carlo Rabanes, ECE', 
      employeeId: 'ECE-2024', 
      department: 'Technical', 
      contactNumber: '+63-XXX-XXXX', 
      email: 'jcr.rabanes@engr.com', 
      vehicleNumber: 'ENG-001', 
      isActive: true, 
      skills: ['Network Design', 'RF Engineering', 'Site Maintenance'], 
      activeTasks: 4, 
      lastUpdate: 'Just now' 
    }
  ]);
});

// ---------------------------------------------------------
// PRODUCTION STATIC SERVING & CATCH-ALLS
// ---------------------------------------------------------

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Ensure ALL /api requests that don't match above return a JSON 404
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `Path not found: ${req.method} ${req.originalUrl}` });
});

// Serve frontend for all non-api routes
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// START SERVER
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`---------------------------------------------------------`);
  console.log(`FIELDOPS PRO: OPERATIONAL ON PORT ${PORT}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`---------------------------------------------------------`);
});

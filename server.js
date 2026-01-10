const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const app = express();

/**
 * FIELDOPS PRO: BACKEND BRIDGE
 * This script connects the React frontend to the remote MySQL database.
 * Host: sql205.hstn.me
 */

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const dbConfig = {
  host: 'sql205.hstn.me',
  user: 'mseet_40088375',
  password: 'kAPvVet3QwK6',
  database: 'mseet_40088375_fieldops',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: false 
};

const pool = mysql.createPool(dbConfig);

// Helper: Handle JSON parsing for DB columns
const safeParse = (data) => {
  if (!data) return null;
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch (e) { return null; }
};

// ---------------------------------------------------------
// NEW: ROOT STATUS ROUTE
// ---------------------------------------------------------
app.get('/', (req, res) => {
  res.send(`
    <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #f8fafc; height: 100vh;">
      <h1 style="color: #2563eb;">FieldOps Pro API</h1>
      <p style="color: #64748b;">Status: <span style="color: #10b981; font-weight: bold;">ONLINE</span></p>
      <p style="font-size: 12px; color: #94a3b8;">Local Node Port: 3001</p>
    </div>
  `);
});

// ---------------------------------------------------------
// 1. AUTHENTICATION & VENDORS
// ---------------------------------------------------------

app.post('/api/auth/vendor/register', async (req, res) => {
  try {
    const v = req.body;
    await pool.query(
      `INSERT INTO vendors (id, username, password, full_name, company, contact_number, photo_url, id_number, specialization) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.id, v.username, v.password, v.fullName, v.company, v.contactNumber, v.photo, v.idNumber, v.specialization]
    );
    res.json(v);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/vendor/login', async (req, res) => {
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
// 2. SITE MANAGEMENT
// ---------------------------------------------------------

app.get('/api/sites', async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sites', async (req, res) => {
  try {
    const s = req.body;
    await pool.query(
      `INSERT INTO sites (id, name, type, address, gps_coordinates, priority, last_maintenance_date, next_maintenance_date, asset_photo_url, caretaker, caretaker_contact) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.name, s.type, s.address, s.gpsCoordinates, s.priority, s.lastMaintenanceDate, s.nextMaintenanceDate, s.assetPhoto, s.caretaker, s.caretakerContact]
    );
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sites/:id', async (req, res) => {
  try {
    const s = req.body;
    await pool.query(
      `UPDATE sites SET name=?, type=?, address=?, gps_coordinates=?, priority=?, asset_photo_url=?, caretaker=?, caretaker_contact=? WHERE id=?`,
      [s.name, s.type, s.address, s.gpsCoordinates, s.priority, s.assetPhoto, s.caretaker, s.caretakerContact, req.params.id]
    );
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// 3. ACCESS LOGS (VISITORS)
// ---------------------------------------------------------

app.post('/api/access/request', async (req, res) => {
  try {
    const { siteId, ...visitorData } = req.body;
    const visitor = { ...visitorData, id: `REQ-${Date.now()}`, checkInTime: new Date().toISOString() };
    await pool.query('UPDATE sites SET pending_visitor = ?, access_authorized = 0 WHERE id = ?', [JSON.stringify(visitor), siteId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/access/authorize/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET access_authorized = 1 WHERE id = ?', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/access/cancel/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET pending_visitor = NULL, access_authorized = 0 WHERE id = ?', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/access/checkin/:siteId', async (req, res) => {
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
    } else {
      res.status(404).json({ error: 'No pending request found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/access/checkout/:siteId', async (req, res) => {
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
    } else {
      res.status(404).json({ error: 'No active visitor' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// 4. KEY CUSTODY LOGS
// ---------------------------------------------------------

app.post('/api/keys/request', async (req, res) => {
  try {
    const { siteId, ...logData } = req.body;
    const log = { ...logData, id: `KREQ-${Date.now()}`, borrowTime: new Date().toISOString() };
    await pool.query('UPDATE sites SET pending_key_log = ?, key_access_authorized = 0 WHERE id = ?', [JSON.stringify(log), siteId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/keys/authorize/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET key_access_authorized = 1 WHERE id = ?', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/keys/cancel/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET pending_key_log = NULL, key_access_authorized = 0 WHERE id = ?', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/keys/confirm/:siteId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT pending_key_log FROM sites WHERE id = ?', [req.params.siteId]);
    if (rows.length > 0 && rows[0].pending_key_log) {
      const log = safeParse(rows[0].pending_key_log);
      log.id = `KEY-${Date.now()}`;
      await pool.query(
        "UPDATE sites SET current_key_log = ?, pending_key_log = NULL, key_access_authorized = 0, key_status = 'Borrowed' WHERE id = ?",
        [JSON.stringify(log), req.params.siteId]
      );
      res.json(log);
    } else {
      res.status(404).json({ error: 'No pending key request' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/keys/return/:siteId', async (req, res) => {
  try {
    const { returnPhoto } = req.body;
    const [rows] = await pool.query('SELECT current_key_log, key_history FROM sites WHERE id = ?', [req.params.siteId]);
    if (rows.length > 0 && rows[0].current_key_log) {
      const current = safeParse(rows[0].current_key_log);
      const history = safeParse(rows[0].key_history) || [];
      const finished = { ...current, returnPhoto, returnTime: new Date().toISOString() };
      const updatedHistory = [finished, ...history].slice(0, 20);
      await pool.query(
        "UPDATE sites SET current_key_log = NULL, key_history = ?, key_status = 'Available' WHERE id = ?",
        [JSON.stringify(updatedHistory), req.params.siteId]
      );
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Key not currently borrowed' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// 5. GENERIC DATA (TASKS/INVENTORY)
// ---------------------------------------------------------

app.get('/api/tasks', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM tasks');
    res.json(rows.map(t => ({
      id: t.id, title: t.title, description: t.description, siteId: t.site_id,
      assignedTo: t.assigned_to, status: t.status, priority: t.priority,
      type: t.type, scheduledDate: t.scheduled_date
    })));
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/inventory', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM materials');
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/officers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM officers');
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

// START SERVER
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`---------------------------------------------------------`);
  console.log(`FIELDOPS PRO: API BRIDGE ONLINE ON PORT ${PORT}`);
  console.log(`Backend: http://localhost:${PORT}`);
  console.log(`---------------------------------------------------------`);
});
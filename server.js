
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DEFAULT_URL = 'postgresql://postgres.jgklqdsdsblahsfshdop:NsA8HswFPjtngsv0@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';
const connectionString = process.env.DATABASE_URL || `${DEFAULT_URL}?pgbouncer=true`;

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('❌ Database Pool Error:', err.message);
});

async function initDatabase() {
  let client;
  try {
    client = await pool.connect();
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'Outdoor',
        address TEXT,
        gps_coordinates TEXT,
        caretaker TEXT,
        caretaker_contact TEXT,
        key_status TEXT DEFAULT 'Available',
        pending_visitor JSONB,
        current_visitor JSONB,
        visitor_history JSONB DEFAULT '[]'::jsonb,
        pending_key_log JSONB,
        current_key_log JSONB,
        key_history JSONB DEFAULT '[]'::jsonb,
        access_authorized BOOLEAN DEFAULT FALSE,
        key_access_authorized BOOLEAN DEFAULT FALSE,
        next_maintenance_date TEXT
      );

      CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT,
        company TEXT,
        contact_number TEXT,
        photo_url TEXT,
        id_number TEXT,
        specialization TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
        assigned_to TEXT,
        status TEXT DEFAULT 'Pending',
        priority TEXT,
        type TEXT,
        scheduled_date DATE
      );
    `);

    console.log('✅ Asset Registry DB is Active and Updated.');
  } catch (err) {
    console.error('❌ DB_INIT_FAILURE:', err.message);
  } finally {
    if (client) client.release();
  }
}

initDatabase();

// --- SYSTEM DIAGNOSTICS ---
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'operational', 
    timestamp: new Date().toISOString(),
    node: process.env.NODE_ENV || 'production'
  });
});

// --- VENDOR AUTH ENDPOINTS ---

app.post('/api/auth/vendor/register', async (req, res) => {
  const v = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO vendors (id, username, password, full_name, company, contact_number, photo_url, id_number, specialization) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [v.id, v.username, v.password, v.fullName, v.company, v.contactNumber, v.photo, v.idNumber, v.specialization]
    );
    const vendor = result.rows[0];
    res.json({
      id: vendor.id,
      username: vendor.username,
      fullName: vendor.full_name,
      company: vendor.company,
      contactNumber: vendor.contact_number,
      photo: vendor.photo_url,
      idNumber: vendor.id_number,
      specialization: vendor.specialization,
      verified: true,
      createdAt: vendor.created_at
    });
  } catch (err) {
    console.error('Registration Error:', err.message);
    res.status(500).json({ error: err.message.includes('unique constraint') ? 'Username already taken' : err.message });
  }
});

app.post('/api/auth/vendor/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM vendors WHERE username = $1 AND password = $2',
      [username, password]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const vendor = result.rows[0];
    res.json({
      id: vendor.id,
      username: vendor.username,
      fullName: vendor.full_name,
      company: vendor.company,
      contactNumber: vendor.contact_number,
      photo: vendor.photo_url,
      id_number: vendor.id_number,
      specialization: vendor.specialization,
      verified: true,
      createdAt: vendor.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- OPERATIONAL ENDPOINTS (ACCESS & KEYS) ---

app.post('/api/access/request', async (req, res) => {
  const { siteId, ...visitorData } = req.body;
  const pendingVisitor = { 
    ...visitorData, 
    id: `REQ-${Date.now()}`, 
    checkInTime: new Date().toISOString() 
  };
  try {
    await pool.query(
      'UPDATE sites SET pending_visitor = $1, access_authorized = FALSE WHERE id = $2',
      [JSON.stringify(pendingVisitor), siteId]
    );
    res.json({ success: true, pendingVisitor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/authorize/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET access_authorized = TRUE WHERE id = $1', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/cancel/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET pending_visitor = NULL, access_authorized = FALSE WHERE id = $1', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/checkin/:siteId', async (req, res) => {
  try {
    const siteResult = await pool.query('SELECT pending_visitor FROM sites WHERE id = $1', [req.params.siteId]);
    const visitor = siteResult.rows[0].pending_visitor;
    const currentVisitor = { 
      ...visitor, 
      id: `VIS-${Date.now()}`, 
      checkInTime: new Date().toISOString() 
    };
    await pool.query(
      'UPDATE sites SET current_visitor = $1, pending_visitor = NULL, access_authorized = FALSE WHERE id = $2',
      [JSON.stringify(currentVisitor), req.params.siteId]
    );
    res.json({ success: true, currentVisitor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/checkout/:siteId', async (req, res) => {
  const { exitPhoto, name, time } = req.body;
  try {
    const siteResult = await pool.query('SELECT current_visitor, visitor_history FROM sites WHERE id = $1', [req.params.siteId]);
    const current = siteResult.rows[0].current_visitor;
    const history = siteResult.rows[0].visitor_history || [];
    
    const finishedVisitor = { 
      ...current, 
      exitPhoto, 
      rocLogoutName: name, 
      rocLogoutTime: time, 
      checkOutTime: new Date().toISOString() 
    };
    
    await pool.query(
      'UPDATE sites SET current_visitor = NULL, visitor_history = $1 WHERE id = $2',
      [JSON.stringify([finishedVisitor, ...history].slice(0, 50)), req.params.siteId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/request', async (req, res) => {
  const { siteId, ...logData } = req.body;
  const pendingKeyLog = { 
    ...logData, 
    id: `KEYREQ-${Date.now()}`, 
    borrowTime: new Date().toISOString() 
  };
  try {
    await pool.query(
      'UPDATE sites SET pending_key_log = $1, key_access_authorized = FALSE WHERE id = $2',
      [JSON.stringify(pendingKeyLog), siteId]
    );
    res.json({ success: true, pendingKeyLog });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/authorize/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET key_access_authorized = TRUE WHERE id = $1', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/cancel/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET pending_key_log = NULL, key_access_authorized = FALSE WHERE id = $1', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/confirm/:siteId', async (req, res) => {
  try {
    const siteResult = await pool.query('SELECT pending_key_log FROM sites WHERE id = $1', [req.params.siteId]);
    const pending = siteResult.rows[0].pending_key_log;
    const currentKeyLog = { ...pending, id: `KEY-${Date.now()}` };
    
    await pool.query(
      "UPDATE sites SET key_status = 'Borrowed', current_key_log = $1, pending_key_log = NULL, key_access_authorized = FALSE WHERE id = $2",
      [JSON.stringify(currentKeyLog), req.params.siteId]
    );
    res.json({ success: true, currentKeyLog });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/return/:siteId', async (req, res) => {
  const { returnPhoto } = req.body;
  try {
    const siteResult = await pool.query('SELECT current_key_log, key_history FROM sites WHERE id = $1', [req.params.siteId]);
    const current = siteResult.rows[0].current_key_log;
    const history = siteResult.rows[0].key_history || [];
    
    const finishedLog = { 
      ...current, 
      returnTime: new Date().toISOString(), 
      returnPhoto 
    };
    
    await pool.query(
      "UPDATE sites SET key_status = 'Available', current_key_log = NULL, key_history = $1 WHERE id = $2",
      [JSON.stringify([finishedLog, ...history].slice(0, 50)), req.params.siteId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SITE ENDPOINTS ---

const mapSite = (s) => ({
  id: s.id,
  name: s.name,
  type: s.type,
  address: s.address,
  gpsCoordinates: s.gps_coordinates,
  caretaker: s.caretaker,
  caretakerContact: s.caretaker_contact,
  keyStatus: s.key_status,
  accessAuthorized: s.access_authorized,
  keyAccessAuthorized: s.key_access_authorized,
  pendingVisitor: s.pending_visitor,
  currentVisitor: s.current_visitor,
  visitorHistory: s.visitor_history || [],
  pendingKeyLog: s.pending_key_log,
  currentKeyLog: s.current_key_log,
  keyHistory: s.key_history || [],
  nextMaintenanceDate: s.next_maintenance_date
});

app.get('/api/sites', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sites ORDER BY name ASC');
    res.json(result.rows.map(mapSite));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sites', async (req, res) => {
  const s = req.body;
  try {
    await pool.query(
      `INSERT INTO sites (id, name, type, address, gps_coordinates, caretaker, caretaker_contact, next_maintenance_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [s.id, s.name, s.type, s.address, s.gpsCoordinates, s.caretaker, s.caretakerContact, s.nextMaintenanceDate]
    );
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/sites/:id', async (req, res) => {
  const s = req.body;
  try {
    await pool.query(
      `UPDATE sites SET name=$1, type=$2, address=$3, gps_coordinates=$4, caretaker=$5, caretaker_contact=$6, next_maintenance_date=$7 WHERE id=$8`,
      [s.name, s.type, s.address, s.gpsCoordinates, s.caretaker, s.caretakerContact, s.nextMaintenanceDate, req.params.id]
    );
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks ORDER BY scheduled_date ASC');
    res.json(result.rows);
  } catch (err) { res.json([]); }
});

const path = require('path');
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API Hub running on ${PORT}`));

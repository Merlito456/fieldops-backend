
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();

/**
 * FIELDOPS PRO: POSTGRESQL BACKEND
 * CONNECTION: Supabase Transaction Pooler (IPv4 / Port 6543)
 * Why: Resolves ENETUNREACH errors on Render and optimizes connection limits.
 */

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Database Connection
// Use the Transaction Pooler string provided by the user. 
// Note: ?pgbouncer=true is appended to ensure correct transaction handling.
const DEFAULT_URL = 'postgresql://postgres.jgklqdsdsblahsfshdop:NsA8HswFPjtngsv0@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';
const connectionString = process.env.DATABASE_URL || `${DEFAULT_URL}?pgbouncer=true`;

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  // POOLER OPTIMIZATIONS
  max: 20,                     // Max connections in the pool
  idleTimeoutMillis: 30000,    // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000 // Return error if connection takes > 10s
});

pool.on('error', (err) => {
  console.error('❌ Database Pool Error:', err.message);
});

let isDbConnected = false;

async function initDatabase() {
  console.log('📡 Initializing Database via Transaction Pooler...');
  let client;
  try {
    client = await pool.connect();
    console.log('🔗 Connection established to Supabase Hub.');
    
    // Create Tables with PostgreSQL Syntax
    await client.query(`
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

      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'Macro Cell',
        address TEXT,
        gps_coordinates TEXT,
        priority TEXT DEFAULT 'Medium',
        last_maintenance_date DATE,
        next_maintenance_date DATE,
        asset_photo_url TEXT,
        caretaker TEXT,
        caretaker_contact TEXT,
        key_status TEXT DEFAULT 'Available',
        tower_height INT,
        tower_type TEXT,
        equipment_brand TEXT,
        signal_integrity INT,
        sectors INT,
        pending_visitor JSONB,
        current_visitor JSONB,
        visitor_history JSONB DEFAULT '[]'::jsonb,
        pending_key_log JSONB,
        current_key_log JSONB,
        key_history JSONB DEFAULT '[]'::jsonb,
        access_authorized BOOLEAN DEFAULT FALSE,
        key_access_authorized BOOLEAN DEFAULT FALSE
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

    isDbConnected = true;
    console.log('✅ PostgreSQL Hub is ACTIVE.');
  } catch (err) {
    isDbConnected = false;
    console.error('❌ DB_INIT_FAILURE:', err.message);
  } finally {
    if (client) client.release();
  }
}

initDatabase();

// --- API ROUTES ---

app.get('/api/health', (req, res) => {
  res.json({ 
    status: "ONLINE", 
    db_connected: isDbConnected,
    mode: "TRANSACTION_POOLER_V4",
    timestamp: new Date().toISOString() 
  });
});

const mapSite = (s) => ({
  id: s.id,
  name: s.name,
  type: s.type,
  address: s.address,
  gpsCoordinates: s.gps_coordinates,
  priority: s.priority,
  lastMaintenanceDate: s.last_maintenance_date,
  nextMaintenanceDate: s.next_maintenance_date,
  assetPhoto: s.asset_photo_url,
  towerHeight: s.tower_height,
  towerType: s.tower_type,
  equipmentBrand: s.equipment_brand,
  signalIntegrity: s.signal_integrity,
  sectors: s.sectors,
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
  keyHistory: s.key_history || []
});

const mapTask = (t) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  siteId: t.site_id,
  assignedTo: t.assigned_to,
  status: t.status,
  priority: t.priority,
  type: t.type,
  scheduledDate: t.scheduled_date
});

// AUTH
app.post('/api/auth/vendor/register', async (req, res) => {
  const v = req.body;
  try {
    await pool.query(
      `INSERT INTO vendors (id, username, password, full_name, company, contact_number, photo_url, id_number, specialization) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [v.id, v.username, v.password, v.fullName, v.company, v.contactNumber, v.photo, v.idNumber, v.specialization]
    );
    res.json(v);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/vendor/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM vendors WHERE username = $1 AND password = $2', [username, password]);
    if (result.rows.length > 0) {
      const data = result.rows[0];
      res.json({
        id: data.id, username: data.username, fullName: data.full_name, company: data.company, 
        contactNumber: data.contact_number, photo: data.photo_url, idNumber: data.id_number, 
        specialization: data.specialization
      });
    } else res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SITES
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
      `INSERT INTO sites (id, name, type, address, gps_coordinates, priority, last_maintenance_date, next_maintenance_date, asset_photo_url, caretaker, caretaker_contact, tower_height, tower_type, equipment_brand, sectors) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [s.id, s.name, s.type, s.address, s.gpsCoordinates, s.priority, s.lastMaintenanceDate, s.nextMaintenanceDate, s.assetPhoto, s.caretaker, s.caretakerContact, s.towerHeight, s.towerType, s.equipmentBrand, s.sectors]
    );
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/sites/:id', async (req, res) => {
  const s = req.body;
  try {
    await pool.query(
      `UPDATE sites SET name=$1, type=$2, address=$3, gps_coordinates=$4, priority=$5, asset_photo_url=$6, caretaker=$7, caretaker_contact=$8, tower_height=$9, tower_type=$10, equipment_brand=$11, sectors=$12 WHERE id=$13`,
      [s.name, s.type, s.address, s.gpsCoordinates, s.priority, s.assetPhoto, s.caretaker, s.caretakerContact, s.towerHeight, s.towerType, s.equipmentBrand, s.sectors, req.params.id]
    );
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ACCESS
app.post('/api/access/request', async (req, res) => {
  const { siteId, ...visitorData } = req.body;
  const visitor = { ...visitorData, id: `REQ-${Date.now()}`, checkInTime: new Date().toISOString() };
  try {
    await pool.query('UPDATE sites SET pending_visitor = $1, access_authorized = FALSE WHERE id = $2', [visitor, siteId]);
    res.json({ success: true });
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
    const result = await pool.query('SELECT pending_visitor FROM sites WHERE id = $1', [req.params.siteId]);
    if (result.rows.length > 0 && result.rows[0].pending_visitor) {
      const visitor = { ...result.rows[0].pending_visitor, id: `VIS-${Date.now()}` };
      await pool.query('UPDATE sites SET current_visitor = $1, pending_visitor = NULL, access_authorized = FALSE WHERE id = $2', [visitor, req.params.siteId]);
      res.json(visitor);
    } else res.status(404).json({ error: 'No pending request' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/checkout/:siteId', async (req, res) => {
  const { exitPhoto, rocLogoutName, rocLogoutTime } = req.body;
  try {
    const result = await pool.query('SELECT current_visitor, visitor_history FROM sites WHERE id = $1', [req.params.siteId]);
    if (result.rows.length > 0 && result.rows[0].current_visitor) {
      const current = result.rows[0].current_visitor;
      const history = result.rows[0].visitor_history || [];
      const finished = { ...current, exitPhoto, rocLogoutName, rocLogoutTime, checkOutTime: new Date().toISOString() };
      const updatedHistory = [finished, ...history].slice(0, 20);
      await pool.query('UPDATE sites SET current_visitor = NULL, visitor_history = $1 WHERE id = $2', [updatedHistory, req.params.siteId]);
      res.json({ success: true });
    } else res.status(404).json({ error: 'No active session' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// KEYS
app.post('/api/keys/request', async (req, res) => {
  const { siteId, ...logData } = req.body;
  const keyLog = { ...logData, id: `KREQ-${Date.now()}`, borrowTime: new Date().toISOString() };
  try {
    await pool.query('UPDATE sites SET pending_key_log = $1, key_access_authorized = FALSE WHERE id = $2', [keyLog, siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/authorize/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET key_access_authorized = TRUE WHERE id = $1', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/confirm/:siteId', async (req, res) => {
  try {
    const result = await pool.query('SELECT pending_key_log FROM sites WHERE id = $1', [req.params.siteId]);
    if (result.rows.length > 0 && result.rows[0].pending_key_log) {
      const log = { ...result.rows[0].pending_key_log, id: `KEY-${Date.now()}` };
      await pool.query('UPDATE sites SET current_key_log = $1, pending_key_log = NULL, key_access_authorized = FALSE, key_status = \'Borrowed\' WHERE id = $2', [log, req.params.siteId]);
      res.json(log);
    } else res.status(404).json({ error: 'No key request' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/return/:siteId', async (req, res) => {
  const { returnPhoto } = req.body;
  try {
    const result = await pool.query('SELECT current_key_log, key_history FROM sites WHERE id = $1', [req.params.siteId]);
    if (result.rows.length > 0 && result.rows[0].current_key_log) {
      const current = result.rows[0].current_key_log;
      const history = result.rows[0].key_history || [];
      const finished = { ...current, returnPhoto, returnTime: new Date().toISOString() };
      const updatedHistory = [finished, ...history].slice(0, 20);
      await pool.query('UPDATE sites SET current_key_log = NULL, key_history = $1, key_status = \'Available\' WHERE id = $2', [updatedHistory, req.params.siteId]);
      res.json({ success: true });
    } else res.status(404).json({ error: 'No active key record' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// TASKS
app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks ORDER BY scheduled_date ASC');
    res.json(result.rows.map(mapTask));
  } catch (err) { res.json([]); }
});

app.post('/api/tasks', async (req, res) => {
  const t = req.body;
  try {
    await pool.query(
      `INSERT INTO tasks (id, title, description, site_id, assigned_to, status, priority, type, scheduled_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [t.id, t.title, t.description, t.siteId, t.assignedTo, t.status, t.priority, t.type, t.scheduledDate]
    );
    res.json(t);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/inventory', (req, res) => res.json([{ id: 'MAT-001', name: 'Cat6 Shielded Cable', code: 'STP-CAT6', category: 'Cable', currentStock: 18 }, { id: 'MAT-002', name: 'SFP+ Transceiver', code: 'SFP-10G-LR', category: 'Hardware', currentStock: 3 }]));
app.get('/api/officers', (req, res) => res.json([{ id: 'FO-JCR', name: 'Engr. John Carlo Rabanes, ECE', employeeId: 'ECE-2024', department: 'Technical', isActive: true }]));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`FIELDOPS PRO API (POOLER): ON PORT ${PORT}`));

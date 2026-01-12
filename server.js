
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DEFAULT_URL = 'postgresql://postgres.jgklqdsdsblahsfshdop:NsA8HswFPjtngsv0@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';
const connectionString = process.env.DATABASE_URL || `${DEFAULT_URL}?pgbouncer=true`;

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => console.error('❌ DB Pool Error:', err.message));

async function initDatabase() {
  let client;
  try {
    client = await pool.connect();
    console.log('🔄 Verifying Database Schema...');
    
    // Core Table Structure
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

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        vendor_id TEXT NOT NULL,
        site_id TEXT,
        sender_id TEXT,
        sender_name TEXT,
        role TEXT,
        content TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        is_read BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        site_id TEXT,
        assigned_to TEXT,
        status TEXT DEFAULT 'Pending',
        priority TEXT,
        type TEXT,
        scheduled_date TEXT,
        estimated_hours NUMERIC,
        actual_hours NUMERIC,
        materials_required JSONB DEFAULT '[]'::jsonb,
        safety_requirements JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        task_initiation_photo TEXT
      );
    `);

    // Resiliency Patch: Ensure columns exist in case table was created previously without them
    await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS vendor_id TEXT`);
    await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE`);
    
    console.log('✅ System DB Ready and Patched.');
  } catch (err) {
    console.error('❌ DB_INIT_FAILURE:', err.message);
  } finally {
    if (client) client.release();
  }
}

initDatabase();

// --- API ENDPOINTS ---

app.get('/api/health', (req, res) => res.json({ status: 'operational', database: 'connected' }));

const mapVendor = (v) => v ? ({
  id: v.id, username: v.username, fullName: v.full_name, company: v.company, contactNumber: v.contact_number, photo: v.photo_url, idNumber: v.id_number, specialization: v.specialization, verified: true, createdAt: v.created_at
}) : null;

app.get('/api/vendors', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vendors ORDER BY full_name ASC');
    res.json(result.rows.map(mapVendor));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/vendor/register', async (req, res) => {
  const v = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO vendors (id, username, password, full_name, company, contact_number, photo_url, id_number, specialization) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [v.id, (v.username || '').toUpperCase(), (v.password || '').toUpperCase(), v.fullName, v.company, v.contactNumber, v.photo, v.idNumber, v.specialization]
    );
    res.json(mapVendor(result.rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/vendor/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM vendors WHERE UPPER(username) = $1 AND UPPER(password) = $2', [(username || '').toUpperCase(), (password || '').toUpperCase()]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid Credentials' });
    res.json(mapVendor(result.rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const mapSite = (s) => ({
  id: s.id, name: s.name, type: s.type, address: s.address, gpsCoordinates: s.gps_coordinates, caretaker: s.caretaker, caretakerContact: s.caretaker_contact, 
  keyStatus: s.key_status, accessAuthorized: s.access_authorized, keyAccessAuthorized: s.key_access_authorized, pendingVisitor: s.pending_visitor,
  currentVisitor: s.current_visitor, visitorHistory: s.visitor_history || [], pendingKeyLog: s.pending_key_log, currentKeyLog: s.current_key_log, 
  keyHistory: s.key_history || [], nextMaintenanceDate: s.next_maintenance_date
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
    const result = await pool.query(
      `INSERT INTO sites (id, name, type, address, gps_coordinates, caretaker, caretaker_contact) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [s.id, s.name, s.type, s.address, s.gpsCoordinates, s.caretaker, s.caretakerContact]
    );
    res.json(mapSite(result.rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/sites/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sites WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- MESSAGING HUB ---
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY timestamp ASC');
    res.json(result.rows.map(m => ({ id: m.id, vendorId: m.vendor_id, siteId: m.site_id, senderId: m.sender_id, senderName: m.sender_name, role: m.role, content: m.content, timestamp: m.timestamp, isRead: m.is_read })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/messages/:vendorId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages WHERE vendor_id = $1 ORDER BY timestamp ASC', [req.params.vendorId]);
    res.json(result.rows.map(m => ({ id: m.id, vendorId: m.vendor_id, siteId: m.site_id, senderId: m.sender_id, senderName: m.sender_name, role: m.role, content: m.content, timestamp: m.timestamp, isRead: m.is_read })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/messages', async (req, res) => {
  const m = req.body;
  const vendorId = m.vendorId || m.vendor_id;
  
  if (!vendorId) {
    console.warn('⚠️ Rejected Message: vendorId missing in payload');
    return res.status(400).json({ error: 'vendorId is required' });
  }
  
  try {
    const id = `MSG-${Date.now()}`;
    await pool.query(
      'INSERT INTO messages (id, vendor_id, site_id, sender_id, sender_name, role, content) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, vendorId, m.siteId || null, m.senderId, m.senderName, m.role, m.content]
    );
    res.json({ id, vendorId, ...m, timestamp: new Date().toISOString(), isRead: false });
  } catch (err) { 
    console.error('❌ DB_INSERT_ERROR (Messages):', err.message);
    res.status(500).json({ error: err.message }); 
  }
});

app.patch('/api/messages/read/:vendorId', async (req, res) => {
  try {
    await pool.query('UPDATE messages SET is_read = TRUE WHERE vendor_id = $1 AND role = \'VENDOR\'', [req.params.vendorId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SITE OPERATIONS ---
app.post('/api/access/request', async (req, res) => {
  const { siteId, ...visitorData } = req.body;
  const pendingVisitor = { ...visitorData, id: `REQ-${Date.now()}`, checkInTime: new Date().toISOString() };
  try {
    await pool.query('UPDATE sites SET pending_visitor = $1, access_authorized = FALSE WHERE id = $2', [JSON.stringify(pendingVisitor), siteId]);
    res.json({ success: true, pendingVisitor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/checkin/:siteId', async (req, res) => {
  try {
    const siteResult = await pool.query('SELECT pending_visitor FROM sites WHERE id = $1', [req.params.siteId]);
    if (!siteResult.rows[0].pending_visitor) return res.status(400).json({ error: 'No pending visitor' });
    const currentVisitor = { ...siteResult.rows[0].pending_visitor, id: `VIS-${Date.now()}` };
    await pool.query('UPDATE sites SET current_visitor = $1, pending_visitor = NULL, access_authorized = FALSE WHERE id = $2', [JSON.stringify(currentVisitor), req.params.siteId]);
    res.json({ success: true, currentVisitor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/authorize/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET access_authorized = TRUE WHERE id = $1', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/authorize/:siteId', async (req, res) => {
  try {
    await pool.query('UPDATE sites SET key_access_authorized = TRUE WHERE id = $1', [req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/request', async (req, res) => {
  const { siteId, ...logData } = req.body;
  const pendingKeyLog = { ...logData, id: `KEYREQ-${Date.now()}`, borrowTime: new Date().toISOString() };
  try {
    await pool.query('UPDATE sites SET pending_key_log = $1, key_access_authorized = FALSE WHERE id = $2', [JSON.stringify(pendingKeyLog), siteId]);
    res.json({ success: true, pendingKeyLog });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/confirm/:siteId', async (req, res) => {
  try {
    const siteResult = await pool.query('SELECT pending_key_log FROM sites WHERE id = $1', [req.params.siteId]);
    const currentKeyLog = { ...siteResult.rows[0].pending_key_log, id: `KEY-${Date.now()}` };
    await pool.query("UPDATE sites SET key_status = 'Borrowed', current_key_log = $1, pending_key_log = NULL, key_access_authorized = FALSE WHERE id = $2", [JSON.stringify(currentKeyLog), req.params.siteId]);
    res.json({ success: true, currentKeyLog });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/checkout/:siteId', async (req, res) => {
  const { exitPhoto, name, time, ...rest } = req.body;
  try {
    const siteResult = await pool.query('SELECT current_visitor, visitor_history FROM sites WHERE id = $1', [req.params.siteId]);
    const history = siteResult.rows[0].visitor_history || [];
    const finishedVisitor = { ...siteResult.rows[0].current_visitor, exitPhoto, rocLogoutName: name, rocLogoutTime: time, ...rest, checkOutTime: new Date().toISOString() };
    await pool.query('UPDATE sites SET current_visitor = NULL, visitor_history = $1 WHERE id = $2', [JSON.stringify([finishedVisitor, ...history].slice(0, 50)), req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/keys/return/:siteId', async (req, res) => {
  const { returnPhoto } = req.body;
  try {
    const siteResult = await pool.query('SELECT current_key_log, key_history FROM sites WHERE id = $1', [req.params.siteId]);
    const history = siteResult.rows[0].key_history || [];
    const finishedLog = { ...siteResult.rows[0].current_key_log, returnTime: new Date().toISOString(), returnPhoto };
    await pool.query("UPDATE sites SET key_status = 'Available', current_key_log = NULL, key_history = $1 WHERE id = $2", [JSON.stringify([finishedLog, ...history].slice(0, 50)), req.params.siteId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks ORDER BY scheduled_date ASC');
    res.json(result.rows.map(t => ({
      id: t.id, title: t.title, description: t.description, siteId: t.site_id, assignedTo: t.assigned_to, status: t.status, priority: t.priority,
      type: t.type, scheduledDate: t.scheduled_date, estimatedHours: t.estimated_hours, actualHours: t.actual_hours,
      materialsRequired: t.materials_required || [], safetyRequirements: t.safety_requirements || [], createdAt: t.created_at,
      updatedAt: t.updated_at, completedAt: t.completed_at, taskInitiationPhoto: t.task_initiation_photo
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks', async (req, res) => {
  const t = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO tasks (id, title, description, site_id, assigned_to, status, priority, type, scheduled_date, estimated_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [t.id, t.title, t.description, t.siteId, t.assignedTo, t.status, t.priority, t.type, t.scheduledDate, t.estimatedHours]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/officers', async (req, res) => {
   res.json([{ id: 'FO-001', name: 'FO ADMIN', employeeId: 'ECE-001', department: 'Network' }]);
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => { if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'dist', 'index.html')); });

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 FieldOps API Hub Active: ${PORT}`));

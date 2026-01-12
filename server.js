
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
        site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
        assigned_to TEXT,
        status TEXT DEFAULT 'Pending',
        priority TEXT,
        type TEXT,
        scheduled_date DATE
      );
    `);
    console.log('✅ System DB Ready.');
  } catch (err) {
    console.error('❌ DB_INIT_FAILURE:', err.message);
  } finally {
    if (client) client.release();
  }
}

initDatabase();

app.get('/api/health', (req, res) => res.json({ status: 'operational' }));

const mapVendor = (v) => {
  if (!v) return null;
  return {
    id: v.id, username: v.username, fullName: v.full_name, company: v.company, contactNumber: v.contact_number, photo: v.photo_url, idNumber: v.id_number, specialization: v.specialization, verified: true, createdAt: v.created_at
  };
};

app.get('/api/vendors', async (req, res) => {
  const result = await pool.query('SELECT * FROM vendors ORDER BY full_name ASC');
  res.json(result.rows.map(mapVendor));
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
  const upUsername = (username || '').toUpperCase();
  const upPassword = (password || '').toUpperCase();
  try {
    const result = await pool.query('SELECT * FROM vendors WHERE UPPER(username) = $1 AND UPPER(password) = $2', [upUsername, upPassword]);
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
  const result = await pool.query('SELECT * FROM sites ORDER BY name ASC');
  res.json(result.rows.map(mapSite));
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

// --- MESSAGES Refactored for is_read ---
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
  const id = `MSG-${Date.now()}`;
  try {
    await pool.query(
      'INSERT INTO messages (id, vendor_id, site_id, sender_id, sender_name, role, content) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, m.vendorId, m.siteId || null, m.senderId, m.senderName, m.role, m.content]
    );
    res.json({ id, ...m, timestamp: new Date().toISOString(), isRead: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/messages/read/:vendorId', async (req, res) => {
  try {
    await pool.query('UPDATE messages SET is_read = TRUE WHERE vendor_id = $1 AND role = \'VENDOR\'', [req.params.vendorId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/request', async (req, res) => {
  const { siteId, ...visitorData } = req.body;
  const pendingVisitor = { ...visitorData, id: `REQ-${Date.now()}`, checkInTime: new Date().toISOString() };
  try {
    await pool.query('UPDATE sites SET pending_visitor = $1, access_authorized = FALSE WHERE id = $2', [JSON.stringify(pendingVisitor), siteId]);
    res.json({ success: true, pendingVisitor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/access/checkin/:siteId', async (req, res) => {
  const siteResult = await pool.query('SELECT pending_visitor FROM sites WHERE id = $1', [req.params.siteId]);
  const currentVisitor = { ...siteResult.rows[0].pending_visitor, id: `VIS-${Date.now()}` };
  await pool.query('UPDATE sites SET current_visitor = $1, pending_visitor = NULL, access_authorized = FALSE WHERE id = $2', [JSON.stringify(currentVisitor), req.params.siteId]);
  res.json({ success: true, currentVisitor });
});

app.post('/api/access/authorize/:siteId', async (req, res) => {
  await pool.query('UPDATE sites SET access_authorized = TRUE WHERE id = $1', [req.params.siteId]);
  res.json({ success: true });
});

app.post('/api/keys/authorize/:siteId', async (req, res) => {
  await pool.query('UPDATE sites SET key_access_authorized = TRUE WHERE id = $1', [req.params.siteId]);
  res.json({ success: true });
});

app.post('/api/access/cancel/:siteId', async (req, res) => {
  await pool.query('UPDATE sites SET pending_visitor = NULL, access_authorized = FALSE WHERE id = $1', [req.params.siteId]);
  res.json({ success: true });
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
  const siteResult = await pool.query('SELECT pending_key_log FROM sites WHERE id = $1', [req.params.siteId]);
  const currentKeyLog = { ...siteResult.rows[0].pending_key_log, id: `KEY-${Date.now()}` };
  await pool.query("UPDATE sites SET key_status = 'Borrowed', current_key_log = $1, pending_key_log = NULL, key_access_authorized = FALSE WHERE id = $2", [JSON.stringify(currentKeyLog), req.params.siteId]);
  res.json({ success: true, currentKeyLog });
});

app.post('/api/access/checkout/:siteId', async (req, res) => {
  const { exitPhoto, name, time, ...rest } = req.body;
  const siteResult = await pool.query('SELECT current_visitor, visitor_history FROM sites WHERE id = $1', [req.params.siteId]);
  const history = siteResult.rows[0].visitor_history || [];
  const finishedVisitor = { ...siteResult.rows[0].current_visitor, exitPhoto, rocLogoutName: name, rocLogoutTime: time, ...rest, checkOutTime: new Date().toISOString() };
  await pool.query('UPDATE sites SET current_visitor = NULL, visitor_history = $1 WHERE id = $2', [JSON.stringify([finishedVisitor, ...history].slice(0, 50)), req.params.siteId]);
  res.json({ success: true });
});

app.post('/api/keys/return/:siteId', async (req, res) => {
  const { returnPhoto } = req.body;
  const siteResult = await pool.query('SELECT current_key_log, key_history FROM sites WHERE id = $1', [req.params.siteId]);
  const history = siteResult.rows[0].key_history || [];
  const finishedLog = { ...siteResult.rows[0].current_key_log, returnTime: new Date().toISOString(), returnPhoto };
  await pool.query("UPDATE sites SET key_status = 'Available', current_key_log = NULL, key_history = $1 WHERE id = $2", [JSON.stringify([finishedLog, ...history].slice(0, 50)), req.params.siteId]);
  res.json({ success: true });
});

app.get('/api/tasks', async (req, res) => {
  const result = await pool.query('SELECT * FROM tasks ORDER BY scheduled_date ASC');
  res.json(result.rows);
});

app.get('/api/officers', async (req, res) => {
   res.json([{ id: 'FO-001', name: 'FO ADMIN', employeeId: 'ECE-001', department: 'Network' }]);
});

const path = require('path');
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => { if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'dist', 'index.html')); });

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API Node Active: ${PORT}`));

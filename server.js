
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
    
    // Updated schema to include next_maintenance_date to support forecasting
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
  // Added mapping for nextMaintenanceDate
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
    // Included next_maintenance_date in insertion query
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
    // Included next_maintenance_date in update query
    await pool.query(
      `UPDATE sites SET name=$1, type=$2, address=$3, gps_coordinates=$4, caretaker=$5, caretaker_contact=$6, next_maintenance_date=$7 WHERE id=$8`,
      [s.name, s.type, s.address, s.gpsCoordinates, s.caretaker, s.caretakerContact, s.nextMaintenanceDate, req.params.id]
    );
    res.json(s);
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

app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks ORDER BY scheduled_date ASC');
    res.json(result.rows);
  } catch (err) { res.json([]); }
});

// Serve frontend for production
const path = require('path');
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API Hub running on ${PORT}`));

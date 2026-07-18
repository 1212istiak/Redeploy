const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
// Only used to seed the PIN the very first time a brand-new database boots.
// After that, the real value lives in the database, same as before.
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend if put in public folder

// Database Setup — Turso in production. Falls back to a local file if
// TURSO_DATABASE_URL isn't set, which is only for local testing on your own
// machine; Render should always have the Turso env vars set.
const db = createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:local.db',
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

// Initialize Tables (async now — libsql's client is promise-based)
async function initDb() {
    await db.execute(`CREATE TABLE IF NOT EXISTS site_meta (
        id INTEGER PRIMARY KEY,
        title TEXT,
        special_tile_thumbnail TEXT,
        special_tile_label TEXT,
        admin_pin TEXT
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        title TEXT,
        episode_number INTEGER,
        season INTEGER DEFAULT 1,
        thumbnail TEXT,
        genre TEXT,
        is_special INTEGER DEFAULT 0,
        embed_dailymotion TEXT,
        embed_rumble TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        episode_id TEXT,
        nickname TEXT,
        body TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(episode_id) REFERENCES episodes(id)
    )`);

    const countResult = await db.execute('SELECT COUNT(*) as count FROM site_meta');
    if (Number(countResult.rows[0].count) === 0) {
        await db.execute({
            sql: "INSERT INTO site_meta (id, title, special_tile_thumbnail, special_tile_label, admin_pin) VALUES (1, ?, '', 'SPECIAL COLLECTION', ?)",
            args: ["The Voice of Rockstar'z", ADMIN_PIN],
        });
    } else {
        // Only seed the PIN if it's still empty — never overwrite one that
        // was already changed through the admin panel.
        await db.execute({
            sql: "UPDATE site_meta SET admin_pin = ? WHERE id = 1 AND (admin_pin IS NULL OR admin_pin = '')",
            args: [ADMIN_PIN],
        });
    }
    console.log(`Connected to ${process.env.TURSO_DATABASE_URL ? 'Turso' : 'local file'} database.`);
}

// --- PUBLIC API ---

app.get('/api/site', async (req, res) => {
    try {
        const result = await db.execute('SELECT id, title, special_tile_thumbnail, special_tile_label FROM site_meta WHERE id = 1');
        res.json(result.rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/episodes', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM episodes ORDER BY episode_number DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/comments/:episodeId', async (req, res) => {
    try {
        const result = await db.execute({
            sql: 'SELECT * FROM comments WHERE episode_id = ? ORDER BY created_at DESC',
            args: [req.params.episodeId],
        });
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/comments', async (req, res) => {
    const { episode_id, nickname, body } = req.body;
    if (!episode_id || !nickname || !body) return res.status(400).json({ error: 'Missing fields' });

    const id = uuidv4();
    try {
        await db.execute({
            sql: 'INSERT INTO comments (id, episode_id, nickname, body) VALUES (?, ?, ?, ?)',
            args: [id, episode_id, nickname, body],
        });
        res.json({ id, episode_id, nickname, body, created_at: new Date() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ADMIN API ---

app.post('/api/admin/auth', async (req, res) => {
    const { password } = req.body;
    try {
        const result = await db.execute('SELECT admin_pin FROM site_meta WHERE id = 1');
        const currentPin = result.rows[0]?.admin_pin || ADMIN_PIN;
        if (password && password.trim() === currentPin.trim()) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid password' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/password', async (req, res) => {
    const { password, new_password } = req.body;
    if (!password || !new_password || !new_password.trim()) {
        return res.status(400).json({ error: 'Both current and new password are required' });
    }
    try {
        const result = await db.execute('SELECT admin_pin FROM site_meta WHERE id = 1');
        const currentPin = result.rows[0]?.admin_pin || ADMIN_PIN;
        if (password.trim() !== currentPin.trim()) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        await db.execute({ sql: 'UPDATE site_meta SET admin_pin = ? WHERE id = 1', args: [new_password.trim()] });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/site', async (req, res) => {
    const { title, special_tile_thumbnail, special_tile_label } = req.body;
    try {
        await db.execute({
            sql: 'UPDATE site_meta SET title = ?, special_tile_thumbnail = ?, special_tile_label = ? WHERE id = 1',
            args: [title, special_tile_thumbnail, special_tile_label],
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/settings', async (req, res) => {
    const { password, site_title, special_tile_thumbnail, special_tile_label } = req.body;
    try {
        const result = await db.execute('SELECT admin_pin, title, special_tile_thumbnail, special_tile_label FROM site_meta WHERE id = 1');
        const row = result.rows[0] || {};
        const currentPin = row.admin_pin || ADMIN_PIN;
        if (!password || password.trim() !== currentPin.trim()) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        const nextTitle = site_title !== undefined ? site_title : row.title;
        const nextThumb = special_tile_thumbnail !== undefined ? special_tile_thumbnail : row.special_tile_thumbnail;
        const nextLabel = special_tile_label !== undefined ? special_tile_label : row.special_tile_label;
        await db.execute({
            sql: 'UPDATE site_meta SET title = ?, special_tile_thumbnail = ?, special_tile_label = ? WHERE id = 1',
            args: [nextTitle, nextThumb, nextLabel],
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/episodes', async (req, res) => {
    const { title, episode_number, season, thumbnail, genre, is_special, embed_dailymotion, embed_rumble } = req.body;
    const id = uuidv4();
    try {
        await db.execute({
            sql: `INSERT INTO episodes (id, title, episode_number, season, thumbnail, genre, is_special, embed_dailymotion, embed_rumble)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [id, title, episode_number, season || 1, thumbnail, genre, is_special ? 1 : 0, embed_dailymotion, embed_rumble],
        });
        res.json({ id, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function updateEpisodeHandler(req, res) {
    const { title, episode_number, season, thumbnail, genre, is_special, embed_dailymotion, embed_rumble } = req.body;
    try {
        await db.execute({
            sql: `UPDATE episodes SET title = ?, episode_number = ?, season = ?, thumbnail = ?, genre = ?, is_special = ?, embed_dailymotion = ?, embed_rumble = ?
                  WHERE id = ?`,
            args: [title, episode_number, season || 1, thumbnail, genre, is_special ? 1 : 0, embed_dailymotion, embed_rumble, req.params.id],
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
app.put('/api/admin/episodes/:id', updateEpisodeHandler);
app.patch('/api/admin/episodes/:id', updateEpisodeHandler);

app.delete('/api/admin/episodes/:id', async (req, res) => {
    try {
        await db.execute({ sql: 'DELETE FROM episodes WHERE id = ?', args: [req.params.id] });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start Server
initDb()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    });
